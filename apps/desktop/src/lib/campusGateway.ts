import { adoptSharedSession, ensureSharedRuntime, exportNativeSessionCookies, getSharedRuntimeStatus, sharedAccountGuard } from "./sharedRuntime.js";
import { prepareCampusGatewayStart, type GatewayAccountFence } from "./campusGatewayStart.js";

export type CampusGatewayAction = "status" | "start" | "stop" | "setup" | "credentials" | "trust" | "untrust" | "system-enable" | "system-disable" | "open-browser" | "client-prepare";

export interface CampusGatewayStatus {
  running: boolean;
  endpoint?: { host: string; port: number } | null;
  systemEndpoint?: { host: string; port: number } | null;
  account?: { account?: string | null; state?: string; authenticated?: boolean; epoch?: number } | null;
  certificate?: { path?: string; fingerprint?: string; ready?: boolean; trusted?: boolean } | null;
  systemProxy?: { enabled?: boolean; supported?: boolean; recoveryRequired?: boolean; coexistence?: boolean; activeServices?: string[] } | null;
  allowedOrigins?: string[];
  managementUrl?: string | null;
  pacUrl?: string | null;
  lastError?: unknown;
  capabilities?: {trustedMiniPrograms?:boolean};
}

export interface CampusGatewayCredentials {
  username: string;
  password: string;
}

/** Desktop-private control plane. Credentials are requested only by an explicit
 * reveal action and must never enter shared state, storage or console output. */
export async function campusGatewayRequest<T>(action: CampusGatewayAction): Promise<T> {
  await ensureSharedRuntime();
  const { invoke } = await import("@tauri-apps/api/core");
  let fence: GatewayAccountFence | undefined;
  if (action === "client-prepare") fence = await sharedAccountGuard((await import("./clients.js")).session.username);
  if (action === "start") {
    const { session } = await import("./clients.js");
    fence = await prepareCampusGatewayStart({
      gui: () => ({ username: session.username, state: session.state, fingerprint: session.fingerprint, finger3: session.finger3 }),
      shared: getSharedRuntimeStatus,
      cookies: exportNativeSessionCookies,
      adopt: adoptSharedSession,
    });
  }
  // SDK checks this fence inside its exclusive control queue; a frontend read
  // alone cannot protect an account switch between preparation and dispatch.
  return invoke<T>("cli_daemon_request", { method: "gateway.control", params: { action, ...(action !== "status" ? { confirm: true } : {}), ...fence } });
}
