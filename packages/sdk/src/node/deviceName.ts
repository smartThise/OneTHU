import { hostname, platform } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { formatTrustDeviceName } from '@onethu/core';

const exec = promisify(execFile);
let label: Promise<string> | undefined;

export async function resolveNodeDeviceName(host: {
  platform: string; computerName?: () => string | Promise<string>; hostName: () => string;
}): Promise<string> {
  let name = '';
  try { name = (await host.computerName?.())?.trim() ?? ''; } catch { /* Restricted display-name read. */ }
  try { name ||= host.hostName(); } catch { /* Restricted host environment. */ }
  return formatTrustDeviceName(name, host.platform === 'win32' ? 'Windows' : host.platform === 'darwin' ? 'Mac' : 'CLI');
}

/** Same OS display-name policy as the GUI, with no account or hardware IDs. */
export function trustDeviceName(): Promise<string> {
  return label ??= resolveNodeDeviceName({
    platform: platform(), hostName: hostname,
    computerName: platform() === 'win32' ? () => process.env.COMPUTERNAME ?? '' : platform() === 'darwin' ? async () => {
        const result = await exec('/usr/sbin/scutil', ['--get', 'ComputerName'], { timeout: 1500, maxBuffer: 2048, encoding: 'utf8' });
        return result.stdout;
    } : undefined,
  });
}
