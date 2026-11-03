/** Explicit, model-independent school-service surface for both CLI and MCP. */
import catalog from "./catalog.json";
import { taskOperations, type TaskGrant } from "@onethu/sdk/tasks";
import { bindDesktopTasks, runDesktopTaskControl, listTaskChannels, readTaskInbox, normalizeTaskChannels } from "../state/cliTasks.js";
import { validate, type Schema } from "./validation.js";
import { cliLearnOperations, runCliLearnDownloadWithDeadline } from "../lib/cliLearn.js";
import type { OnethuApi } from "../plugins/types.js";
import { session, info } from "../lib/clients.js";
import { venueClient as venue } from "../lib/venue.js";
import { nativeSessionEpoch, assertNativeSessionEpoch } from "../lib/transport.js";
import { mcpServerEnabled, cliAutoExecuteEnabled, subscribeUserExt } from "../state/userext.js";
import { confirmationMode, mutationApproval } from "@onethu/sdk/policy";
import { ohAuthorized, subscribePrivacy } from "../state/privacyConsent.js";
import { t } from "../i18n/index.js";
import { publicResult, publicError } from "./publicResult.js";
import { sharedAccountGuard, usesSharedRuntime } from "../lib/sharedRuntime.js";

type Operation = { name: string; description: string; parameters: Schema; mutation?: boolean; run?: (...args: any[]) => Promise<unknown> };
const operations: Operation[] = [...catalog, ...taskOperations,
  { name: "tasks.channels", description: "List device-bound notification channels for task creation.", parameters: { type: "array", items: [], minItems: 0, maxItems: 0 }, run: listTaskChannels },
  { name: "tasks.inbox", description: "Read task notifications for the active account on this device.", parameters: { type: "array", items: [], minItems: 0, maxItems: 0 }, run: readTaskInbox }, ...cliLearnOperations.map(op => ({ ...op, name: op.name.startsWith("learn.") ? op.name : `learn.${op.name}` }))];
const byName = new Map(operations.map(op => [op.name, op]));
if (byName.size !== operations.length) throw new Error("Duplicate OneTHU CLI operation");
let generation = 0;
let authorization = `${mcpServerEnabled()}:${ohAuthorized()}:${cliAutoExecuteEnabled()}`;
let writeBusy = false;
const pendingConfirmations = new Set<AbortController>();
export function invalidateCliRequests() {
  generation++;
  for (const controller of pendingConfirmations) controller.abort();
}
function observeAuthorization() {
  const current = `${mcpServerEnabled()}:${ohAuthorized()}:${cliAutoExecuteEnabled()}`;
  if (current !== authorization) { authorization = current; invalidateCliRequests(); }
}
subscribeUserExt(observeAuthorization);
subscribePrivacy(observeAuthorization);
function authorized() {
  if (!mcpServerEnabled() || !ohAuthorized()) throw new Error("CLI_DISABLED: Enable OneTHU CLI in the app and grant agent-service access.");
}
function publicOperation({ run: _run, ...op }: Operation) { return { ...op, mutation: !!op.mutation }; }

type GuardedFacade = { create(beforeWrite: () => Promise<void>): OnethuApi; mutations: ReadonlySet<string>; internal?: boolean };
const localMutations = new Set(["visit.fill", "nav.go", "services.open", "venue.jump", "exthw.refresh"]);
const reservationMutations = new Set(["library.book", "library.cancel", "libroom.book", "libroom.cancel", "kongjian.book", "kongjian.cancel", "venue.cancel"]);

export function createCliService(api: OnethuApi, permissions: Set<string>, guarded: GuardedFacade) {
  // The app's own OH can use reviewed GUI services without opening an external
  // CLI listener. Only trusted composition code can set this flag, never JSON.
  const authorize = () => {
    if (!guarded.internal) return authorized();
    if (!ohAuthorized()) throw new Error("OH_AUTHORIZATION_REQUIRED");
  };
  // References enter only through manager-owned ports, never a public JSON field.
  const liveGrants = new WeakSet<TaskGrant>();
  const service = {
    list() {
      authorize();
      return { name: guarded.internal ? "OneTHU app services" : "OneTHU CLI", version: "1", session: { status: api.session.status(), username: api.session.username() },
        tasksRequireCli: false,
        platform: navigator.platform, operations: operations.map(publicOperation),
        confirmationMode: confirmationMode(cliAutoExecuteEnabled()),
        confirmation: cliAutoExecuteEnabled()
          ? "Automatic execution is authorized on this device. Supported mutations execute without per-request confirmation. Never retry a mutation automatically."
          : "Mutations require confirm:true and approval in the OneTHU app. Never retry a mutation automatically." };
    },
    call(raw: unknown) { return call(raw); },
  };
  async function call(raw: unknown, task?: { grant: TaskGrant; signal: AbortSignal }) {
      authorize();
      validate(raw, { type: "object", required: ["operation"], properties: {
        operation: { type: "string" }, args: { type: "array", maxItems: 16 }, confirm: { type: "boolean" }, deadlineUnixMs: { type: "number" },
      }, additionalProperties: false });
      const input = raw as { operation: string; args?: unknown[]; confirm?: boolean; deadlineUnixMs?: number };
      const startedAt = Date.now();
      const deadline = Math.min(input.deadlineUnixMs ?? startedAt + 110_000, startedAt + 150_000);
      const op = byName.get(input.operation);
      const taskControl = taskOperations.find(item => item.name === input.operation);
      if (!op) throw new Error("UNKNOWN_OPERATION: Use commands to list supported operations.");
      if ((op.run || taskControl) && !permissions.has("learn:read")) throw new Error("PERMISSION_REQUIRED: learn:read");
      if ((op.name === "library.book" || op.name === "library.cancel" || op.name === "libroom.book" || op.name === "libroom.cancel") && !permissions.has("library:book")) throw new Error("PERMISSION_REQUIRED: library:book");
      const args = input.args ?? [];
      validate(args, op.parameters);
      if (JSON.stringify(args).length > 100_000) throw new Error("INVALID_ARGUMENTS: argument size exceeds 100,000 characters");
      const owner = session.username;
      const revision = generation;
      const epoch = await nativeSessionEpoch();
      const sharedGuard = usesSharedRuntime() && op.name.startsWith("tasks.") ? await sharedAccountGuard(owner) : undefined;
      const check = async () => {
        authorize();
          if (task) {
          if (!liveGrants.has(task.grant) || task.signal.aborted) throw new Error("TASK_CANCELLED");
          await task.grant.assertAllowed(op.name, args);
        }
        if (Date.now() >= deadline) throw new Error("CLI_DEADLINE_EXCEEDED: Check the result before repeating a write.");
        if (generation !== revision || session.username !== owner) throw new Error("CLI_SESSION_CHANGED: Retry after checking the active account.");
        await assertNativeSessionEpoch(epoch);
        authorize();
        if (Date.now() >= deadline) throw new Error("CLI_DEADLINE_EXCEEDED: Check the result before repeating a write.");
        if (generation !== revision || session.username !== owner) throw new Error("CLI_SESSION_CHANGED");
        if (task) {
          if (task.signal.aborted) throw new Error("TASK_CANCELLED");
          await task.grant.assertAllowed(op.name, args);
        }
      };
      await check();
      if (op.name === "tasks.create" || op.name === "tasks.update") {
        const index = op.name === "tasks.create" ? 0 : 1;
        // Freeze aliases to the currently bound recipient before displaying the
        // consent. Changing an IM binding while the prompt is open cannot redirect it.
        args[index] = await normalizeTaskChannels(args[index]);
        await check();
      }
      const needsApproval = !!op.mutation && (!taskControl || taskControl.requiresGrant === true);
      const approval = task ? "read" : mutationApproval({ mutation: needsApproval, automatic: cliAutoExecuteEnabled(), confirmed: input.confirm });
      const serializedWrite = !!op.mutation && !taskControl;
      if (approval === "confirmation-required") throw new Error("CONFIRMATION_REQUIRED: Repeat with --confirm, then review the request in OneTHU.");
      if (serializedWrite && writeBusy) throw new Error("WRITE_BUSY: Another local confirmation or write is in progress.");
      if (serializedWrite) writeBusy = true;
      try {
        if (approval === "prompt") {
          const { confirmChoice } = await import("../lib/confirm.js");
          await check();
          const controller = new AbortController();
          pendingConfirmations.add(controller);
          const timeout = setTimeout(() => controller.abort(), Math.min(45_000, Math.max(0, deadline - Date.now())));
          const stopOnRevocation = () => { if (revision !== generation) controller.abort(); };
          const stopExt = subscribeUserExt(stopOnRevocation), stopPrivacy = subscribePrivacy(stopOnRevocation);
          const approved = await confirmChoice(`${op.name}\n${op.description}\n\n${JSON.stringify(args, null, 2)}`, {
              title: t("cli.confirm.title"), confirmText: t("cli.confirm.execute"), cancelText: t("common.cancel"),
              signal: controller.signal,
          }).finally(() => { pendingConfirmations.delete(controller); clearTimeout(timeout); stopExt(); stopPrivacy(); });
          if (!approved) throw new Error("CONFIRMATION_CANCELLED: No changes were made.");
          await check();
        }
        if (taskControl) {
          if (task) throw new Error("TASK_OPERATION_OUTSIDE_GRANT");
          const result = await runDesktopTaskControl(op.name, args, check, sharedGuard?.expectedEpoch);
          await check(); return publicResult(result ?? null);
        }
        if (op.mutation && !op.run && !guarded.mutations.has(op.name) && !reservationMutations.has(op.name) && !localMutations.has(op.name)) {
          throw new Error("OPERATION_UNAVAILABLE: This mutation has no guarded submit path.");
        }
        const [ns, method] = op.name.split(".");
        const guardedApi = guarded.create(check);
        const target = (guardedApi as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[ns!];
        // Booking requests must never be repeated on an ambiguous timeout. The
        // interactive facade historically retries these; the CLI uses one call.
        let fn: ((...args: any[]) => unknown) | undefined = op.run ?? target?.[method!];
        if (op.name === "learn.download" || op.name === "learn.downloadMany") {
          fn = (...downloadArgs: unknown[]) => runCliLearnDownloadWithDeadline(op.name as "learn.download" | "learn.downloadMany", downloadArgs, deadline, check, task?.signal);
        }
        if (op.name === "library.book" || op.name === "library.cancel") {
          if (!permissions.has("library:book") || !permissions.has("library:read")) throw new Error("PERMISSION_REQUIRED: library:book");
          fn = op.name === "library.book"
            ? (seat: any, section: number, date: 0 | 1 = 0) => info.bookLibrarySeat(seat, section, date, owner, check)
            : (record: string) => info.cancelLibBooking(record, owner, check);
        }
        if (ns === "libroom") {
          if (!permissions.has("library:read")) throw new Error("PERMISSION_REQUIRED: library:read");
          const readOnly = { readOnlyInitialization: true };
          if (method === "list") fn = () => info.getLibRoomInfoList(owner, readOnly);
          if (method === "resources") fn = (date: string, kind: number) => info.getLibRoomResourceList(owner, date, kind, readOnly);
          if (method === "records") fn = () => info.getLibRoomRecords(owner, readOnly);
          if (method === "fuzzyMember") fn = (keyword: string) => info.fuzzySearchLibRoomMember(owner, keyword, readOnly);
          if (method === "book") fn = (room: any, start: string, end: string, members: number[] = []) => info.bookLibRoom(owner, room, start, end, members, check);
          if (method === "cancel") fn = (id: string) => info.cancelLibRoomBooking(owner, id, check);
        }
        if (ns === "kongjian" && op.mutation) {
          if (!permissions.has("kongjian:book")) throw new Error("PERMISSION_REQUIRED: kongjian:book");
          fn = method === "book"
            ? (url: string, details: any) => info.kongjianBook(url, details, check)
            : (id: string) => info.kongjianCancel(id, check);
        }
        if (op.name === "venue.cancel") {
          if (!permissions.has("venue:book")) throw new Error("PERMISSION_REQUIRED: venue:book");
          fn = (id: string) => venue.cancelReserve(id, check);
        }
        if (typeof fn !== "function") throw new Error("OPERATION_UNAVAILABLE: Update OneTHU.");
        await check();
        const data = await fn(...args);
        await check();
        if (op.name === "kongjian.page" && data && typeof data === "object") {
          const { fields: _fields, formAction: _action, ...publicPage } = data as Record<string, unknown>;
          return publicResult(publicPage);
        }
        return publicResult(data ?? null);
      } catch (error) { throw publicError(error); }
      finally { if (serializedWrite) writeBusy = false; }
  }
  if (guarded.internal) bindDesktopTasks({
    call: input => service.call(input),
    dispatch(input, grant, signal) { liveGrants.add(grant); return call(input, { grant, signal }); },
    resolveOperation(name) {
      const op = byName.get(name);
      // Read-only app services share the same account/permission guard as OH.
      // Recurring mutations remain limited to the reviewed download path.
      return op && !/^(tasks|plugins|notifications|im|agent|auth|config)\./.test(name) && (!op.mutation || name === "learn.download")
        ? { mutation: !!op.mutation, validate: args => validate(args, op.parameters) } : undefined;
    },
  });
  return service;
}
