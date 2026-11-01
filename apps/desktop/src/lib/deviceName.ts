import { formatTrustDeviceName } from "@onethu/core";
import { isTauri } from "./transport.js";

let nativeName: Promise<string> | undefined;
/** Resolve lazily when existing login code asks to trust this installation. */
export async function trustDeviceName(fingerprint = ""): Promise<string> {
  nativeName ??= (async () => {
    if (!isTauri) return "";
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("device_display_name");
    } catch { return ""; } // An older dev shell can still run the current UI.
  })();
  const name = await nativeName;
  if (name.trim()) return formatTrustDeviceName(name);
  let platform = typeof navigator === "undefined" ? "此设备" : /mac/i.test(navigator.platform) ? "Mac" : /win/i.test(navigator.platform) ? "Windows" : "此设备";
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (await invoke<boolean>("os_is_android")) platform = "Android";
    } catch { /* Platform label remains usable without native metadata. */ }
  }
  // Existing identity only: no makeFingerprint, store writes or school calls.
  const suffix = fingerprint.replace(/[^a-z0-9]/gi, "").slice(-6);
  return formatTrustDeviceName(platform + (suffix ? ` · ${suffix}` : ""));
}
