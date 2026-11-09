/** ISeating authenticates only with a real token and matching school user ID. */
import { resolveLegacyCampusLogin, type LegacyCampusRuntime } from './legacyCampusAuth.js';

export function resolveSeatLogin(runtime: LegacyCampusRuntime, signal?: AbortSignal): Promise<void> {
  return resolveLegacyCampusLogin(runtime, 'seat', signal);
}
