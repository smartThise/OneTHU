/**
 * pdf.js v6 的运行时依赖与垫片（R27 手机端 PDF 渲染失败修复）。
 *
 * 背景（2026-09-22 用户实录）：安卓手机预览 PDF 报
 * 「第 x 页渲染失败：n(...).getOrInsertComputed is not a function」。
 *
 * pdfjs-dist v6 的现代构建依赖若干新内核 API：
 *   - `Map/WeakMap.prototype.getOrInsertComputed`（Chromium 137+）
 *   - `Promise.withResolvers`（Chromium 119+）
 *   - `Math.sumPrecise`（ES2026 提案，Chromium 更晚才有）
 * 关键点是它**在渲染阶段**才调用这些 API——`getDocument()` 本身不抛错，所以
 * "解析失败就换 legacy 构建"这条既有兜底永远不会触发，用户看到的是渲染期 TypeError。
 * legacy 构建自带 core-js 垫片，老内核 WebView 可用。
 *
 * R27 定论（2026-09-22，adb + WebView CDP 在真机上抓到）：`Math.sumPrecise` 缺失时，
 * pdf.js 的字体修复 `checkAndRepair()`（在 **worker** 里跑）抛异常并被吞掉，退化成
 * "按名字找系统字体"（`local(SimSun)` 等）。该 PDF 的内嵌子集字体只有 Mac(1,0) cmap、
 * 且不带 ToUnicode，于是整页画成 MacRoman 符号（`ü Ä ñ ™ ≤`），只有少数汉字可读——
 * 即用户看到的"大部分乱码、少部分可读"。安卓没有 SimSun/微软雅黑/Consolas，所以只有手机炸；
 * 电脑的 WebView2 原生带该 API，故一直正常。
 *
 * **关键约束：垫片只覆盖主线程，worker 是独立 realm，装不进去。**
 * 因此 `hasModernPdfRuntime()` 必须在 `ensurePdfRuntimeShims()` **之前**调用——它问的是
 * "内核原生是否具备"，不是"垫片补完后是否具备"。顺序反了就会被自己的垫片污染成 true，
 * 选中现代构建后在 worker 里继续炸。缺 API 时正确的做法是走 legacy 构建：
 * 它的 worker 里也打包了 core-js（含 `Math.sumPrecise`），这才是真正能兜住 worker 的那层。
 *
 * 两层保险：
 *   ① `hasModernPdfRuntime()` 按**原生**能力挑构建（缺 API 时优先 legacy）；
 *   ② `ensurePdfRuntimeShims()` 补主线程最小垫片（现代构建的主线程也用到这些 API）。
 *
 * 单独成模块是为了可测：`tools/pdf-runtime-test.mjs` 会先把这些 API 删掉，
 * 再验证垫片语义（手机上无法复现的 bug，只能靠这类断言守）。
 */

type PdfRuntimeProto = {
  getOrInsertComputed?: (key: unknown, cb: (k: unknown) => unknown) => unknown;
  getOrInsert?: (key: unknown, value: unknown) => unknown;
};

type PromiseWithResolvers = {
  withResolvers?: <T>() => { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (r?: unknown) => void };
};

type MathSumPrecise = {
  sumPrecise?: (items: Iterable<number>) => number;
};

/** 内核**原生**是否具备 pdf.js v6 现代构建所需的全部 API。
 *  必须在 `ensurePdfRuntimeShims()` 之前调用：pdf.js 的字体修复在 worker 里跑，
 *  主线程垫片覆盖不到 worker，被垫片污染的 true 会让现代构建在 worker 里静默降级。 */
export function hasModernPdfRuntime(): boolean {
  return (
    typeof (Map.prototype as PdfRuntimeProto).getOrInsertComputed === "function" &&
    typeof (WeakMap.prototype as PdfRuntimeProto).getOrInsertComputed === "function" &&
    typeof (Promise as PromiseWithResolvers).withResolvers === "function" &&
    typeof (Math as MathSumPrecise).sumPrecise === "function"
  );
}

/** 补齐缺失的运行时 API（已存在则不动）。语义按规范实现，走 this.has/get/set 以兼容子类。 */
export function ensurePdfRuntimeShims(): void {
  const install = (proto: object, name: string, value: unknown): void => {
    if (typeof (proto as Record<string, unknown>)[name] === "function") return;
    // defineProperty：默认不可枚举，避免 for...in 遍历到原型上的补丁
    Object.defineProperty(proto, name, { configurable: true, writable: true, value });
  };

  for (const proto of [Map.prototype, WeakMap.prototype]) {
    install(proto, "getOrInsertComputed", function (this: Map<unknown, unknown>, key: unknown, cb: (k: unknown) => unknown) {
      if (this.has(key)) return this.get(key);
      const v = cb(key);
      this.set(key, v);
      return v;
    });
    install(proto, "getOrInsert", function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    });
  }

  install(Promise, "withResolvers", function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });

  // Neumaier 补偿求和（规范要求比朴素累加更精确）。pdf.js 用它在字体翻译里算累计量，
  // 缺了它会逐字体抛 TypeError 并被吞掉，退化成系统字体渲染（见文件头注释）。
  install(Math, "sumPrecise", function (items: Iterable<number>): number {
    let sum = 0;
    let compensation = 0;
    for (const value of items) {
      if (typeof value !== "number") throw new TypeError("Math.sumPrecise: 元素必须是 number");
      const t = sum + value;
      compensation += Math.abs(sum) >= Math.abs(value) ? sum - t + value : value - t + sum;
      sum = t;
    }
    return sum + compensation;
  });
}
