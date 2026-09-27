/**
 * 极简 DOM / 存储替身（给 node 单测跑真实的主题与取色模块用）。
 *
 * 只实现被测代码真正碰到的那几个 API（createElement/getElementById/head.appendChild/dataset/
 * style/classList/localStorage/matchMedia）——缺什么就直接报错，宁可炸也不要假通过。
 * 断言的是 dataset 与注入的样式文本（结构），不是渲染结果（node 里没有渲染可言）。
 */
const store = new Map();
const styles = new Map();
const documentElement = {
  dataset: {},
  style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
};

globalThis.document = {
  documentElement,
  head: {
    appendChild(el) {
      if (el && el.id) styles.set(el.id, el);
      return el;
    },
  },
  body: { appendChild() {}, classList: { add() {}, remove() {} }, style: {} },
  createElement: (tag) => ({
    tagName: String(tag).toUpperCase(),
    id: "",
    textContent: "",
    style: {},
    remove() {
      if (this.id) styles.delete(this.id);
    },
  }),
  getElementById: (id) => styles.get(id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
};
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
/* Node 26 的 navigator 是只读内建，只能 defineProperty 或改它的 userAgent */
try {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node-test", maxTouchPoints: 0 },
    configurable: true,
    writable: true,
  });
} catch {
  try {
    Object.defineProperty(globalThis.navigator, "userAgent", { value: "node-test", configurable: true });
  } catch {
    /* 改不动就算了：isAndroidNavigator 只是"是否同步系统栏"的早退判断，不影响本测试断言 */
  }
}
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
/** 测试里要摸的实现细节 */
export const dom = { store, styles, documentElement };
export const resetDom = () => {
  styles.clear();
  for (const k of Object.keys(documentElement.dataset)) delete documentElement.dataset[k];
};
