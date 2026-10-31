/**
 * 雨课堂答题页 LaTeX 两个问题的**浏览器回归**（2026-10-28 用户反馈 → task-5）：
 *
 *  ① 题目里出现大量字面 “nbsp”：
 *     构造真实形态的雨课堂题干（UEditor `&nbsp;`、二次编码 `&amp;nbsp;`、公式内部实体、
 *     `img.kfformula[data-latex]` 实体），走生产管线 buildYktProblemDoc + 真实 vendor
 *     KaTeX 生成 srcdoc，在 Chromium 里检查**可见文本**：不含字面 “nbsp”、不变回原始
 *     `$…$`/TeX 源码，空格语义仍是 NBSP。
 *
 *  ② 部分 LaTeX 背景变成实心白色：
 *     - 玻璃容器（真实 OneGUI `.og-surface.og-card` + data-glass 档）里 theme.flush=true，
 *       srcdoc body 透明；**对照组**（不剥官方行内白底）会在公式周围留下实心白块，
 *       生产路径（剥背景）没有 → 截图像素比对 + 同源检查 iframe 计算样式双证。
 *     - 答题页公式对话框的 `.ykt-formula-preview`（唯一 LaTeX 阅读面）在玻璃皮肤下
 *       必须是半透明阅读材质（alpha < 0.995），中性皮肤仍是不透明纸面（不回归旧观感）。
 *
 * 依赖开发服务器（默认 http://127.0.0.1:5180，可用 ONETHU_TEST_URL 覆盖）；
 * 只读本地渲染，不登录雨课堂、不发任何校外请求（路由层拦截）。
 *
 * 运行：node tools/ykt-latex-browser-test.mjs
 *   ONETHU_TEST_OUT 覆盖报告与截图目录。
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.ONETHU_PLAYWRIGHT_PATH ?? "playwright");
const base = (process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180").replace(/\/$/, "");
const out = process.env.ONETHU_TEST_OUT ?? join(tmpdir(), "onethu-ykt-latex");
mkdirSync(out, { recursive: true });

const checks = [];
const errors = [];
const check = (value, label) => {
  checks.push({ ok: Boolean(value), label });
  if (!value) errors.push(label);
  console.log((value ? "✓ " : "✗ ") + label);
};

async function reachable(url) {
  try {
    const res = await fetch(url + "/", { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}
assert.ok(
  await reachable(base),
  `需要开发服务器：${base}（先 pnpm --filter @onethu/desktop dev；或设 ONETHU_TEST_URL）`,
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  // 校外请求一律拦截：本测试只做本地渲染（同 html-safety / glass-optics 口径）。
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5180|localhost:5180)/, (route) => route.abort());
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root") !== null, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const fixture = [
    '<p><span style="background-color:#ffffff;padding:2px 4px">1．求 $E=mc^2$ 的值</span></p>',
    '<p style="background:#ffffff">2．设 $x&nbsp;y$ 为实数（UEditor 空格）</p>',
    '<table bgcolor="#ffffff"><tr><td style="background-color:rgb(255,255,255)">3．二次编码文本：甲&amp;nbsp;乙</td></tr></table>',
    '<p>4．公式内实体：$a&amp;nbsp;b$ 与 $f(x)=x^2&nbsp;(x&gt;0)$</p>',
    '<p>5．显示公式：\\[\\frac{a}{b}&nbsp;+&nbsp;c\\]</p>',
    '<img class="kfformula" data-latex="\\frac{1}{2}&nbsp;+" data-display="inline">',
  ].join("");

  const result = await page.evaluate(async ({ fixture }) => {
    const imported = {};
    const yb = (imported.yb = await import("/src/lib/yktBody.ts"));
    const yk = (imported.yk = await import("/src/lib/yktKatex.ts"));
    const pb = (imported.pb = await import("/src/components/exthw/ProblemBody.tsx"));
    const ht = (imported.ht = await import("/src/lib/htmlTheme.ts"));
    const bundle = await yk.loadYktLatexBundle();
    if (!bundle) throw new Error("KaTeX vendor bundle 未加载");

    const root = document.documentElement;
    root.dataset.glass = "clear";
    root.dataset.scheme = "light";
    await new Promise((r) => setTimeout(r, 600));

    const stage = document.createElement("div");
    stage.id = "ykt-test-stage";
    stage.style.cssText =
      "position:fixed;inset:0;z-index:99999;overflow:auto;padding:24px;box-sizing:border-box;" +
      "background:linear-gradient(120deg,#0b3d91 0%,#c2185b 100%)";
    document.body.appendChild(stage);

    const card = document.createElement("div");
    card.className = "og-surface og-card og-card--p-md";
    card.style.marginBottom = "16px";
    const cardBody = document.createElement("div");
    cardBody.className = "og-card-body";
    card.appendChild(cardBody);
    stage.appendChild(card);

    // 两条渲染路径：对照（不剥行内底 = 用户看到白块的旧行为）/ 生产（flush 时剥）
    const makeFrame = (id, strip) => {
      const holder = document.createElement("div");
      holder.className = "ykt-problem-body";
      const wrap = document.createElement("div");
      wrap.id = id + "-wrap";
      holder.appendChild(wrap);
      cardBody.appendChild(holder);
      const theme = pb.readYktDocTheme(wrap);
      const doc = yb.buildYktProblemDoc({
        html: fixture,
        render: bundle.render,
        extraCss: bundle.inlineCss,
        theme,
        stripColors: ht.stripInlineColors,
        stripBackgrounds: strip && theme.flush === true ? ht.stripInlineBackgrounds : undefined,
      });
      const frame = document.createElement("iframe");
      frame.id = id;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.style.cssText = "width:100%;height:300px;border:0;display:block;background:transparent";
      frame.srcdoc = doc;
      wrap.appendChild(frame);
      return { theme, doc, frame };
    };
    const control = makeFrame("ykt-control", false); // 旧路径：保留官方行内白底
    const fixed = makeFrame("ykt-fixed", true); // 生产路径：玻璃档剥背景

    // 公式对话框的 LaTeX 阅读面（唯一会整块压住公式的容器）
    const dialog = document.createElement("div");
    dialog.className = "ykt-formula-dialog";
    const preview = document.createElement("div");
    preview.className = "ykt-formula-preview";
    const previewBody = document.createElement("div");
    previewBody.className = "ykt-formula-preview-body";
    previewBody.innerHTML = bundle.render("\\frac{a}{b}+c", true) ?? "";
    preview.appendChild(previewBody);
    dialog.appendChild(preview);
    const katexStyle = document.createElement("style");
    katexStyle.textContent = bundle.inlineCss;
    dialog.appendChild(katexStyle);
    cardBody.appendChild(dialog);

    // 同源检查 iframe（production iframe 是 opaque origin 读不到内部；文档内容完全相同）
    const inspect = (doc) =>
      new Promise((resolve) => {
        const f = document.createElement("iframe");
        f.style.cssText = "position:absolute;left:-9999px;top:0;width:900px;height:400px;border:0";
        // 必须挂进文档才会导航（srcdoc 在分离节点上不加载）；隐藏但参与渲染以拿到计算样式。
        f.setAttribute("aria-hidden", "true");
        document.body.appendChild(f);
        const done = async () => {
          await f.contentDocument?.fonts?.ready?.catch?.(() => undefined);
          await new Promise((r) => setTimeout(r, 250));
          const d = f.contentDocument;
          const bg = (el) => (el ? getComputedStyle(el).backgroundColor : "missing");
          resolve({
            body: bg(d.body),
            katex: bg(d.querySelector(".katex")),
            display: bg(d.querySelector(".katex-display")),
            // 第一段是行内白底 span；表格单元格带行内白底
            firstSpan: bg(d.querySelector("p:first-child > span")),
            tableCell: bg(d.querySelector("table td")),
            visibleText: (d.body.innerText || "").trim(),
            katexCount: d.querySelectorAll(".katex").length,
          });
          f.remove();
        };
        f.addEventListener("load", () => void done(), { once: true });
        f.srcdoc = doc;
      });
    const controlInspect = await inspect(control.doc);
    const fixedInspect = await inspect(fixed.doc);

    const previewGlassBg = getComputedStyle(preview).backgroundColor;
    const cardBg = getComputedStyle(card).backgroundColor;
    // 中性皮肤对照：去掉 data-glass → 桥接器回 neutral，公式预览恢复不透明纸面
    root.removeAttribute("data-glass");
    await new Promise((r) => setTimeout(r, 500));
    const previewNeutralBg = getComputedStyle(preview).backgroundColor;
    root.dataset.glass = "clear";
    root.dataset.scheme = "dark";
    await new Promise((r) => setTimeout(r, 500));
    const previewDarkBg = getComputedStyle(preview).backgroundColor;
    const previewDarkColor = getComputedStyle(preview).color;
    root.dataset.scheme = "light";
    await new Promise((r) => setTimeout(r, 400));

    const rect = (id) => {
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().toJSON() : null;
    };
    return {
      controlTheme: control.theme,
      fixedTheme: fixed.theme,
      cardBg,
      previewGlassBg,
      previewNeutralBg,
      previewDarkBg,
      previewDarkColor,
      controlRect: rect("ykt-control"),
      fixedRect: rect("ykt-fixed"),
      controlInspect,
      fixedInspect,
      fixedDocHasAmpNbsp: fixed.doc.includes("&amp;nbsp;"),
      fixedDocHasOpaqueWhite: /background(-color)?\s*:\s*(#fff|#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i.test(
        fixed.doc.slice(fixed.doc.indexOf("<body>"), fixed.doc.indexOf("<script>")),
      ),
    };
  }, { fixture });

  // ── 主题读取 ──
  check(result.cardBg.startsWith("color(") || /rgba\([^)]*,\s*0?\.\d+\)/.test(result.cardBg), `玻璃卡背景为半透明材质（实际 ${result.cardBg}）`);
  check(result.fixedTheme.flush === true, "ProblemBody：玻璃容器下 theme.flush=true（画布走透明，不补纸面）");
  check(result.fixedTheme.bg === "transparent", "ProblemBody：玻璃容器下文档底色 transparent（不复制父层玻璃）");

  // ── ① nbsp ──
  check(!/nbsp/i.test(result.fixedInspect.visibleText), `① 可见文本无字面 nbsp（${JSON.stringify(result.fixedInspect.visibleText.slice(0, 80))}）`);
  check(!result.fixedInspect.visibleText.includes("$"), "① 可见文本无未渲染公式定界（公式内 nbsp 不再令 KaTeX 失败）");
  check(result.fixedInspect.visibleText.includes("甲\u00a0乙"), "① 二次编码 NBSP 语义保留为空格");
  check(!result.fixedDocHasAmpNbsp, "① srcdoc 正文无二次编码实体 &amp;nbsp;");
  check(result.fixedInspect.katexCount >= 6, `① 全部公式真渲染为 KaTeX（${result.fixedInspect.katexCount} 个）`);

  // ── ② 白底：沙箱文档内部（同源检查） ──
  check(result.fixedInspect.body === "rgba(0, 0, 0, 0)", `② srcdoc body 透明（实际 ${result.fixedInspect.body}）`);
  check(result.fixedInspect.katex === "rgba(0, 0, 0, 0)", `② .katex 背景透明（实际 ${result.fixedInspect.katex}）`);
  check(result.fixedInspect.display === "rgba(0, 0, 0, 0)", `② .katex-display 背景透明（实际 ${result.fixedInspect.display}）`);
  check(result.controlInspect.firstSpan !== "rgba(0, 0, 0, 0)", `② 对照（旧路径）行内白底仍在（${result.controlInspect.firstSpan}；证明已复现白块来源）`);
  check(result.fixedInspect.firstSpan === "rgba(0, 0, 0, 0)", `② 生产路径剥掉行内白底（实际 ${result.fixedInspect.firstSpan}）`);
  check(result.controlInspect.tableCell !== "rgba(0, 0, 0, 0)", "② 对照：表格 bgcolor 白底仍在（已复现）");
  check(result.fixedInspect.tableCell === "rgba(0, 0, 0, 0)", `② 生产路径剥掉表格白底（实际 ${result.fixedInspect.tableCell}）`);
  check(!result.fixedDocHasOpaqueWhite, "② 生产文档正文不再含不透明白色背景声明");

  // ── ② 白底：真实 iframe 叠在玻璃上的像素证据（对照有白块 / 生产无白块） ──
  const shot = async (rect) => {
    if (!rect) return null;
    const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) };
    const buf = await page.screenshot({ clip });
    return buf.toString("base64");
  };
  const [controlShot, fixedShot] = [await shot(result.controlRect), await shot(result.fixedRect)];
  const pixels = await page.evaluate(async ({ controlShot, fixedShot }) => {
    const analyze = (b64) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, c.width, c.height);
          let white = 0;
          const total = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) white++;
          }
          resolve({ whiteRatio: white / total, width: c.width, height: c.height });
        };
        img.src = "data:image/png;base64," + b64;
      });
    return {
      control: controlShot ? await analyze(controlShot) : null,
      fixed: fixedShot ? await analyze(fixedShot) : null,
    };
  }, { controlShot, fixedShot });
  check(pixels.control && pixels.control.whiteRatio > 0.02, `② 对照 iframe 有实心白块（近白像素 ${(pixels.control?.whiteRatio * 100).toFixed(1)}% > 2%）`);
  check(pixels.fixed && pixels.fixed.whiteRatio < 0.005, `② 生产 iframe 无实心白块（近白像素 ${(pixels.fixed?.whiteRatio * 100).toFixed(2)}% < 0.5%）`);

  // ── ② 公式对话框 LaTeX 预览面材质 ──
  const alphaOf = (color) => {
    if (!color || color === "transparent") return 0;
    const slash = /\/\s*([0-9.]+)(%?)\s*\)/.exec(color);
    if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
    const legacy = /^rgba\(([^)]+)\)$/.exec(color);
    if (legacy) {
      const parts = legacy[1].split(/[,/\s]+/).filter(Boolean);
      return parts.length < 4 ? 1 : Number(parts[3]);
    }
    return 1;
  };
  check(alphaOf(result.previewGlassBg) < 0.995, `② 玻璃皮肤下 .ykt-formula-preview 为半透明阅读材质（${result.previewGlassBg}）`);
  check(alphaOf(result.previewNeutralBg) >= 0.995, `② 中性皮肤下公式预览仍是不透明纸面（${result.previewNeutralBg}，旧观感不回归）`);
  // 暗色玻璃档：材质同样半透明，且公式文字保持浅色（不破坏暗色可读性）
  check(alphaOf(result.previewDarkBg) < 0.995, `② 暗色玻璃下公式预览仍为半透明材质（${result.previewDarkBg}）`);
  const darkInk = /rgba?\(([^)]+)\)/.exec(result.previewDarkColor ?? "");
  const inkParts = darkInk ? darkInk[1].split(/[,/\s]+/).filter(Boolean).map(Number) : [];
  const inkLum = inkParts.length >= 3 ? (inkParts[0] * 0.2126 + inkParts[1] * 0.7152 + inkParts[2] * 0.0722) / 255 : 0;
  check(inkLum > 0.5, `② 暗色玻璃下公式文字为浅色（${result.previewDarkColor}，保证暗底可读）`);

  await page.screenshot({ path: join(out, "ykt-latex-browser.png") });
  const report = {
    passed: errors.length === 0,
    checks,
    errors,
    evidence: { result, pixels },
    boundary:
      "本地 dev server + Chromium；真实 buildYktProblemDoc / KaTeX vendor / ProblemBody 主题读取与 recipe CSS。" +
      "production iframe 为沙箱 opaque origin，内部计算样式由内容相同的同源检查 iframe 读取（不改生产沙箱语义）；" +
      "未登录雨课堂、未请求校外域。",
  };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n证据目录：${out}`);
  if (errors.length > 0) {
    console.error(`\n失败 ${errors.length} 项：\n- ` + errors.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log(`\n═══ 雨课堂 LaTeX 浏览器回归：${checks.length} 项全部通过 ═══`);
  }
} finally {
  await browser.close();
}
