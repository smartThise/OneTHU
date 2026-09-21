/**
 * 极简 CDP 客户端（WebView DevTools 协议）——Demo Flow 自动化的眼睛与手。
 *
 * 为什么不用 uiautomator / 硬编码坐标：实测本应用 WebView **不向 uiautomator 暴露可访问性
 * 节点**（dump 出来只有一个空 WebView），而坐标写死在换设备/换字号后必崩。CDP 直接读写渲染
 * 进程里的真实 DOM：元素文字、坐标、滚动都能拿到，点击用 Input.dispatchMouseEvent（可信事件）。
 *
 * 连接：adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
 */
import { execFileSync } from "node:child_process";

export function adb(args, opts = {}) {
  return execFileSync("adb", args, { encoding: "utf8", ...opts });
}

/** 找到应用 WebView 的 devtools socket（release 包也可能开着，实测 demo 包是开的）。
 *  应用在后台/未启动时 socket 可能不存在 → 自动拉起应用再试几次（演示脚本不该因这个失败）。 */
export function webviewSocket(pkg, { tries = 6, gapMs = 1200 } = {}) {
  for (let i = 0; i < tries; i++) {
    const socks = adb(["shell", "cat", "/proc/net/unix"]).split("\n");
    const hit = socks.map((l) => l.trim().split(/\s+/).pop()).find((n) => n?.startsWith("@webview_devtools_remote_"));
    if (hit) return hit.replace(/^@/, "");
    if (i === 0 && pkg) {
      try { adb(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], { stdio: "ignore" }); } catch { /* 拉起失败再试 */ }
    }
    const until = Date.now() + gapMs;
    while (Date.now() < until) { /* 等应用起来（同步阻塞，保持脚本简单） */ }
  }
  throw new Error("未找到 WebView devtools socket（该构建未开启调试，或应用始终未启动）");
}

/** 建立 CDP 连接：socket 发现 → adb forward → /json 列表 → WebSocket。
 *  应用重启后 socket 名里的 pid 会变、转发会失效，所以整链重试几次。 */
export async function connectCdp(pkg, port = 9222) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const socket = webviewSocket(pkg, { tries: attempt === 1 ? 1 : 3 });
      try { adb(["forward", "--remove", `tcp:${port}`], { stdio: "ignore" }); } catch { /* 没有旧的 */ }
      adb(["forward", `tcp:${port}`, `localabstract:${socket}`]);

      // 转发刚建立时 devtools 端点可能还没就绪：短重试
      let list = null;
      for (let i = 0; i < 6 && !list; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/json`);
          if (r.ok) list = await r.json();
        } catch (e) { lastErr = e; }
        if (!list) await new Promise((res) => setTimeout(res, 700));
      }
      if (!list) throw lastErr ?? new Error("devtools /json 无响应");

      const page = list.find((t) => t.type === "page") ?? list[0];
      if (!page?.webSocketDebuggerUrl) throw new Error("没有可连接的页面目标");

      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        ws.addEventListener("open", () => res());
        ws.addEventListener("error", (e) => rej(new Error(`WS 连接失败：${e?.message ?? e}`)));
      });

      let id = 0;
      const pending = new Map();
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        }
      });

      const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const mid = ++id;
          pending.set(mid, { resolve, reject });
          ws.send(JSON.stringify({ id: mid, method, params }));
          setTimeout(() => {
            if (pending.has(mid)) { pending.delete(mid); reject(new Error(`CDP 超时：${method}`)); }
          }, 15000);
        });

      const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`页面求值异常：${r.exceptionDetails.text}`);
        return r.result?.value;
      };

      return { send, evaluate, close: () => ws.close() };
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 1200));
    }
  }
  throw new Error(`连接 CDP 失败（已重试 5 次）：${lastErr?.message ?? lastErr}`);
}

/** 人类化等待：±25% 抖动，避免机械秒点 */
export function human(ms) {
  const jitter = ms * 0.25;
  return new Promise((r) => setTimeout(r, Math.round(ms - jitter + Math.random() * jitter * 2)));
}

/** 找到可见元素（文字或 aria-label/title/placeholder 命中），取最靠上的合理命中 */
export const FIND_JS = (needle) => `(() => {
  const needle = ${JSON.stringify(needle)};
  const hits = [];
  for (const el of document.querySelectorAll('*')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    const txt = own || (el.children.length === 0 ? (el.textContent || '').trim() : '');
    const attr = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
    if (!txt && !attr) continue;
    if (!(txt.includes(needle) || attr.includes(needle))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    hits.push({ text: (txt || attr).slice(0, 60), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), cls: String(el.className || '').slice(0, 60) });
  }
  hits.sort((a, b) => (a.w * a.h) - (b.w * b.h));
  return hits.slice(0, 8);
})()`;
