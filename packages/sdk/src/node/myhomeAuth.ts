/** MyHome renews through the fixed legacy service flow before verifying its page. */
import { resolveLegacyCampusLogin, type LegacyCampusRuntime } from './legacyCampusAuth.js';

export function resolveMyhomeLogin(runtime: LegacyCampusRuntime, signal?: AbortSignal): Promise<void> {
  return resolveLegacyCampusLogin(runtime, 'myhome', signal);
}
