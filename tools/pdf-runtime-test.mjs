/**
 * pdf.js v6 运行时垫片的回归测试（R27：手机端 PDF 报
 * 「n(...).getOrInsertComputed is not a function」）。
 *
 * 这个 bug 只在老内核 WebView 上出现，本机无法复现，所以只能靠断言守：
 * 先把这些 API 从原型上删掉（模拟老内核），再验证垫片补齐后语义与规范一致。
 * 同时守一条纪律——垫片必须不可枚举，不能污染 for...in。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/pdf-runtime-test.mjs
 */
import { ensurePdfRuntimeShims, hasModernPdfRuntime } from "../apps/desktop/src/lib/pdf-runtime.ts";

let pass = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exit(1);
  }
  pass += 1;
  console.log(`  ✓ ${label}`);
}

const NEW_APIS = [
  [Map.prototype, "getOrInsertComputed"],
  [Map.prototype, "getOrInsert"],
  [WeakMap.prototype, "getOrInsertComputed"],
  [WeakMap.prototype, "getOrInsert"],
  [Promise, "withResolvers"],
  [Math, "sumPrecise"],
];

console.log("[1] 模拟老内核：删掉新 API 后能力探测必须为 false");
{
  for (const [proto, name] of NEW_APIS) delete proto[name];
  ok(!hasModernPdfRuntime(), "缺 API 时 hasModernPdfRuntime() 为 false（→ 优先 legacy 构建）");
}

console.log("[2] 垫片补齐后能力探测为 true，且语义与规范一致");
{
  ensurePdfRuntimeShims();
  ok(hasModernPdfRuntime(), "补齐后 hasModernPdfRuntime() 为 true");
  ok(typeof Promise.withResolvers === "function", "Promise.withResolvers 已安装");

  let calls = 0;
  const m = new Map();
  const v1 = m.getOrInsertComputed("k", (k) => {
    calls += 1;
    return `computed:${k}`;
  });
  const v2 = m.getOrInsertComputed("k", () => {
    calls += 1;
    return "should-not-run";
  });
  ok(v1 === "computed:k" && v2 === "computed:k", "getOrInsertComputed 命中后返回缓存值");
  ok(calls === 1, "getOrInsertComputed 只计算一次（回调不会重复执行）");
  ok(m.get("k") === "computed:k", "getOrInsertComputed 把结果写回了 Map");

  const m2 = new Map([["a", 1]]);
  ok(m2.getOrInsert("a", 2) === 1, "getOrInsert 已存在时返回原值");
  ok(m2.getOrInsert("b", 2) === 2 && m2.get("b") === 2, "getOrInsert 不存在时写入并返回");

  const wm = new WeakMap();
  const key = {};
  ok(wm.getOrInsertComputed(key, () => 7) === 7, "WeakMap.getOrInsertComputed 可用");
  ok(wm.getOrInsertComputed(key, () => 9) === 7, "WeakMap.getOrInsertComputed 命中缓存");

  const d = Promise.withResolvers();
  ok(typeof d.resolve === "function" && typeof d.reject === "function" && d.promise instanceof Promise, "withResolvers 返回 {promise,resolve,reject}");
}

console.log("[3] 垫片纪律：不可枚举，且不覆盖已存在的原生实现");
{
  for (const [proto, name] of NEW_APIS) {
    ok(!Object.keys(proto).includes(name), `${name} 不在 Object.keys 里（不可枚举）`);
  }
  // 原生实现优先：塞一个假实现进去，再调垫片，不能被覆盖
  const sentinel = () => "native";
  Object.defineProperty(Map.prototype, "getOrInsert", { configurable: true, writable: true, value: sentinel });
  ensurePdfRuntimeShims();
  ok(Map.prototype.getOrInsert === sentinel, "已存在的方法不会被垫片覆盖");
}

console.log("[4] 真实调用点：loadPdfDoc 先按原生能力挑构建，再垫片兜底");
{
  const src = await import("node:fs").then((fs) => fs.readFileSync("apps/desktop/src/components/FilePreview.tsx", "utf8"));
  const body = src.slice(src.indexOf("async function loadPdfDoc"));
  ok(/ensurePdfRuntimeShims\(\)/.test(body), "loadPdfDoc 调用 ensurePdfRuntimeShims() 兜底主线程 API");
  ok(/const modernOk = hasModernPdfRuntime\(\)/.test(body), "loadPdfDoc 用 hasModernPdfRuntime() 决定顺序");
  ok(body.indexOf("hasModernPdfRuntime()") < body.indexOf("ensurePdfRuntimeShims()"), "探测在垫片之前（否则会被垫片污染成支持现代构建）");
  ok(/modernOk \? \(\[modern, legacy\]/.test(body) && /\[legacy, modern\]/.test(body), "缺 API 时把 legacy 排在前面（仍保留兜底）");
  ok(/\[FILE-PREVIEW\]/.test(body), "留了 logcat 可抓的 console 痕迹");
}

console.log("[5] Math.sumPrecise：缺失时 pdf.js 会静默退化成系统字体（MacRoman 乱码）");
{
  // R27 实测（课后练习题-01.pdf）：内核有 getOrInsertComputed 但缺 Math.sumPrecise 时，
  // pdf.js 现代构建的字体翻译逐字体抛 TypeError 并被吞掉，改用系统字体画"编码码位"——
  // 该 PDF 的内嵌子集字体只有 Mac(1,0) cmap，于是整页变成 ü Ä ñ ™ ≤ 这类 MacRoman 符号。
  for (const [proto, name] of NEW_APIS) delete proto[name];
  ok(!hasModernPdfRuntime(), "缺 Math.sumPrecise 也算老内核（→ 优先 legacy 构建）");

  ensurePdfRuntimeShims();
  ok(typeof Math.sumPrecise === "function", "垫片补上了 Math.sumPrecise");
  ok(hasModernPdfRuntime(), "垫片装好后探测为 true——正因如此，App 必须**先探测再垫片**（见 [4]/[6]）；" +
    "worker 是独立 realm，这里的垫片进不去，缺 API 时只能靠 legacy 构建兜住 worker");

  const sum = Math.sumPrecise([0.1, 0.2, 0.3]);
  ok(sum === 0.6, `补偿求和：0.1+0.2+0.3 === 0.6（朴素累加会得到 ${0.1 + 0.2 + 0.3}）`);
  ok(Math.sumPrecise([]) === 0, "空可迭代对象返回 0");
  ok(Math.sumPrecise(new Set([1, 2, 3])) === 6, "接受任意可迭代对象（Set）");
  ok(Math.sumPrecise([1e100, 1, -1e100]) === 1, "大数抵消后仍保留小数（补偿项生效）");
  let threw = false;
  try { Math.sumPrecise([1, "x"]); } catch { threw = true; }
  ok(threw, "元素非 number 时抛 TypeError（与规范一致）");
  ok(!Object.keys(Math).includes("sumPrecise"), "sumPrecise 不可枚举");
}

console.log("[6] 真实调用点：能力探测先于垫片，且没有引入 disableFontFace 之类的旁路");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync("apps/desktop/src/components/FilePreview.tsx", "utf8");
  const body = src.slice(src.indexOf("async function loadPdfDoc"));
  // 顺序反了就会被自己的垫片污染成"内核支持"，选中现代构建后在 worker 里继续炸（R27 真因）
  ok(body.indexOf("hasModernPdfRuntime()") < body.indexOf("ensurePdfRuntimeShims()"), "loadPdfDoc 先探测原生能力、再垫片");
  ok(/getDocument\(\{ data: dataUrlBytes\(dataUrl\) \}\)/.test(body), "getDocument 只传 data（不旁路字体）");
  ok(!/disableFontFace/.test(body), "不再使用 disableFontFace（它会让现代构建画出无字体文本）");
}


console.log("[7] 结构性守卫：pdf.js 现代构建用到的新内核 API 必须都在垫片清单里");
{
  // R27 的教训——漏一个 API 不会报错到 UI，只会让 pdf.js 静默降级（字体退化成系统字体）。
  // 升级 pdfjs-dist 时这条会先响，提醒把新依赖补进 ensurePdfRuntimeShims()。
  const fs = await import("node:fs");
  const worker = fs.readFileSync("apps/desktop/node_modules/pdfjs-dist/build/pdf.worker.mjs", "utf8");
  const main = fs.readFileSync("apps/desktop/node_modules/pdfjs-dist/build/pdf.mjs", "utf8");
  const src = fs.readFileSync("apps/desktop/src/lib/pdf-runtime.ts", "utf8");
  const shimBody = src.slice(src.indexOf("export function ensurePdfRuntimeShims"));
  const KNOWN = ["getOrInsertComputed", "withResolvers", "sumPrecise"];
  for (const api of KNOWN) {
    if (!worker.includes(api) && !main.includes(api)) continue; // 该版本不再依赖，跳过
    ok(shimBody.includes(api), `pdf.js 依赖 ${api} → 垫片清单里有它`);
  }
  // 反向：垫片清单里不该有 pdf.js 完全用不到的 API（避免清单虚胖）
  ok(/sumPrecise/.test(worker), "pdf.js 现代构建确实调用 Math.sumPrecise（本 bug 的根因）");
}

console.log(`\npdf 运行时垫片：${pass} 断言全部通过`);
