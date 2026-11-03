/** Persistent task engine shared by browser/native and independent Node hosts.
 * Storage, campus transport, local consent and IM delivery are injected ports. */
import { nextRun } from "./schedule.js";
import { copy, errorCode, fingerprint, stable, text, validateDraft } from "./validation.js";
import { schoolWatch } from "./watch.js";
import type { StoredTask, TaskDraft, TaskGrant, TaskManager, TaskManagerPorts, TaskOwner, TaskRecord, TaskRun, TaskState, TaskMigrationResult } from "./types.js";
export type * from "./types.js";
export { taskOperations, invokeTaskOperation } from "./operations.js";
export { nextRun, validateSchedule } from "./schedule.js";

const MAX_TASKS = 50, MAX_HISTORY = 30, MAX_LEDGER = 20_000, MAX_STATE_BYTES = 32 * 1024 * 1024;
const publicTask = ({ approved: _approved, history: _history, snapshot: _snapshot, notifications: _notifications, downloads: _downloads, ...task }: StoredTask): TaskRecord => copy(task);
const clockDefault = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms), clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) };

export async function createTaskManager(ports: TaskManagerPorts): Promise<TaskManager> {
  const clock = ports.clock ?? clockDefault;
  const tasks = new Map<string, StoredTask>();
  const active = new Map<string, { controller: AbortController; done: Promise<TaskRun> }>();
  let saving = Promise.resolve(), timer: unknown, started = false, closed = false, ticking = false, schedulerEpoch = 0;
  let storageFailure: unknown;
  let migrations: NonNullable<TaskState["migrations"]> = [];
  const ready = () => { if (closed) throw new Error("TASK_MANAGER_CLOSED"); if (storageFailure) throw new Error("TASK_STORAGE_UNAVAILABLE"); };
  async function save(): Promise<void> {
    const state: TaskState = { version: 1, tasks: [...tasks.values()].map(copy), migrations: copy(migrations) };
    if (JSON.stringify(state).length > MAX_STATE_BYTES) throw new Error("TASK_STORAGE_LIMIT");
    const write = saving.then(() => { if (storageFailure) throw new Error("TASK_STORAGE_UNAVAILABLE"); return ports.storage.save(state); });
    saving = write.catch(error => { storageFailure = error; for (const run of active.values()) run.controller.abort(); });
    return write;
  }
  async function owner(): Promise<TaskOwner> {
    ready(); const value = await ports.getOwner();
    if (!value?.id || !(typeof value.epoch === "string" || typeof value.epoch === "number")) throw new Error("TASK_ACCOUNT_REQUIRED");
    return { id: value.id, epoch: value.epoch };
  }
  const same = (a: TaskOwner | null, b: TaskOwner) => a?.id === b.id && a?.epoch === b.epoch;
  async function owned(id: string): Promise<StoredTask> {
    const current = await owner(), task = tasks.get(id);
    if (!task || task.owner !== current.id) throw new Error("TASK_NOT_FOUND");
    return task;
  }
  const cancel = (id: string) => active.get(id)?.controller.abort();
  async function consent(action: "create" | "update" | "resume", draft: TaskDraft, current: TaskOwner) {
    const checked = validateDraft(draft, ports);
    if (!await ports.authorizeGrant({ action, draft: copy(checked.draft), owner: current.id, scope: copy(checked.scope) })) throw new Error("TASK_CONSENT_REQUIRED");
    if (!same(await ports.getOwner(), current)) throw new Error("TASK_ACCOUNT_CHANGED");
    ready(); return checked;
  }
  const loaded = await ports.storage.load();
  if (loaded !== null) {
    if (loaded.version !== 1 || !Array.isArray(loaded.tasks) || loaded.tasks.length > MAX_TASKS || JSON.stringify(loaded).length > MAX_STATE_BYTES) throw new Error("TASK_STATE_INVALID");
    if (loaded.migrations !== undefined) {
      if (!Array.isArray(loaded.migrations) || loaded.migrations.length > 1000) throw new Error("TASK_STATE_INVALID");
      for (const entry of loaded.migrations) {
        text(entry.origin,"migrationOrigin"); text(entry.owner,"owner");
        if (!Array.isArray(entry.ids) || entry.ids.length > MAX_LEDGER) throw new Error("TASK_STATE_INVALID");
        entry.ids.forEach(id => text(id,"taskId"));
      }
      migrations = copy(loaded.migrations);
    }
    for (const raw of loaded.tasks) {
      if (!raw || raw.approved !== true || typeof raw.enabled !== "boolean" || !Number.isSafeInteger(raw.revision) || raw.revision < 1) throw new Error("TASK_STATE_INVALID");
      text(raw.id, "taskId"); text(raw.owner, "owner");
      if (tasks.has(raw.id)) throw new Error("TASK_STATE_INVALID");
      const checked = validateDraft(raw, ports);
      // A version/configuration change can narrow the registered allowlist. It
      // cannot silently broaden a previously approved operation/output scope.
      if (stable(checked.scope) !== stable(raw.scope)) throw new Error("TASK_SCOPE_CHANGED");
      if (!Array.isArray(raw.history) || !raw.snapshot || !raw.notifications || !raw.downloads) throw new Error("TASK_STATE_INVALID");
      const task: StoredTask = { ...copy(raw), ...checked.draft, history: copy(raw.history.slice(-MAX_HISTORY)) };
      for (const ledger of [task.notifications, task.downloads]) {
        if (Array.isArray(ledger) || Object.keys(ledger).length > MAX_LEDGER) throw new Error("TASK_STATE_INVALID");
        for (const attempt of Object.values(ledger)) if (attempt.state === "pending") attempt.state = "unknown";
      }
      if (task.lastRun?.status === "running") {
        task.lastRun.status = "interrupted"; task.lastRun.finishedAt = clock.now(); task.lastRun.errors.push("TASK_PROCESS_INTERRUPTED");
        task.history.push(copy(task.lastRun)); task.history = task.history.slice(-MAX_HISTORY);
        if (task.enabled) task.nextRunAt = clock.now();
      }
      tasks.set(task.id, task);
    }
    await save();
  }
  function checkedLedger(task: StoredTask, kind: "notifications" | "downloads", added: number) {
    if (Object.keys(task[kind]).length + added > MAX_LEDGER) throw new Error("TASK_LEDGER_LIMIT");
  }
  async function wait(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new Error("TASK_CANCELLED")); return; }
      const done = () => { signal.removeEventListener("abort", abort); resolve(); };
      const handle = clock.setTimeout(done, ms);
      const abort = () => { clock.clearTimeout(handle); reject(new Error("TASK_CANCELLED")); };
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  function launch(task: StoredTask, current: TaskOwner): Promise<TaskRun> {
    ready();
    if (tasks.get(task.id) !== task || !task.enabled) return Promise.reject(new Error("TASK_CANCELLED"));
    if (active.has(task.id)) return Promise.reject(new Error("TASK_ALREADY_RUNNING"));
    // One manager shares one campus session. Reserve this slot synchronously
    // before any await so scheduled and manual requests cannot form a burst.
    if (active.size) return Promise.reject(new Error("TASK_RUN_BUSY"));
    const controller = new AbortController(), revision = task.revision;
    const allowedResources = new Set<string>();
    const run: TaskRun = { id: crypto.randomUUID(), taskId: task.id, startedAt: clock.now(), status: "running", changes: [], downloaded: 0, notified: 0, errors: [] };
    const check = async () => {
      ready();
      if (controller.signal.aborted || run.status !== "running" || tasks.get(task.id) !== task || task.revision !== revision || !task.enabled) throw new Error("TASK_CANCELLED");
      if (!same(await ports.getOwner(), current) || task.owner !== current.id) throw new Error("TASK_ACCOUNT_CHANGED");
      if (controller.signal.aborted || run.status !== "running" || task.revision !== revision || !task.enabled) throw new Error("TASK_CANCELLED");
    };
    const grant: TaskGrant = Object.freeze({ ...copy(task.scope), operations: Object.freeze([...task.scope.operations]) as unknown as string[], channels: Object.freeze([...task.scope.channels]) as unknown as string[],
      taskId: task.id, owner: task.owner, revision,
      assertActive: check,
      assertAllowed: async (operation: string, args: unknown[]) => {
        await check();
        if (!task.scope.operations.includes(operation)) throw new Error("TASK_OPERATION_OUTSIDE_GRANT");
        if (task.template.kind === "operation") {
          if (operation !== task.template.operation || stable(args) !== stable(task.template.args)) throw new Error("TASK_ARGUMENTS_OUTSIDE_GRANT");
        } else if (operation === "learn.courses") {
          if (stable(args) !== stable(task.template.semesterId ? [task.template.semesterId] : [])) throw new Error("TASK_ARGUMENTS_OUTSIDE_GRANT");
        } else if (operation === "learn.resources" || operation === "learn.homework") {
          if (args.length !== 1 || !task.template.courseIds.includes(args[0] as string)) throw new Error("TASK_ARGUMENTS_OUTSIDE_GRANT");
        } else if (operation === "learn.download") {
          if (args.length !== 2 || args[1] !== task.scope.outputDir || !allowedResources.has(args[0] as string)) throw new Error("TASK_OUTPUT_OUTSIDE_GRANT");
        }
      },
    });
    const dispatch = async (operation: string, args: unknown[]) => {
      await grant.assertAllowed(operation, args);
      const result = await ports.dispatch(operation, copy(args), { confirmationGrant: grant, signal: controller.signal });
      await check(); return result;
    };
    const read = async (operation: string, args: unknown[]) => {
      for (let attempt = 0; ; attempt++) {
        try { return await dispatch(operation, args); }
        catch (error) {
          await check();
          const code = errorCode(error);
          // Retry transient reads only. Authentication, permission and schema
          // failures require intervention; writes/notifications never use this.
          if (attempt >= 2 || /(?:AUTH|ACCOUNT|SESSION|PERMISSION|INVALID|REQUIRED|UNAVAILABLE|DISABLED|NOT_FOUND|CANCELLED)/.test(code)) throw error;
          await wait(1000 * 2 ** attempt, controller.signal);
        }
      }
    };
    async function notify(keys: string[], message: string): Promise<number> {
      let delivered = 0;
      for (const channel of task.scope.channels) {
        await check();
        const fresh = keys.filter(key => !task.notifications[`${channel}:${key}`]);
        if (!fresh.length) continue;
        checkedLedger(task, "notifications", fresh.length);
        const idempotencyKey = `onethu-task:${task.id}:${await fingerprint([task.owner, channel, fresh.slice().sort()])}`;
        for (const key of fresh) task.notifications[`${channel}:${key}`] = { state: "pending", at: clock.now() };
        await save(); await check();
        try {
          await ports.notify(channel, message, idempotencyKey, { confirmationGrant: grant, signal: controller.signal });
          await check();
          for (const key of fresh) task.notifications[`${channel}:${key}`]!.state = "succeeded";
          delivered++;
        } catch (error) {
          for (const key of fresh) task.notifications[`${channel}:${key}`]!.state = "unknown";
          run.errors.push(`TASK_NOTIFICATION_UNKNOWN:${errorCode(error)}`);
          if (controller.signal.aborted) throw error;
        }
        await save();
      }
      return delivered;
    }
    async function download(ref: string, key: string): Promise<boolean> {
      await check();
      if (task.downloads[key]) return false;
      checkedLedger(task, "downloads", 1);
      task.downloads[key] = { state: "pending", at: clock.now() }; await save(); await check();
      try {
        await dispatch("learn.download", [ref, task.scope.outputDir]);
        task.downloads[key]!.state = "succeeded"; await save(); return true;
      } catch (error) {
        task.downloads[key]!.state = "unknown";
        run.errors.push(`TASK_DOWNLOAD_UNKNOWN:${errorCode(error)}`); await save();
        await check(); return false;
      }
    }
    const done = (async () => {
      // Schedule the next occurrence before work. A crash gets one immediate
      // recovery run, not every missed interval; dispatch side effects have ledgers.
      task.lastRun = run;
      task.nextRunAt = nextRun(task.schedule, clock.now());
      await save();
      try {
        await check();
        if (task.template.kind === "school-watch") {
          await schoolWatch(task, run, { now: () => clock.now(), read, download, notify, allowResource: ref => allowedResources.add(ref) });
        } else {
          const { operation, args } = task.template;
          const operationDef = ports.resolveOperation?.(operation);
          if (!operationDef) throw new Error("TASK_OPERATION_NOT_ALLOWED");
          operationDef.validate(args);
          if (operationDef.mutation) {
            const key = `operation:${revision}:${await fingerprint(args)}`;
            allowedResources.add(args[0] as string);
            if (await download(args[0] as string, key)) run.downloaded++;
          } else {
            const result = await read(operation, args);
            const hash = await fingerprint(result);
            if (task.snapshot.operation?.hash !== hash) {
              run.changes.push({ kind: task.snapshot.operation ? "changed" : "new", id: operation, title: operation });
              run.notified += await notify([`operation:${task.snapshot.operation?.hash ?? "new"}:${hash}`], `OneTHU · ${task.name}\nUpdated: ${operation}`);
              task.snapshot.operation = { hash, title: operation };
            }
          }
        }
        await check(); run.status = run.errors.length ? "partial" : "succeeded";
      } catch (error) {
        const code = errorCode(error);
        run.status = controller.signal.aborted || code === "TASK_ACCOUNT_CHANGED" ? "cancelled" : "failed";
        run.errors.push(code);
      } finally {
        run.finishedAt = clock.now(); run.errors = [...new Set(run.errors)];
        if (tasks.get(task.id) === task) {
          task.history.push(copy(run)); task.history = task.history.slice(-MAX_HISTORY);
          task.lastRun = copy(run); task.updatedAt = clock.now();
          await save();
        }
      }
      return copy(run);
    })();
    active.set(task.id, { controller, done });
    void done.finally(() => { if (active.get(task.id)?.done === done) active.delete(task.id); }).catch(() => undefined);
    return done;
  }
  const manager: TaskManager = {
    async list() { const current = await owner(); return [...tasks.values()].filter(task => task.owner === current.id).map(publicTask); },
    async get(id) { return publicTask(await owned(id)); },
    async create(draft) {
      const current = await owner(), checked = await consent("create", draft, current);
      if (tasks.size >= MAX_TASKS) throw new Error("TASK_COUNT_LIMIT");
      const now = clock.now();
      const task: StoredTask = { ...checked.draft, id: crypto.randomUUID(), owner: current.id, revision: 1, enabled: true, createdAt: now, updatedAt: now,
        nextRunAt: checked.draft.schedule.kind === "once" ? Math.max(now, Date.parse(checked.draft.schedule.runAt)) : nextRun(checked.draft.schedule, now),
        scope: checked.scope, approved: true, history: [], snapshot: {}, notifications: {}, downloads: {} };
      tasks.set(task.id, task); await save(); return publicTask(task);
    },
    async update(id, draft) {
      const task = await owned(id), current = await owner(), revision = task.revision;
      const checked = await consent("update", draft, current);
      if (tasks.get(id) !== task || task.revision !== revision) throw new Error("TASK_CHANGED");
      cancel(id); task.revision++; Object.assign(task, checked.draft, { scope: checked.scope, updatedAt: clock.now(), nextRunAt: nextRun(checked.draft.schedule, clock.now()) });
      await save(); return publicTask(task);
    },
    async pause(id) { const task = await owned(id); task.enabled = false; task.revision++; task.updatedAt = clock.now(); cancel(id); await save(); return publicTask(task); },
    async resume(id, options) {
      const current = await owner(), task = tasks.get(id);
      if (!task || (task.owner !== current.id && options?.rebind !== true)) throw new Error("TASK_NOT_FOUND");
      const revision = task.revision;
      const checked = await consent("resume", task, current);
      if (tasks.get(id) !== task || task.revision !== revision) throw new Error("TASK_CHANGED");
      cancel(id);
      if (task.owner !== current.id) { task.snapshot = {}; task.history = []; task.notifications = {}; task.downloads = {}; delete task.lastRun; }
      task.owner = current.id; task.scope = checked.scope; task.enabled = true; task.revision++; task.updatedAt = clock.now(); task.nextRunAt = clock.now();
      await save(); return publicTask(task);
    },
    async remove(id) { await owned(id); cancel(id); tasks.delete(id); await save(); },
    async run(id) {
      const epoch = schedulerEpoch;
      const task = await owned(id); if (!task.enabled) throw new Error("TASK_PAUSED");
      const revision = task.revision, current = await owner();
      if (current.id !== task.owner) throw new Error("TASK_ACCOUNT_CHANGED");
      if (schedulerEpoch !== epoch || task.revision !== revision) throw new Error("TASK_CANCELLED");
      return launch(task, current);
    },
    async history(id) { return copy((await owned(id)).history); },
    async importState(origin, input, channelMap = {}, options = {}) {
      const current = await owner(); text(origin,"migrationOrigin");
      if (!input || input.version !== 1 || !Array.isArray(input.tasks) || input.tasks.length > MAX_TASKS || JSON.stringify(input).length > MAX_STATE_BYTES) throw new Error("TASK_STATE_INVALID");
      if (!channelMap || Array.isArray(channelMap) || Object.keys(channelMap).length > 50) throw new Error("TASK_CHANNEL_MAPPING_INVALID");
      for (const [from,to] of Object.entries(channelMap)) { text(from,"channel");text(to,"channel"); if (from.split(':')[0] !== to.split(':')[0]) throw new Error("TASK_CHANNEL_MAPPING_INVALID"); }
      const candidates:StoredTask[]=[];
      const seen=new Set<string>();
      for (const raw of input.tasks) {
        if (!raw || raw.owner !== current.id) continue;
        if (raw.approved !== true || typeof raw.enabled !== 'boolean' || !Number.isSafeInteger(raw.revision) || raw.revision < 1) throw new Error("TASK_STATE_INVALID");
        text(raw.id,"taskId"); if (seen.has(raw.id)) throw new Error("TASK_STATE_INVALID"); seen.add(raw.id);
        const task=copy(raw), original=validateDraft(task,ports);
        if (stable(original.scope) !== stable(task.scope)) throw new Error("TASK_SCOPE_CHANGED");
        if (!Array.isArray(task.history) || !task.snapshot || Array.isArray(task.snapshot) || !task.notifications || !task.downloads) throw new Error("TASK_STATE_INVALID");
        if (![task.createdAt,task.updatedAt].every(Number.isFinite) || task.nextRunAt !== null && !Number.isFinite(task.nextRunAt)) throw new Error("TASK_STATE_INVALID");
        for (const ledger of [task.notifications,task.downloads]) {
          if (Array.isArray(ledger) || Object.keys(ledger).length > MAX_LEDGER) throw new Error("TASK_STATE_INVALID");
          for (const value of Object.values(ledger)) { if (!value || !['pending','succeeded','unknown'].includes(value.state) || !Number.isFinite(value.at)) throw new Error("TASK_STATE_INVALID"); if(value.state==='pending')value.state='unknown'; }
        }
        task.template.channels = (task.template.channels ?? []).map(id => channelMap[id] ?? id);
        const checked=validateDraft(task,ports);task.scope=checked.scope;
        // Rename receipt keys together with the exact same recipient binding.
        // A transferred completed send/download must never be repeated.
        task.notifications=Object.fromEntries(Object.entries(task.notifications).map(([key,value])=>{
          const old=Object.keys(channelMap).find(channel=>key.startsWith(channel+':'));
          return [old ? channelMap[old]+key.slice(old.length) : key,value];
        }));
        task.history=task.history.slice(-MAX_HISTORY);
        if(task.lastRun?.status==='running'){
          task.lastRun.status='interrupted';task.lastRun.finishedAt=clock.now();task.lastRun.errors=[...task.lastRun.errors,'TASK_PROCESS_INTERRUPTED'];
          task.history.push(copy(task.lastRun));task.history=task.history.slice(-MAX_HISTORY);
        }
        candidates.push(task);
      }
      if (!same(await ports.getOwner(),current)) throw new Error("TASK_ACCOUNT_CHANGED");
      // Only the private host handoff calls replaceOwner, after retiring the
      // previous scheduler. Model/CLI operation JSON cannot select this mode.
      if(options.replaceOwner){
        if(started||active.size)throw new Error("TASK_HANDOFF_REQUIRES_STOP");
        for(const task of tasks.values())if(task.owner===current.id)tasks.delete(task.id);
        migrations=migrations.filter(entry=>entry.owner!==current.id);
      }
      const previous=migrations.find(entry=>entry.origin===origin&&entry.owner===current.id), ids=new Set(previous?.ids??[]);
      const result:TaskMigrationResult={imported:[],skipped:[],conflicts:[],ignored:input.tasks.length-candidates.length};
      const additions:StoredTask[]=[];
      const identity=(task:StoredTask)=>stable({name:task.name,schedule:task.schedule,template:task.template,scope:task.scope});
      for (const task of candidates) {
        if(ids.has(task.id)){result.skipped.push(task.id);continue;}
        const existing=tasks.get(task.id);
        if(existing){
          if(existing.owner===current.id&&identity(existing)===identity(task))result.skipped.push(task.id);
          else {result.conflicts.push({id:task.id,reason:'id-conflict'});continue;}
          ids.add(task.id);continue;
        }
        if([...tasks.values(),...additions].some(row=>row.owner===current.id&&identity(row)===identity(task))){result.skipped.push(task.id);ids.add(task.id);continue;}
        if(tasks.size+additions.length>=MAX_TASKS){result.conflicts.push({id:task.id,reason:'capacity'});continue;}
        additions.push(task);result.imported.push(task.id);ids.add(task.id);
      }
      if(ids.size>MAX_LEDGER||!previous&&migrations.length>=1000)throw new Error("TASK_MIGRATION_LIMIT");
      // Ledger and imported rows share one atomic storage transaction.
      additions.forEach(task=>tasks.set(task.id,task));
      migrations=migrations.filter(entry=>entry!==previous);migrations.push({origin,owner:current.id,ids:[...ids]});
      await save();return result;
    },
    async tick() {
      if (closed || storageFailure || ticking || active.size) return;
      ticking = true;
      const epoch = schedulerEpoch;
      try {
        const observed = await ports.getOwner(); if (!observed?.id) return;
        const current = { id: observed.id, epoch: observed.epoch };
        const due = [...tasks.values()]
          .filter(task => task.enabled && task.owner === current.id && task.nextRunAt !== null && task.nextRunAt <= clock.now())
          .map(task => ({ task, revision: task.revision }));
        for (const { task, revision } of due) {
          if (closed || storageFailure || schedulerEpoch !== epoch || active.size) break;
          // Recheck after each preceding run and after asynchronous account
          // lookup. stop/update/pause/remove must invalidate queued snapshots.
          if (tasks.get(task.id) !== task || task.revision !== revision || !task.enabled || task.nextRunAt === null || task.nextRunAt > clock.now()) continue;
          if (!same(await ports.getOwner(), current)) break;
          if (closed || storageFailure || schedulerEpoch !== epoch || active.size) break;
          if (tasks.get(task.id) !== task || task.revision !== revision || !task.enabled) continue;
          try { await launch(task, current); } catch { /* persistence failures close the next iteration */ }
        }
      } finally { ticking = false; }
    },
    start() {
      ready(); if (started) return; started = true;
      const epoch = ++schedulerEpoch;
      const loop = async () => { if (!started || closed || schedulerEpoch !== epoch) return; try { await manager.tick(); } finally { if (started && !closed && schedulerEpoch === epoch) timer = clock.setTimeout(() => { void loop().catch(() => undefined); }, 15_000); } };
      void loop().catch(() => undefined);
    },
    async stop() { started = false; schedulerEpoch++; if (timer !== undefined) clock.clearTimeout(timer); for (const run of active.values()) run.controller.abort(); await Promise.allSettled([...active.values()].map(run => run.done)); await saving; },
    async close() { await manager.stop(); closed = true; await ports.storage.close?.(); },
  };
  return manager;
}
