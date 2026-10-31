import type { CookieRecord, SessionData } from "@onethu/core";

export interface GatewayGuiAccount {
  username: string;
  state: string;
  fingerprint: string;
  finger3?: string;
}
export interface GatewaySharedAccount {
  username: string | null;
  epoch: number;
  bootstrapAllowed?: boolean;
  tombstone?: boolean;
  session: { state: string; authenticated?: boolean; twoFactor?: { pending?: boolean } };
}
export interface GatewayAccountFence { expectedAccount: string; expectedEpoch: number }
interface StartPorts {
  gui: () => GatewayGuiAccount;
  shared: () => Promise<GatewaySharedAccount>;
  cookies: () => Promise<{ cookies: CookieRecord[] }>;
  adopt: (snapshot: SessionData, expectedEpoch: number, reason: "bootstrap") => Promise<GatewaySharedAccount>;
}

const changed = (): never => { throw new Error("CLI_SHARED_SESSION_CHANGED"); };
function assertGui(expected: GatewayGuiAccount, current: GatewayGuiAccount): void {
  if (current.state !== "ready" || current.username !== expected.username || current.fingerprint !== expected.fingerprint || current.finger3 !== expected.finger3) changed();
}
function checkShared(shared: GatewaySharedAccount, username: string): "ready" | "bootstrap" {
  if (!Number.isSafeInteger(shared.epoch) || shared.tombstone || shared.username && shared.username !== username) changed();
  if (shared.session.twoFactor?.pending || shared.session.state === "need-2fa") throw new Error("AUTH_IN_PROGRESS");
  if (shared.username === username && shared.session.state === "ready" && shared.session.authenticated !== false) return "ready";
  // An existing owner, even the same account, keeps its own recovery/login
  // lifecycle. Starting a proxy is not permission to replace that session.
  if (shared.username !== null || !shared.bootstrapAllowed || shared.session.state !== "idle") throw new Error("GATEWAY_LOGIN_REQUIRED");
  return "bootstrap";
}

/** Start can bootstrap an empty eligible daemon once. A ready daemon is already
 * authoritative: never re-probe, replace its jar, or synchronize CLI policy. */
export async function prepareCampusGatewayStart(ports: StartPorts): Promise<GatewayAccountFence> {
  const gui = { ...ports.gui() };
  if (gui.state !== "ready" || !gui.username || !gui.fingerprint) throw new Error("GATEWAY_LOGIN_REQUIRED");
  const shared = await ports.shared();
  assertGui(gui, ports.gui());
  if (checkShared(shared, gui.username) === "ready") return { expectedAccount: gui.username, expectedEpoch: shared.epoch };

  const native = await ports.cookies();
  assertGui(gui, ports.gui());
  const latest = await ports.shared();
  assertGui(gui, ports.gui());
  if (latest.epoch !== shared.epoch || latest.username !== shared.username) changed();
  if (checkShared(latest, gui.username) !== "bootstrap") changed();
  const adopted = await ports.adopt({
    username: gui.username, fingerprint: gui.fingerprint, finger3: gui.finger3,
    cookiesJson: JSON.stringify(native.cookies), savedAt: Date.now(),
  }, shared.epoch, "bootstrap");
  assertGui(gui, ports.gui());
  if (checkShared(adopted, gui.username) !== "ready") changed();
  return { expectedAccount: gui.username, expectedEpoch: adopted.epoch };
}
