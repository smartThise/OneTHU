/**
 * 远端 HTML 的主题适配：把「源站写死的颜色」剥掉，让正文继承应用主题令牌。
 *
 * 为什么需要：THUBook（thubook.help）正文是整段 HTML 直接注入渲染的，源站正文里
 * 普遍带行内颜色（`style="color:#000"`、`<font color="#333">`、`bgcolor="#fff"`）。
 * 行内样式优先级高于我们的 `.thubook-body { color: var(--text-1) }`，于是在**深色主题下
 * 正文仍是黑字**（用户实录 2026-09-20：THUBook 正文黑夜模式还是黑字）。
 *
 * 做法：只摘掉颜色类声明/属性（color / background / background-color / bgcolor /
 *  font 的 color），其余样式（字号、加粗、对齐、宽高）原样保留——不做通用 sanitize，
 * 清洗活性另在 yktBody.sanitizeForInlineDoc 那条链上负责。
 */
export function stripInlineColors(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 1) style="…" 里的颜色类声明
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    const style = el.style;
    style.removeProperty("color");
    style.removeProperty("background");
    style.removeProperty("background-color");
    style.removeProperty("background-image");
    const left = style.cssText.trim();
    if (left) el.setAttribute("style", left);
    else el.removeAttribute("style");
  }

  // 2) <font color=…> 之类的呈现属性（HTML 3.2 老写法，thubook 正文里仍有）
  for (const el of Array.from(doc.querySelectorAll("[color],[bgcolor],[text],[link],[vlink]"))) {
    el.removeAttribute("color");
    el.removeAttribute("bgcolor");
    el.removeAttribute("text");
    el.removeAttribute("link");
    el.removeAttribute("vlink");
    if (el.tagName === "FONT" && el.attributes.length === 0) {
      el.replaceWith(...Array.from(el.childNodes)); // 纯颜色 font → 拆掉标签，继承主题色
    }
  }

  return doc.body.innerHTML;
}

/**
 * 剥远端正文里的**行内背景填充**（保留文字色与其他样式）。玻璃材质档专用：
 * 题干 HTML 常带 UEditor/Word 粘贴留下的行内白底（style 里的 background 声明、
 * 表格 bgcolor 属性），实色纸面主题下与纸底同色看不出来；玻璃主题里就是
 * 一块块实心白板——公式周围最扎眼（用户 2026-10-28「部分 LaTeX 背景变成实心白色」）。
 *
 * 与 stripInlineColors 的区别：这里**不动 color**（浅色玻璃档仍要保留官方文字色，
 * 例如红笔标注），只摘 background / background-color / background-image 与
 * bgcolor/background 呈现属性。`background` 简写整条删掉：白色多半来自简写的
 * 颜色分量，保留简写会把颜色一起带回来。
 *
 * 调用方（ProblemBody）只在 `theme.flush === true`（玻璃/半透明容器）时注入，
 * 实色纸面主题行为不变；注入式设计同 stripInlineColors（保持 yktBody 零依赖）。
 */
export function stripInlineBackgrounds(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 1) style="…" 里的背景类声明
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
    const style = el.style;
    style.removeProperty("background");
    style.removeProperty("background-color");
    style.removeProperty("background-image");
    const left = style.cssText.trim();
    if (left) el.setAttribute("style", left);
    else el.removeAttribute("style");
  }

  // 2) 呈现属性（HTML 3.2/邮件粘贴老写法；bgcolor 在表格/单元格上最常见）
  for (const el of Array.from(doc.querySelectorAll("[bgcolor],[background]"))) {
    el.removeAttribute("bgcolor");
    el.removeAttribute("background");
  }

  return doc.body.innerHTML;
}
