/** Public display label only. Never changes a fingerprint or registers trust. */
export function formatTrustDeviceName(deviceName: string = "", fallback = "此设备"): string {
  const clean = (value: string) => value.normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, " ")
    .replace(/\s+/gu, " ").trim();
  let name = clean(deviceName);
  const existing = /^OneTHU（(.*)）$/u.exec(name);
  if (existing) name = clean(existing[1]!);
  name = name || clean(fallback) || "此设备";
  return `OneTHU（${Array.from(name).slice(0, 40).join("")}）`;
}
