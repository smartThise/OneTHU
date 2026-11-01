/** 洗衣机设备编号 → 设备名称映射（用户 2026-11-01 提供的对应关系）。
 *  he=波轮 / hr=滚筒 / wm=洗鞋机 / dr=烘干机；hs 与纯数字保持原编号。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, (route) => route.abort());
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root") !== null, null, { timeout: 20000 });
  const got = await page.evaluate(async () => {
    const mod = await import("/src/pages/info/WasherTab.tsx");
    return ["he001", "HR-02", "wm1", "dr9", "hs01", "12345", "", "he"].map((name) => [name, mod.washerDisplayName(name)]);
  });
  const expected = [["he001", "波轮洗衣机"], ["HR-02", "滚筒洗衣机"], ["wm1", "洗鞋机"], ["dr9", "烘干机"], ["hs01", null], ["12345", null], ["", null], ["he", "波轮洗衣机"]];
  assert.deepEqual(got, expected);
  console.log("洗衣机设备名映射：he/hr/wm/dr 已替换，hs 与纯数字保持原编号 ✓");
} finally {
  await browser.close();
}
