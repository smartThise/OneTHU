/**
 * R20-B3：雨课堂题干内联渲染 —— 纯逻辑/字体缓存/降级判定 单测（离线，Node 直引，不打真实平台）。
 *
 * 运行：node tools/ykt-body-test.mjs
 *
 * 覆盖（apps/desktop/src/lib/yktBody.ts 为主）：
 *  [1] LaTeX $…$ / $$…$$ 扫描：显示/行内、定界防误伤（价格 $5 与 $6）、\$ 转义、
 *      未配对/渲染失败逐段保原文（降级第一环）、只动文本不动属性、实体解码顺序
 *  [2] 加密字体判定与降级：needsEncryptedFont / stripEncryptedFontClass（剥 token 保其余、
 *      删空整属性、单引号形态）——字体不可用时「宁错字不丢字」兜底
 *  [3] 字体缓存判定（纯函数）：fontMimeFromBase64 magic（ttf/otf/woff/woff2/垃圾）、
 *      isFontCacheFresh（形状/url 对档/TTL 过期/时钟回拨/内容污染）、fontDownloadAllowed
 *      （失败 10min 退避）、yktFontCacheKey（safe_name 白名单兼容 + 64bit 指纹稳定）
 *  [4] sanitize / 图片 / 杂项：script 与容器标签剔除、on* 事件与 javascript: 链去活性、
 *      hardenYktImgs / imgSrcsOf / imgFileName / shouldAttachYktCookies（Cookie 不外泄第三方）
 *  [5] buildYktProblemDoc 拼装降级：字体挂载 vs 剥 class、extraCss 仅在真渲染出 katex 时进、
 *      文档头（no-referrer / base）/ clampDocHeight、加密 span 规则合法性（回退栈不得是
 *      CSS 全局关键字——R20-B3「`,inherit` 致规则被引擎丢弃」乱码根因的回归网）
 *  [6] KaTeX 集成烟测（真实 vendor/katex.mjs，Node 可直引）：渲染器加载、单公式失败抛错由
 *      safeRender 兜回原文、extraCss 门禁端到端
 *  [7] 接线静态审计（漏接回归网）：详情页四处正文全走 ProblemBody、无 dangerouslySetInnerHTML
 *      残留；ProblemBody 沙箱无 allow-same-origin、消息带 ev.source 校验、字体强刷仅一次；
 *      yktAssets 走磁盘缓存（state_read/write）+ magic + 退避判定 + 失败不驻留进程内记忆；
 *      文档内脚本就绪判定 = document.fonts.load + 计算样式生效双确认
 *
 * 覆盖边界：yktAssets.ts / yktKatex.ts 的 Tauri invoke 往返与 ProblemBody.tsx 的 React 层
 * 由 pnpm typecheck + [7] 静态审计 + 真机烟测覆盖（docs 28.10）。
 */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
        try {
          return next(specifier.slice(0, -3) + ".ts", context);
        } catch {
          /* 继续抛原始错误 */
        }
      }
      throw err;
    }
  },
});

const yb = await import("../apps/desktop/src/lib/yktBody.ts");
const yk = await import("../apps/desktop/src/lib/yktKatex.ts");

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}
function deepEq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(same, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

/* ───────────────── [1] LaTeX $…$ / $$…$$ ───────────────── */
console.log("\n[1] LaTeX 定界扫描与逐段降级");
{
  // 实体解码：&amp; 必须最后替换（&amp;lt; → "&lt;" 字面而非 "<"）
  eq(yb.decodeBasicEntities("&amp;lt;"), "&lt;", "decodeBasicEntities：&amp; 最后替换");
  eq(yb.decodeBasicEntities("&lt;p&gt; &quot;q&quot; &#39;a&#039; &apos;b"), `<p> "q" 'a' 'b`, "decodeBasicEntities：常规实体");

  const fake = (tex, displayMode) => (tex === "坏" ? null : `[${displayMode ? "D" : "I"}:${tex}]`);
  eq(
    yb.renderLatexInHtml("<p>求 \\[x^2+y^2=1\\] 的面积</p>", fake),
    "<p>求 [D:x^2+y^2=1] 的面积</p>",
    "\\[…\\] 显示模式公式（雨课堂少数题干定界）",
  );
  eq(
    yb.renderLatexInHtml("<p>行内 \\(a+b\\) 与 \\[c+d\\]</p>", fake),
    "<p>行内 [I:a+b] 与 [D:c+d]</p>",
    "\\(…\\) / \\[…\\] 混用同时识别",
  );
  eq(
    yb.renderLatexInHtml("<p>失败 \\[坏\\] 原文</p>", fake),
    "<p>失败 \\[坏\\] 原文</p>",
    "\\[…\\] 渲染失败保留定界原文",
  );
  eq(
    yb.renderLatexInHtml("<p>已知 $x^2$ 求解</p>", fake),
    "<p>已知 [I:x^2] 求解</p>",
    "行内 $…$ 渲染，标签不动",
  );
  eq(
    yb.renderLatexInHtml("<p>已知 $ \\alpha_1 + \\beta_2 $ 求解</p>", fake),
    "<p>已知 [I:\\alpha_1 + \\beta_2] 求解</p>",
    "行内 $ … $ 内侧空白也渲染（LaTeX 内容）",
  );
  eq(
    yb.renderLatexInHtml("<p>价格 $5 与 $6 元</p>", fake),
    "<p>价格 $5 与 $6 元</p>",
    "带空白的价格区间不误判成公式",
  );
  eq(
    yb.renderLatexInHtml("<p>行内 \\( x+y \\) 完</p>", fake),
    "<p>行内 [I:x+y] 完</p>",
    "\\( … \\) 内侧空白也渲染",
  );
  eq(
    yb.renderLatexInHtml("<p>&#92;(x+y&#92;)</p>", fake),
    "<p>[I:x+y]</p>",
    "数字实体形态的 \\(…\\) 也识别",
  );
  eq(
    yb.renderLatexInHtml("<p>\\[<br> x^2 <br>\\]</p>", fake),
    "<p>[D:x^2]</p>",
    "跨 <br>/标签的 \\[…\\] 仍能配对渲染",
  );
  eq(
    yb.renderLatexInHtml("<p>$<span>\\alpha_1</span>$</p>", fake),
    "<p>[I:\\alpha_1]</p>",
    "跨 <span> 的 $…$ 也能配对渲染",
  );
  eq(
    yb.renderLatexInHtml("<p>\\(<div> a+b </div>\\)</p>", fake),
    "<p>[I:a+b]</p>",
    "跨标签的 \\(…\\) 仍能配对渲染",
  );
  eq(yb.renderLatexInHtml("<p>证：$$\\frac{a}{b}$$ 完</p>", fake), "<p>证：[D:\\frac{a}{b}] 完</p>", "显示 $$…$$ 走 displayMode");

  // 防误伤：价格语义不开渲染；内侧空白不闭合
  eq(yb.renderLatexInHtml("<p>价格 $5 与 $6 不等</p>", fake), "<p>价格 $5 与 $6 不等</p>", "「$5 与 $6」不误判（关界内侧空白）");
  eq(yb.renderLatexInHtml("<p>值 $ x $ 元</p>", fake), "<p>值 [I:x] 元</p>", "开界内侧空白但内容是数学 → 渲染");
  // 转义 \$ 不闭合
  eq(yb.renderLatexInHtml("<p>成本 \\$5 与 \\$6</p>", fake), "<p>成本 \\$5 与 \\$6</p>", "\\$ 转义不配对");
  // 未配对 $$ 全字面
  eq(yb.renderLatexInHtml("<p>只有 $$ 一个</p>", fake), "<p>只有 $$ 一个</p>", "未配对 $$ 字面保留");
  // 渲染失败 → 该段原文，其余照常（细粒度降级）
  eq(
    yb.renderLatexInHtml("<p>先 $坏$ 后 $好$</p>", fake),
    "<p>先 $坏$ 后 [I:好]</p>",
    "单公式失败保留原文，其余照常",
  );
  // 只动文本节点，属性里的 $ 不碰
  eq(
    yb.renderLatexInHtml('<p title="$t$">看 $y$</p>', fake),
    '<p title="$t$">看 [I:y]</p>',
    "属性内 $ 不处理",
  );
  // 无 $ 快速直通
  eq(yb.renderLatexInHtml("<p>没有公式</p>", fake), "<p>没有公式</p>", "无 $ 直通");
  // render 缺省恒 null → 全文原样
  eq(yb.renderLatexInHtml("<p>$a$ $$b$$</p>"), "<p>$a$ $$b$$</p>", "无渲染器 → 全文原样（不白屏）");
}

/* ───────────────── [2] 加密字体判定与降级 ───────────────── */
console.log("\n[2] 加密字体判定与剥 class 兜底");
{
  eq(yb.YKT_ENCRYPTED_FONT_CLASS, "xuetangx-com-encrypted-font", "加密 class 常量（docs 28.1/28.4 实测口径）");
  ok(yb.needsEncryptedFont('<span class="xuetangx-com-encrypted-font">字</span>'), "有加密 class → 需要字体");
  ok(!yb.needsEncryptedFont("<p>普通题干</p>"), "无加密 class → 不下载字体");

  // 剥 token 保其余
  const r1 = yb.stripEncryptedFontClass('<span class="a xuetangx-com-encrypted-font b">字</span>');
  eq(r1.html, '<span class="a b">字</span>', "剥加密 token，其余 class 保留");
  eq(r1.removed, 1, "删除计数");
  // 删空整属性
  const r2 = yb.stripEncryptedFontClass("<span class=\"xuetangx-com-encrypted-font\">字</span>");
  eq(r2.html, "<span>字</span>", "class 删空 → 整属性移除");
  eq(r2.removed, 1, "删除计数（单属性）");
  // 单引号 + 大小写不敏感（token 匹配按小写）
  const r3 = yb.stripEncryptedFontClass("<span class='Xuetangx-Com-Encrypted-Font'>字</span>");
  eq(r3.removed, 1, "单引号 + 大小写变体照剥");
  // 无加密 class 原样
  const r4 = yb.stripEncryptedFontClass('<p class="rich">正文</p>');
  eq(r4.html, '<p class="rich">正文</p>', "无加密 class 原样");
  eq(r4.removed, 0, "无删除计数");
}

/* ───────────────── [3] 字体缓存判定 ───────────────── */
console.log("\n[3] 字体缓存判定（magic / TTL / 对档 / 退避 / 键）");
{
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const TTF = b64([0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  const OTTO = b64([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0]);
  const WOFF = b64([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]);
  const WOFF2 = b64([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]);
  eq(yb.fontMimeFromBase64(TTF), "font/ttf", "magic: true type → font/ttf");
  eq(yb.fontMimeFromBase64(OTTO), "font/otf", "magic: OTTO → font/otf");
  eq(yb.fontMimeFromBase64(WOFF), "font/woff", "magic: wOFF → font/woff");
  eq(yb.fontMimeFromBase64(WOFF2), "font/woff2", "magic: wOF2 → font/woff2");
  eq(yb.fontMimeFromBase64(`data:application/octet-stream;base64,${TTF}`), "font/ttf", "data URL 前缀剥离后照判");
  eq(yb.fontMimeFromBase64(Buffer.from("<html>404 not found</html>").toString("base64")), null, "magic: 404 HTML → 非字体（降级判定核心）");
  eq(yb.fontMimeFromBase64("PD9waHA="), null, "magic: 短垃圾 → null");
  eq(yb.fontMimeFromBase64(""), null, "magic: 空串 → null");

  const URL1 = "https://ykt.io/exam_font_abc.ttf?v=1";
  // 真实字体形态：64 字节二进制（头部 magic + 内容）→ base64 前 16 字符无 '=' 填充
  const TTF_FULL = b64(Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(60, 0x07)]));
  const goodRec = { v: 1, url: URL1, mime: "font/ttf", data: TTF_FULL, savedAt: 1_000_000 };
  const NOW = 1_000_000 + 3 * 86400_000;
  ok(yb.isFontCacheFresh(goodRec, URL1, NOW), "新鲜缓存 → 可用");
  ok(!yb.isFontCacheFresh(goodRec, "https://ykt.io/other.ttf", NOW), "url 不对档（哈希碰撞防串档）→ 不可用");
  ok(!yb.isFontCacheFresh({ ...goodRec, v: 2 }, URL1, NOW), "版本不符 → 不可用");
  ok(!yb.isFontCacheFresh({ ...goodRec, savedAt: NOW - 8 * 86400_000 }, URL1, NOW), "超 TTL（7 天）→ 不可用");
  ok(yb.isFontCacheFresh(goodRec, URL1, 1_000_000 + 7 * 86400_000 - 1), "TTL 临界内 → 可用");
  ok(!yb.isFontCacheFresh({ ...goodRec, savedAt: NOW + 1 }, URL1, NOW), "时钟回拨（savedAt 在未来）→ 保守不可用");
  ok(!yb.isFontCacheFresh({ ...goodRec, mime: "text/html" }, URL1, NOW), "mime 非字体 → 不可用");
  ok(!yb.isFontCacheFresh({ ...goodRec, data: Buffer.from("<html>垃圾</html>").toString("base64") }, URL1, NOW), "内容污染（非字体 magic）→ 不可用");
  ok(!yb.isFontCacheFresh({ ...goodRec, data: "AAAA" }, URL1, NOW), "数据过短 → 不可用");
  ok(!yb.isFontCacheFresh(null, URL1, NOW), "null → 不可用");
  ok(!yb.isFontCacheFresh("junk", URL1, NOW), "非对象 → 不可用");
  ok(!yb.isFontCacheFresh({ ...goodRec, savedAt: "昨天" }, URL1, NOW), "savedAt 非数字 → 不可用");

  // 失败退避：上次失败 10min 内不打网络
  ok(yb.fontDownloadAllowed(undefined, NOW), "无失败记录 → 允许下载");
  ok(!yb.fontDownloadAllowed(NOW - 60_000, NOW), "1 分钟前失败 → 退避中");
  ok(yb.fontDownloadAllowed(NOW - 10 * 60_000, NOW), "退避窗口（10min）刚满 → 允许");
  ok(yb.fontDownloadAllowed(NOW - 60_000, NOW, 30_000), "自定义退避窗口可覆盖");

  // 缓存键：安全字符集 + 稳定指纹
  const k1 = yb.yktFontCacheKey(URL1);
  ok(/^ykt-font-exam_font_abc\.ttf-[0-9a-f]{16}$/.test(k1), `键形态 slug+64bit 指纹（实际 ${k1}）`);
  eq(yb.yktFontCacheKey(URL1), k1, "键稳定");
  ok(yb.yktFontCacheKey("https://ykt.io/f.ttf?a=1") !== k1, "不同 URL → 不同键");
  eq(yb.yktFontCacheKey("https://ykt.io/异常名字?x=1"), `ykt-font-font-${yb.fnv1a64Hex("https://ykt.io/异常名字?x=1")}`, "全非法文件名 → slug 兜底 font");
  eq(yb.fnv1a64Hex("a").length, 16, "指纹 16 hex");
  ok(yb.fnv1a64Hex("a") !== yb.fnv1a64Hex("b"), "指纹区分输入");
  ok(/^[0-9a-f]{16}$/.test(yb.fnv1a64Hex("https://x/y")), "指纹全小写 hex（Rust safe_name 白名单兼容）");
}

/* ───────────────── [4] sanitize / 图片 / 杂项 ───────────────── */
console.log("\n[4] sanitize 去活性 / 图片加固 / Cookie 域判定");
{
  const s = yb.sanitizeForInlineDoc;
  eq(s("<p>正文</p>"), "<p>正文</p>", "普通 HTML 原样");
  ok(!s('<p>a</p><script>alert(1)</script><p>b</p>').includes("alert"), "<script> 整块移除");
  ok(!s('<p onclick="evil()">t</p>').includes("onclick"), "on* 事件属性剥离");
  ok(s('<a href="#">x</a>').includes('href="#"'), "javascript: 链改 #");
  ok(!s('<iframe src="//e.com"></iframe>').includes("iframe"), "iframe 容器剔除");
  ok(!s("<link><meta><base><form><object><embed>").includes("<link"), "link/meta/base/form/object/embed 剔除");
  eq(s("1 < 2 且 3>2"), "1 < 2 且 3>2", "字面 < 不当标签吃掉");

  const h = yb.hardenYktImgs('<img src="//c/a.png"><img referrerpolicy="origin" src="//c/b.png">');
  ok(h.includes('<img referrerpolicy="no-referrer" src="//c/a.png">'), "img 补 no-referrer");
  ok(h.includes('referrerpolicy="origin"'), "已有 referrerpolicy 不动");

  deepEq(yb.imgSrcsOf('<img src="a.png"><img src="a.png"><img src="data:x"><img src="blob:y"><img src=\'b.png\'>'), ["a.png", "b.png"], "imgSrcsOf 去重 + 跳 data/blob + 单引号");
  eq(yb.imgFileName("https://cdn.xuetangx.com/a/b/%E6%95%B0%E5%AD%A6.png?sign=x"), "数学.png", "文件名解码");
  eq(yb.imgFileName("https://cdn.x/a.png"), "a.png", "普通文件名");
  eq(yb.imgFileName("https://cdn.x/" + "n".repeat(60) + ".png"), "n".repeat(45) + "…", "超长截 45 + …");
  eq(yb.imgFileName(""), "图片", "空 → 占位");
  eq(yb.imgFileName("https://cdn.x/"), "图片", "无文件段 → 占位");

  ok(yb.shouldAttachYktCookies("https://pro.yuketang.cn/api/x"), "yuketang 主域 → 带 Cookie");
  ok(yb.shouldAttachYktCookies("https://cdn.yuketang.cn/img/a.png"), "yuketang 子域 → 带 Cookie");
  ok(yb.shouldAttachYktCookies("https://xuetangx.com/a"), "xuetangx 主域 → 带 Cookie");
  ok(yb.shouldAttachYktCookies("https://img.xuetangx.com/b.png"), "xuetangx 子域 → 带 Cookie");
  ok(!yb.shouldAttachYktCookies("https://evil.com/yuketang.cn"), "路径伪造域 → 不带");
  ok(!yb.shouldAttachYktCookies("https://notyuketang.cn"), "相似域后缀不匹配（.yuketang.cn 才算）→ 不带");
  ok(!yb.shouldAttachYktCookies("not a url"), "非法 URL → 不带");
}

/* ───────────────── [5] buildYktProblemDoc 拼装与降级 ───────────────── */
console.log("\n[5] buildYktProblemDoc 拼装（字体挂载 / 剥 class / extraCss 门禁）");
{
  const ENC = '<p><span class="xuetangx-com-encrypted-font">甲乙丙</span></p>';
  const doc0 = yb.buildYktProblemDoc({ html: ENC });
  ok(!doc0.includes("@font-face"), "无字体数据 → 不挂 @font-face");
  ok(!doc0.includes('<span class="xuetangx-com-encrypted-font">'), "无字体数据 → 正文里的加密 class 已剥（普通字体兜底）");
  ok(doc0.includes("<span>甲乙丙</span>"), "原文保留（宁错字不丢字，不留尾随空格的干净 span）");

  const doc1 = yb.buildYktProblemDoc({ html: ENC, fontDataUrl: "data:font/ttf;base64,AAECAw==" });
  ok(doc1.includes('@font-face{font-family:"YktEncrypted";src:url(data:font/ttf;base64,AAECAw==)'), "有字体数据 → @font-face 内联 data URL");
  ok(doc1.includes("xuetangx-com-encrypted-font"), "有字体数据 → 加密 class 保留");

  // R20-B3 根因回归网：加密 span 规则必须是「合法」font-family 列表。
  // CSS 全局关键字（inherit/initial/unset/…）作为列表项 → 整条声明在解析期被引擎
  // 静默丢弃 → span 永远用正文字体渲染（乱码），@font-face 无人引用保持 unloaded，
  // 而 document.fonts.load 照样成功 → 就绪判定误报 OK（R20-B3 PC 实测根因）。
  const cssAll = yb.YKT_DOC_CSS;
  const ruleAt = cssAll.indexOf(`.${yb.YKT_ENCRYPTED_FONT_CLASS}{`);
  ok(ruleAt >= 0, "文档样式含加密 span 规则");
  const encRule = ruleAt >= 0 ? cssAll.slice(ruleAt, cssAll.indexOf("}", ruleAt) + 1) : "";
  ok(encRule.includes(`font-family:"${yb.YKT_FONT_FAMILY}",`), "span 规则先列加密字体族");
  ok(!new RegExp(
    `font-family:"${yb.YKT_FONT_FAMILY}",\\s*(inherit|initial|unset|revert|revert-layer|default)\\b`,
  ).test(encRule), "回退不是 CSS 全局关键字（`,inherit` 曾让整条规则失效——根因回归网）");
  ok(encRule.includes(yb.YKT_DOC_FONT_STACK), "回退栈 = 正文同栈常量（字体失败时观感≈普通正文）");
  ok(cssAll.includes(`font:14px/1.65 ${yb.YKT_DOC_FONT_STACK};`) && encRule.includes(yb.YKT_DOC_FONT_STACK), "body 与加密 span 共用同一字体栈常量（不漂移）");
  ok(doc1.includes(`.${yb.YKT_ENCRYPTED_FONT_CLASS}{font-family:"${yb.YKT_FONT_FAMILY}",`), "拼装产物里 span 规则随 @font-face 进文档");
  const doc2 = yb.buildYktProblemDoc({ html: "<p>题干</p>", extraCss: ".KATEXMARK{color:red}" });
  ok(!doc2.includes("KATEXMARK"), "无 katex 产物 → extraCss 不进（零开销）");
  const doc3 = yb.buildYktProblemDoc({
    html: "<p>$x^2$</p>",
    render: (tex) => `<span class="katex">${tex}</span>`,
    extraCss: ".KATEXMARK{color:red}",
  });
  ok(doc3.includes(".KATEXMARK"), "有 katex 产物 → extraCss 注入");
  ok(doc3.includes('<span class="katex">x^2</span>'), "渲染产物进文档");

  ok(doc0.includes('<meta name="referrer" content="no-referrer">'), "文档头 no-referrer");
  ok(doc0.includes(`<base href="${yb.YKT_DOC_BASE}">`), "文档 base 指向雨课堂站内");
  ok(doc0.includes('sandbox') === false && doc0.includes("ykt:height"), "文档内脚本就位（高度上报）");
  const doc4 = yb.buildYktProblemDoc({ html: '<img src="//c/a.png"><script>x()</script>' });
  ok(doc4.includes('referrerpolicy="no-referrer"'), "拼装管线含图片加固");
  ok(!doc4.includes("<script>x()</script>"), "拼装管线含 sanitize（输入 script 不进文档）");

  eq(yb.clampDocHeight(undefined), yb.YKT_FRAME_MIN_H, "高度：非数字 → 下限");
  eq(yb.clampDocHeight(0), yb.YKT_FRAME_MIN_H, "高度：0 → 下限");
  eq(yb.clampDocHeight(123.6), 124, "高度：四舍五入");
  eq(yb.clampDocHeight(999_999), yb.YKT_FRAME_MAX_H, "高度：异常大封顶");
  eq(yb.clampDocHeight(1e9), yb.YKT_FRAME_MAX_H, "高度：无界输入封顶");
}

/* ───────────────── [6] KaTeX 集成烟测（真实 vendor/katex.mjs） ───────────────── */
console.log("\n[6] KaTeX 集成（离线 vendor 包真实渲染）");
{
  const render = await yk.loadYktLatexRender();
  ok(render !== null, "渲染器懒加载成功（vendor/katex.mjs Node 可直引）");
  if (render) {
    const out = yb.renderLatexInHtml("<p>质能 $E=mc^2$ 完</p>", render);
    ok(out.includes('class="katex"'), "真实公式渲染出 katex 结构");
    ok(out.includes("质能") && out.includes("完"), "公式两侧文本保留");

    // 单公式解析失败 → safeRender 兜回原文（降级链第二环）
    const bad = yb.renderLatexInHtml("<p>$\\notacommandxyz{a}$ 与 $E=mc^2$</p>", render);
    ok(bad.includes("\\notacommandxyz{a}"), "非法公式 → 原文保留");
    ok(bad.includes('class="katex"'), "同文档合法公式照常渲染");

    // $$…$$ 显示模式走 katex-display
    const disp = yb.renderLatexInHtml("<p>$$\\frac{1}{2}$$</p>", render);
    ok(disp.includes("katex-display"), "显示模式 → katex-display");

    // extraCss 门禁端到端：buildYktProblemDoc + 真渲染器
    const doc = yb.buildYktProblemDoc({ html: "<p>有 $x$ 式</p>", render, extraCss: ".MARKX{y:1}" });
    ok(doc.includes(".MARKX"), "端到端：真渲染 → 内联样式注入");
    const docNone = yb.buildYktProblemDoc({ html: "<p>无式 $5 元</p>", render, extraCss: ".MARKX{y:1}" });
    ok(!docNone.includes(".MARKX"), "端到端：只有价格 $（未渲染）→ 不注入（零开销）");
  }
  const again = await yk.loadYktLatexRender();
  eq(again === render, true, "渲染器进程内记忆（同 promise 复用）");
}

/* ───────────────── [7] 接线静态审计 ───────────────── */
console.log("\n[7] 接线静态审计（详情页 / ProblemBody / yktAssets 漏接回归网）");
{
  const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

  const page = readSrc("../apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx");
  ok(!page.includes("YktBasicHtml") && !page.includes("dangerouslySetInnerHTML"), "详情页：B2 占位 innerHTML 渲染已移除");
  eq((page.match(/<ProblemBody /g) ?? []).length, 4, "详情页：四处正文全走 ProblemBody（题型9题干/普通题干/我的作答/作业说明）");
  ok(page.includes("components/exthw/ProblemBody.js"), "详情页：ProblemBody 从 components/exthw 引入");
  ok(page.includes("getYktCookie(") && page.includes("d.fontUrl"), "详情页：Cookie 与整卷字体 URL 下传");
  // 红线（B3 定稿 / R20-C2 修订）：渲染层零提交语义不变；详情页自 R20-C2 起有逐题
  // 原生作答入口（霖钦定，docs §31.2/§32）——但提交只能经 YktAnswerPanel 的确认对话框
  // 路径，护栏细断言见 tools/c2-redline-test.mjs（确认框/无 AI 生成/插件宿主不可达）。
  // 此处仍禁止的：无确认路径的 React 提交处理器（onSubmit=）、整页提交文案、旧命名。
  ok(!page.includes("onSubmit=") && !page.includes("提交答案") && !page.includes("submitAnswer"), "详情页：无裸提交处理器/旧提交文案（提交走 C2 确认框路径）");

  const comp = readSrc("../apps/desktop/src/components/exthw/ProblemBody.tsx");
  ok(comp.includes('sandbox="allow-scripts"'), "ProblemBody：iframe 沙箱 allow-scripts");
  const sandboxVals = [...comp.matchAll(/sandbox="([^"]*)"/g)].map((m) => m[1]);
  ok(sandboxVals.length > 0 && sandboxVals.every((v) => !v.includes("allow-same-origin")), "ProblemBody：沙箱**无** allow-same-origin（opaque origin 隔离）");
  ok(!comp.includes("提交") && !comp.includes("submit("), "ProblemBody：组件零提交语义（只读红线）");
  ok(comp.includes("buildYktProblemDoc"), "ProblemBody：文档拼装走 yktBody 口径");
  ok(comp.includes("loadYktFont") && comp.includes("force: true"), "ProblemBody：字体加载 + 失效强刷");
  ok(comp.includes("fetchYktImageAsDataUrl"), "ProblemBody：图片代理二次机会");
  ok(comp.includes("clampDocHeight") && comp.includes("YKT_FRAME_MIN_H"), "ProblemBody：高度钳制");
  ok(comp.includes("ev.source !== frameRef.current?.contentWindow"), "ProblemBody：postMessage 只认自己的 iframe");
  ok(comp.includes("ykt:font-fail") && comp.includes("fontRetried"), "ProblemBody：字体校验失败强刷仅一次（防打转）");
  ok(comp.includes("bg: \"transparent\"") && comp.includes("flush: true"), "ProblemBody：题干 iframe 始终透明，不复制祖先纸面底色");
  ok(comp.includes("needsLatex") && comp.includes("loadYktLatexBundle"), "ProblemBody：\\(…\\) / 实体定界符也会加载 KaTeX");
  ok(comp.includes("openExternal"), "ProblemBody：文档内链接走系统外开");

  const assets = readSrc("../apps/desktop/src/lib/yktAssets.ts");
  ok(assets.includes("isFontCacheFresh") && assets.includes("fontDownloadAllowed") && assets.includes("fontMimeFromBase64"), "yktAssets：缓存判定全走 yktBody 纯函数");
  ok(assets.includes("state_read") && assets.includes("state_write"), "yktAssets：字体缓存落应用数据目录（不进仓库）");
  ok(assets.includes("fetch_binary"), "yktAssets：字体/图片走 Rust fetch_binary（带 Referer）");
  ok(assets.includes("YKT_FONT_MAX_B64_LEN"), "yktAssets：异常大文件不入缓存");
  ok(assets.includes("mem.delete(clean)"), "yktAssets：失败结果不驻留进程内记忆（退避窗口后可重试）");

  const body = readSrc("../apps/desktop/src/lib/yktBody.ts");
  ok(body.includes("YKT_FONT_CACHE_TTL_MS = 7 * 24 * 3600 * 1000"), "yktBody：字体缓存 TTL = 7 天");
  ok(body.includes("YKT_FONT_FAIL_BACKOFF_MS = 10 * 60 * 1000"), "yktBody：失败退避 = 10 分钟");
  // R20-B3 就绪判定双确认回归网：fonts.load 成功 ≠ 生效，还须计算样式含加密族
  ok(body.includes("document.fonts.load"), "文档内脚本：就绪判定等 document.fonts.load 完成");
  ok(body.includes("getComputedStyle(el).fontFamily"), "文档内脚本：font-ok 前校验字体族在计算样式真正生效（防「字体 loaded + 规则失效」误报 OK）");
  ok(!/YKT_FONT_FAMILY\}",\s*inherit/.test(body), "yktBody：加密 span 规则无 `,inherit` 非法列表项（R20-B3 根因回归网）");

  const katexGlue = readSrc("../apps/desktop/src/lib/yktKatex.ts");
  ok(katexGlue.includes('import("../vendor/katex/katex.mjs")'), "yktKatex：离线 vendor 包（无运行时 CDN）");
  ok(katexGlue.includes("throwOnError: true") && katexGlue.includes("trust: false"), "yktKatex：单公式失败抛错兜原文 + 不信任外链命令");
}

/* ───────────────── [8] 主题配色（R20-B3 fix ②） ───────────────── */
console.log("\n[8] 主题配色：yktDocCss / sanitizeDocColor / buildYktProblemDoc theme 注入");
{
  // 缺省 = 历史浅色定稿（逐字节兼容旧观感与旧测试）
  eq(yb.yktDocCss(yb.DEFAULT_YKT_DOC_THEME), yb.YKT_DOC_CSS, "yktDocCss(默认主题) === YKT_DOC_CSS（浅色定稿不漂移）");
  ok(yb.DEFAULT_YKT_DOC_THEME.bg === "transparent", "默认底色 transparent（未接主题时的历史行为）");

  // 自定义主题色生效：暗色主题 / 米白浅色主题都只是「另一组字面量」
  const dark = { text: "#e8eaf0", textSoft: "#9aa0aa", bg: "#16181d", border: "#33363d", link: "#7aa2ff", fallbackBg: "#22252c" };
  const cssDark = yb.yktDocCss(dark);
  ok(cssDark.includes(`color:${dark.text}`) && cssDark.includes(`background:${dark.bg}`), "body 文字/底色来自主题");
  ok(cssDark.includes(`border:1px solid ${dark.border}`), "表格边线来自主题");
  ok(cssDark.includes(`a{color:${dark.link}`), "链接色来自主题");
  ok(cssDark.includes(`background:${dark.fallbackBg}`) && cssDark.includes(`color:${dark.textSoft}`), "图片占位框底/字色来自主题");
  ok(cssDark.includes(`.${yb.YKT_ENCRYPTED_FONT_CLASS}{font-family:"${yb.YKT_FONT_FAMILY}",`), "加密 span 规则随主题拼装保留");

  // 主题注入走 buildYktProblemDoc
  const docT = yb.buildYktProblemDoc({ html: "<p>题干</p>", theme: dark });
  ok(docT.includes(`color:${dark.text}`) && docT.includes(`background:${dark.bg}`), "buildYktProblemDoc 接受 theme 并注入文档");
  const docD = yb.buildYktProblemDoc({ html: "<p>题干</p>" });
  ok(docD.includes("color:#222"), "未传 theme → 浅色定稿（行为不变）");

  // sanitizeDocColor：只放行像颜色的字面量，畸形值/注入形态一律回退
  eq(yb.sanitizeDocColor("#E8EAF0", "FB"), "#e8eaf0", "hex 放行（大小写归一）");
  eq(yb.sanitizeDocColor("rgba(15, 17, 21, 0.87)", "FB"), "rgba(15, 17, 21, 0.87)", "rgba() 放行");
  eq(yb.sanitizeDocColor("hsl(220 10% 90%)", "FB"), "hsl(220 10% 90%)", "hsl() 放行");
  eq(yb.sanitizeDocColor("transparent", "FB"), "transparent", "transparent 放行");
  eq(yb.sanitizeDocColor("var(--x)", "FB"), "FB", "var() 引用不放行（opaque origin 无意义）");
  eq(yb.sanitizeDocColor("red}body{display:none", "FB"), "FB", "CSS 注入形态不放行");
  eq(yb.sanitizeDocColor("url(javascript:x)", "FB"), "FB", "url() 不放行");
  eq(yb.sanitizeDocColor("", "FB"), "FB", "空串回退");
  eq(yb.sanitizeDocColor(undefined, "FB"), "FB", "非字符串回退");
  eq(yb.sanitizeDocColor("#".repeat(70), "FB"), "FB", "超长值回退（长度上限）");

  // 暗底自检兜底（霖真机回归：底色解析失败时「白画布黑字」绝不允许再出现）
  ok(yb.isLightTextColor("#e8eaf0") && !yb.isLightTextColor("#222"), "isLightTextColor 亮度口径");
  const darkText = { text: "#e8eaf0", textSoft: "#9aa0aa", bg: "transparent", border: "#33363d", link: "#7aa2ff", fallbackBg: "#22252c" };
  const cssFallback = yb.yktDocCss(darkText);
  ok(yb.yktDocIsDark(darkText), "底色没解析出来但文字亮 → 判定暗主题");
  ok(cssFallback.includes("html{color-scheme:dark}"), "暗档带 color-scheme:dark（画布兜底第二道）");
  ok(cssFallback.includes("background:#16181d"), "底色 transparent → 强制中性暗纸面");
  ok(!cssFallback.includes("color:#222"), "暗档不再回退黑字");
  const darkBgDarkText = { ...dark, text: "#222" };
  const cssClamp = yb.yktDocCss(darkBgDarkText);
  ok(cssClamp.includes("color:#e8ebf2"), "暗底 + 暗文字 → 亮墨兜底（暗底上不可见字比白底更伤）");
  ok(!yb.yktDocIsDark(yb.DEFAULT_YKT_DOC_THEME), "默认浅色定稿仍是亮档");
  const cssFlush = yb.yktDocCss({ ...dark, flush: true });
  ok(cssFlush.includes("html,body{background:transparent!important}"), "glass flush：html/body 都透明（srcdoc 画布不刷白）");
}

/* ───────────────── [9] 字面 nbsp + 玻璃档公式白底（2026-10-28 用户反馈） ───────────────── */
console.log("\n[9] 字面 nbsp 归一 / 玻璃档剥行内背景（公式白底）");
{
  // —— ① nbsp 实体归一：单层 / 二次编码 / 三层编码 / 数字实体 / 大小写 ——
  eq(yb.normalizeNbspEntities("a&nbsp;b"), "a\u00a0b", "单层 &nbsp; → NBSP 字符（渲染即空格）");
  eq(yb.normalizeNbspEntities("a&amp;nbsp;b"), "a\u00a0b", "二次编码 &amp;nbsp; → NBSP（用户看到的字面 nbsp 根因）");
  eq(yb.normalizeNbspEntities("a&amp;amp;nbsp;b"), "a\u00a0b", "三层编码同归一");
  eq(yb.normalizeNbspEntities("a&#160;b&#xA0;c"), "a\u00a0b\u00a0c", "数字实体 &#160; / &#xA0;");
  eq(yb.normalizeNbspEntities("&NBSP;"), "\u00a0", "实体名大小写不敏感");
  eq(yb.normalizeNbspEntities("a&amp;nbsp;b", "tex"), "a b", "TeX 档 → 普通空格（KaTeX 最稳）");
  eq(yb.decodeBasicEntities("a&amp;nbsp;b"), "a b", "decodeBasicEntities 同口径（& 不再让公式抛 parse error）");
  eq(yb.normalizeNbspInHtml('<p title="&amp;nbsp;">a&amp;nbsp;b</p>'), '<p title="&amp;nbsp;">a\u00a0b</p>', "文本节点归一，属性不动");

  // —— ② 构造雨课堂题干 fixture（真实形态：UEditor &nbsp; / 二次编码 / 公式内实体 / kfformula） ——
  const render = await yk.loadYktLatexRender();
  ok(render !== null, "真实 vendor KaTeX 可用（fixture 走真渲染）");
  const fixture = [
    "<p>1．下列说法正确的是（&nbsp;&nbsp;&nbsp;）</p>",
    "<p>2．二次编码文本：甲&amp;nbsp;乙 与 丙&amp;amp;nbsp;丁</p>",
    "<p>3．公式含实体：$f(x)=x^2&nbsp;(x&gt;0)$ 与 $a&amp;nbsp;b$</p>",
    "<p>4．显示公式：\\[\\frac{a}{b}&nbsp;+&nbsp;c\\]</p>",
    '<img class="kfformula" data-latex="a&nbsp;b" data-display="inline">',
    '<img class="kfformula" data-latex="x&amp;nbsp;y" data-display="block">',
  ].join("");
  const doc = yb.buildYktProblemDoc({ html: fixture, render, extraCss: ".KATEXMARK{y:1}" });
  const docBody = doc.slice(doc.indexOf("<body>") + 6, doc.indexOf("<script>"));
  ok(!docBody.includes("&amp;nbsp;"), "文档正文不残留二次编码实体（&amp;nbsp;）");
  ok((docBody.match(/class="katex"/g) ?? []).length >= 4, "公式内的 nbsp（单层/二次编码/kfformula data-latex）全部真渲染（不再回退原始 $…$）");
  ok(!docBody.includes("\\frac{a}{b}"), "显示公式没有被回退成 TeX 源码");
  // 模拟浏览器可见文本：解实体 → 剥标签 → 既无字面 nbsp、也无回退的 $ 公式
  const visible = docBody
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, "\u00a0")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  ok(!/nbsp/i.test(visible), "浏览器可见文本不含字面 nbsp（含 “&nbsp;”/“nbsp” 两种形态）");
  ok(!visible.includes("$") && !visible.includes("\\frac"), "浏览器可见文本不残留未渲染的公式定界/源码");
  ok(visible.includes("甲\u00a0乙"), "二次编码的 NBSP 语义保留为空格（非折叠成普通空格以外的破坏）");

  // —— ③ 玻璃档（flush）剥行内背景：注入式，Node 无 DOMParser → 替身验证「何时/如何接线」 ——
  const whiteHtml = '<p style="background:#fff;color:#c00">公式 $x$</p><table bgcolor="#ffffff"><tr><td style="background-color:rgb(255,255,255)">值</td></tr></table>';
  const docPaper = yb.buildYktProblemDoc({ html: whiteHtml, render });
  ok(docPaper.includes("background:#fff") && docPaper.includes('bgcolor="#ffffff"'), "实色纸面档：不剥行内背景（原始行内底保留，行为不变）");
  const calls = [];
  const docGlass = yb.buildYktProblemDoc({
    html: whiteHtml,
    render,
    stripBackgrounds: (h) => {
      calls.push(h);
      return h.replace(/\s*style="[^"]*"/g, "").replace(/\s*bgcolor="[^"]*"/g, "");
    },
  });
  ok(!docGlass.includes("background:#fff") && !docGlass.includes("bgcolor"), "玻璃档：注入 stripBackgrounds → 行内实底剥掉（公式背后不再有实心白块）");
  ok(docGlass.includes('class="katex"') && docGlass.includes("公式"), "剥背景不影响公式渲染与正文");
  ok(calls.length === 1 && !calls[0].includes('class="katex"'), "stripBackgrounds 在 KaTeX 渲染**之前**跑（只处理来源 HTML，保留 \\colorbox 等 KaTeX 语义背景）");

  // —— ④ 接线静态审计：ProblemBody 只在 flush（玻璃档）注入；htmlTheme 导出实现 ——
  const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const comp = readSrc("../apps/desktop/src/components/exthw/ProblemBody.tsx");
  ok(comp.includes("stripInlineBackgrounds"), "ProblemBody：引入 stripInlineBackgrounds");
  ok(comp.includes("stripBackgrounds: stripInlineBackgrounds,"), "ProblemBody：所有皮肤/明暗模式都剥行内背景（底色跟随页面材质）");
  const themeSrc = readSrc("../apps/desktop/src/lib/htmlTheme.ts");
  ok(themeSrc.includes("export function stripInlineBackgrounds"), "htmlTheme：stripInlineBackgrounds 实现导出");
  ok(themeSrc.includes('removeProperty("background-color")') && themeSrc.includes('removeAttribute("bgcolor")'), "stripInlineBackgrounds：背景声明与 bgcolor 呈现属性都剥");
  ok(themeSrc.includes("export function stripInlineColors"), "stripInlineColors 保留（暗底路径行为不变）");
}

console.log(`\n═══ R20-B3 题干内联渲染单测：${pass} 通过 / ${fail} 失败 ═══`);
if (fail > 0) process.exit(1);
