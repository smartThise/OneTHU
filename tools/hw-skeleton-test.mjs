#!/usr/bin/env node
/**
 * A1 护栏：作业加载态必须是**与真实作业卡同几何**的骨架卡。
 *
 * 为什么要有它：霖 2026-10-05 反馈加载时是「页面左半侧一个白色矩形，上面写着正在取作业」——
 * 当时那一支渲染的是裸 `<Card><Empty/></Card>`，而真实内容是 `.hw-card` 轮播（卡宽
 * `min(92%, 430px)`、高 168px、绝对居中），两者几何毫无关系。
 * 这类「加载态与真身不是同一件东西」的问题，改回去只要一行，肉眼 review 也看不出来，
 * 所以这里把「几何同源」钉死：骨架必须复用同一条 class 链，且不得自行声明宽高。
 */
import { readFileSync } from "node:fs";

const PAGE = "apps/desktop/src/pages/TasksPage.tsx";
const CSS = "apps/desktop/src/styles/global.css";
const page = readFileSync(PAGE, "utf8");
const css = readFileSync(CSS, "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/** 取一段源码的块（按大括号配对；够本护栏用） */
function block(src, startIdx) {
  const from = src.indexOf("{", startIdx);
  if (from < 0) return "";
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(startIdx, i + 1); }
  }
  return "";
}

/* [1] 加载分支不得再渲染裸 Card / Empty */
const loadIdx = page.indexOf("state === \"loading\" && flow.length === 0");
ok(loadIdx >= 0, "TasksPage 找不到作业加载分支（判据漂移，需人工确认）");
const branch = loadIdx >= 0 ? page.slice(loadIdx, loadIdx + 400) : "";
ok(!/<Card>/.test(branch.split(") : (")[0]), "加载分支仍在渲染裸 <Card>（几何与真实卡无关）");
ok(/<HwSkeletonCard\s*\/>/.test(branch.split(") : (")[0]), "加载分支未渲染 HwSkeletonCard");

/* [2] 骨架卡复用真实卡那条 class 链：row → dots + carousel → card */
const skIdx = page.indexOf("function HwSkeletonCard");
ok(skIdx >= 0, "TasksPage 找不到 HwSkeletonCard 组件");
const sk = skIdx >= 0 ? block(page, skIdx) : "";
for (const cls of ["hw-carousel-row", "hw-carousel", "hw-card"]) {
  ok(sk.includes('"' + cls + '"') || sk.includes(cls), "骨架卡缺少几何链上的 ." + cls);
}
ok(/className="hw-dots"/.test(sk) && /className="hw-dot is-cur"/.test(sk),
  "骨架卡缺少指示点占位（真卡轨道宽度由点宽决定，缺了卡宽会差十几像素）");

/* [3] 骨架条宽度必须用百分比：写死 px 在窄屏会溢出（反例③） */
const bars = [...sk.matchAll(/className="skeleton"[^>]*width:\s*([^,}]+)/g)].map((m) => m[1].trim());
ok(bars.length >= 2, "骨架条少于 2 条（需求允许 2–3 条：课程 / 标题 / 截止），实为 " + bars.length);
for (const w of bars) ok(/%|var\(/.test(w), "骨架条用了写死宽度 " + w + "（窄屏会溢出，应用百分比）");

/* [4] 文案在卡内居中 */
ok(sk.includes('className="hw-skeleton-note"'), "骨架卡缺少居中说明节点");
ok(/正在获取作业/.test(sk), "骨架卡文案应为「正在获取作业…」");
const noteRule = /\.hw-skeleton-note\s*\{([^}]*)\}/.exec(css);
ok(!!noteRule, "global.css 缺少 .hw-skeleton-note 规则");
if (noteRule) {
  ok(/justify-content:\s*center/.test(noteRule[1]) && /align-items:\s*center/.test(noteRule[1]),
    ".hw-skeleton-note 未在卡内居中（需要 justify-content 与 align-items 双 center）");
}

/* [5] 同几何的关键：骨架修饰类不得自行声明宽高 */
const mod = /\.hw-card\.is-skeleton\s*\{([^}]*)\}/.exec(css);
ok(!!mod, "global.css 缺少 .hw-card.is-skeleton 规则");
if (mod) {
  ok(!/(^|;)\s*(width|height|min-height|max-height)\s*:/.test(mod[1]),
    ".hw-card.is-skeleton 自行声明了宽高 —— 几何必须完全继承 .hw-card，否则与真实卡不再同源");
}
/* 骨架家族的其它规则同样不许碰宽高（避免绕开上一条） */
for (const m of css.matchAll(/\.hw-skeleton[a-z-]*\s*\{([^}]*)\}/g)) {
  ok(!/(^|;)\s*(width|height|min-height|max-height)\s*:/.test(m[1]),
    ".hw-skeleton* 规则声明了宽高（" + m[1].trim().slice(0, 40) + "）");
}

/* [6] 真实卡与骨架卡共用同一份几何：.hw-card 的 width/height 只许有一处定义 */
const cardRule = /\.hw-card\s*\{([^}]*)\}/.exec(css);
ok(!!cardRule, "global.css 找不到 .hw-card 基础规则");
if (cardRule) {
  ok(/width:\s*min\(92%,\s*430px\)/.test(cardRule[1]), ".hw-card 的宽度口径变了（骨架几何随之漂移）");
  ok(/height:\s*168px/.test(cardRule[1]), ".hw-card 的高度口径变了（骨架几何随之漂移）");
}
/* 只数「卡自己」的写死高度：.hw-card / .hw-card.is-x 这类；不含 .hw-card-actions、.hw-card-act 等后代 */
const dupGeo = [...css.matchAll(/\.hw-card(?:\.[a-z-]+)*\s*\{[^}]*\bheight:\s*\d+px/g)].length;
ok(dupGeo === 1, ".hw-card 家族有 " + dupGeo + " 处写死高度（几何应只有一处定义）");

if (fails.length) {
  console.error("作业加载骨架卡护栏（A1）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("作业加载骨架卡护栏（A1）：加载分支无裸 Card ✓ 复用 .hw-carousel-row/.hw-carousel/.hw-card 几何链（含指示点占位）✓ 骨架条百分比宽 ✓ 文案卡内居中 ✓ 修饰类不声明宽高 ✓");
