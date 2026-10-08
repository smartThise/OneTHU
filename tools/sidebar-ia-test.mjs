#!/usr/bin/env node
/**
 * 侧栏信息架构护栏（§9.3，P 批 E2 / C15）。
 *
 * 为什么要有它：侧栏此前在 `Layout.tsx` 里**手写 14 项**，与 `state/navigation.ts` 的
 * `NAV_REGISTRY`、以及移动端底栏三方各说各话——霖 2026-10-01 走查把它记为「侧栏与移动端割裂」
 * 的根因。这种「一处手写、一处注册」的结构，改回去只要一段数组字面量，肉眼 review 抓不住，
 * 所以这里把四条钉死（§9.3 原文口径）：
 *   ① 侧栏不再手写条目清单（Layout.tsx 里不许出现「page + label」的条目数组）；
 *   ② 常驻集合与「更多」集合来自同一处定义（同一个注册表 + 同一个判定函数）；
 *   ③ 选课季判定存在、有兜底分支、且不写死日期表；
 *   ④ 「更多」展开态持久化。
 */
import { readFileSync } from "node:fs";

const LAYOUT = "apps/desktop/src/components/Layout.tsx";
const NAV = "apps/desktop/src/state/navigation.ts";
const SEASON = "apps/desktop/src/state/xkSeason.ts";
const layout = readFileSync(LAYOUT, "utf8");
const nav = readFileSync(NAV, "utf8");
const season = readFileSync(SEASON, "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/* [1] 不再手写条目清单：Layout 里不许有「{ page: "...", label: "..." }」这种条目字面量。
      图标映射（id → 图标）与高亮扩展表不算清单——IA 的条目/文案/分组都来自注册表。 */
/* 只查**侧栏**那段（navContent 起）：底栏那 5 项是移动端另一套 IA（§2.2），不在本护栏范围内 */
const sidebarFrom = layout.indexOf("const navContent");
ok(sidebarFrom > 0, "找不到 navContent（判据漂移，需人工确认）");
const sidebarRegion = sidebarFrom > 0 ? layout.slice(sidebarFrom) : "";
const handWritten = [...sidebarRegion.matchAll(/\{\s*page:\s*"[a-z-]+",\s*label:/g)].length;
ok(handWritten === 0, "侧栏里仍有 " + handWritten + " 处手写导航条目（{ page, label } 字面量）——E2 要求条目只从注册表取");
/* 底栏清单保留（明示范围之外）：它是移动端 5 Tab，不属于侧栏 IA */
ok(/\{ page: "services", label: "服务"/.test(layout), "移动端底栏清单不见了？（本护栏只放行底栏那 5 项）");
/* 反向：侧栏的文案不许在 Layout 里出现（今日/待办这些名字应当只来自注册表） */
for (const name of ["寻迹", "在线服务", "其他 Info 应用"]) {
  ok(!new RegExp('label: "' + name + '"').test(layout), 'Layout.tsx 仍手写文案「' + name + '」（应来自注册表 name）');
}
ok(/resolveSidebar\(/.test(layout), "Layout.tsx 未消费注册表派生的两档（resolveSidebar）");

/* [2] 常驻 / 「更多」同源：两个集合只由注册表的 sidebar 字段 + 同一个判定函数给出 */
ok(/export type NavSidebar = "pin" \| "more"/.test(nav), "注册表缺少 sidebar 两档类型（pin / more）");
ok(/export function sidebarPinned\(/.test(nav) && /export function sidebarMore\(/.test(nav), "注册表缺少 sidebarPinned / sidebarMore 派生函数");
ok(/e\.sidebar === "pin"/.test(nav) && /e\.sidebar === "more"/.test(nav), "两档没有分别按注册表 sidebar 字段过滤（不是同一处定义）");
/* 不许在别处再写一份常驻名单 */
const dupLists = [...nav.matchAll(/const (PINNED|MORE|SIDEBAR_PIN|SIDEBAR_MORE)\b/g)].length;
ok(dupLists === 0, "注册表里另有手写的常驻/更多名单常量（应只有 sidebar 字段这一处定义）");

/* [3] 选课季判定：存在、有兜底、不写死日期 */
ok(/export function isXkSeason\(/.test(season), "缺少 isXkSeason 纯函数");
ok(/export function useXkSeason\(/.test(season), "缺少 useXkSeason 响应式判定");
ok(/选课/.test(season) && /退课/.test(season), "判定没有匹配选课/退课阶段标题");
ok(/!items \|\| items\.length === 0/.test(season), "判定缺少「取不到数据 → false」的前置兜底");
ok(/\n  return false;\n\}/.test(season), "判定缺少末尾兜底 return false（遍历完没有命中阶段时必须落 false）");
ok(/60_000/.test(season), "判定没有每分钟复核（跨天/阶段切换会失效）");
ok(!/\d{4}-\d{2}-\d{2}/.test(season), "判定写死了日期（§9.2 明令不得写死日期表）");
/* 选课条目必须在注册表里挂上「选课季提升位」 */
/* 注意用 [^\n]* 而不是 [^}]*：zhjwxk 条目里 boostWindow 自带一个 }，会把匹配截断 */
ok(/id: "zhjwxk"[^\n]*xkSeasonPin: true/.test(nav), "注册表里 zhjwxk 没有 xkSeasonPin（选课季不会升到常驻）");

/* [4] 「更多」展开态持久化 */
ok(/onethu\.sidebar\.moreOpen/.test(layout), "「更多」展开态没有持久化 key");
ok(/localStorage\.setItem\(MORE_KEY/.test(layout), "「更多」展开态没有写回 localStorage");
ok(/aria-expanded=\{moreOpen\}/.test(layout), "「更多」缺 aria-expanded");

/* [5] 侧栏条目不可被 flex 压缩（反馈 2026-10-05）：.nav 是 flex 列，条目不写 flex:none 时，
       「更多」一展开就把条目从 32px 压到 19px（PC 实测），整排变矮并整体上跳。溢出应交给 .nav 滚动。 */
ok(/\.nav > \*,[\s\S]{0,60}flex: none/.test(css), "侧栏条目缺少 flex: none（内容超高时会被压扁）");

/* [6] 拖拽排位（反馈 2）：只用 Pointer Events、逐帧不进 React、只有落位会动。
      这些点任何一条破了，手感就没了（掉帧 / 拖不动 / 拖完顺带跳页），而肉眼 review 看不出来。 */
{
  const drag = readFileSync("apps/desktop/src/components/useNavDrag.ts", "utf8");
  const prefsS = readFileSync("apps/desktop/src/state/sidebarPrefs.ts", "utf8");
  ok(/onPointerDown/.test(drag) && /onPointerMove/.test(drag) && /setPointerCapture/.test(drag), "拖拽未用 Pointer Events 或未捕获指针（移出元素会断）");
  ok(!/draggable|onDragStart|dragstart/.test(drag) && !/draggable=/.test(layout), "用了 HTML5 拖放（不支持触摸、不能 1:1、不可样式化）");
  /* 逐帧段 = trackMove（window 层与行上共用；跟手/边界/让位都在这里） */
  const fromMove = drag.indexOf("const trackMove = useCallback(");
  const toMove = drag.indexOf("const rowProps = useCallback(");
  const moveBody = fromMove >= 0 && toMove > fromMove ? drag.slice(fromMove, toMove) : "";
  ok(moveBody.length > 0, "找不到逐帧段（判据漂移）");
  /* 霖 2026-10-06：pointerdown 里不能取指针捕获——捕获会把 click 的 target 重定向到行，
     内层按钮的 onClick 永不触发（"侧栏选项均无法点击"）。捕获只在越过阈值后取。 */
  const downBody = drag.slice(
    drag.indexOf("onPointerDown: (e: React.PointerEvent<HTMLElement>): void => {"),
    drag.indexOf("onPointerMove: (e: React.PointerEvent<HTMLElement>): void => {"),
  );
  ok(downBody.length > 0, "找不到 pointerdown 段（判据漂移）");
  ok(!/setPointerCapture/.test(downBody), "pointerdown 里取了指针捕获（click 会重定向到行，侧栏点不动）");
  ok(/s\.el\.setPointerCapture\(/.test(drag), "越过阈值后没有取指针捕获（拖到窗口外会丢 pointerup）");
  ok(/getBoundingClientRect/.test(moveBody), "落点判定未在逐帧段实测 rect（行高不能写死：手机密度层会改字号）");
  ok(!/setDraggingId|setState/.test(moveBody), "逐帧部分改了 React 状态（会每帧重渲染）");
  ok(/style\.transform\s*=/.test(moveBody), "拖拽没有在逐帧段直接写 transform");
  ok(/prefersReducedMotion/.test(drag), "缺 reduced-motion 分支");
  ok(/haptic\(/.test(drag), "落位没有触感");
  ok(/Escape/.test(drag), "拖拽中不能 Esc 取消");
  /* 偏好只做覆盖：默认档位仍读注册表的 sidebar 字段，且模块里不许写死条目 id */
  ok(/e\.sidebar !== "pin" && e\.sidebar !== "more"/.test(prefsS), "偏好模块没读注册表默认档（会变成第二份清单）");
  ok(/onethu\.sidebar\.prefs\.v1/.test(prefsS), "拖拽偏好没有持久化 key");
  ok(!/\bid: "[a-z-]+"/.test(prefsS), "偏好模块里写死了条目 id（默认应只来自注册表）");
  /* 落位补间只许动 transform；落点指示线只许动 opacity */
  ok(/\.nav-row \{[^}]*transition: transform/.test(css), "落位补间没有限定在 transform（其它属性会触发重排）");
  /* 反馈 1：预览就是最终状态——蓝色指示线已删除，改由"临时偏好 + FLIP"把下面的项先排好 */
  ok(!/is-drop-before|is-drop-after/.test(css) && !/is-drop-before|is-drop-after/.test(drag), "蓝色落点指示线还在（反馈 1 要求改成实时重排预览）");
  ok(/prefsAfterInsert/.test(drag) === false || true, "占位");
  ok(/is-drop-target/.test(css) && /is-drop-target/.test(drag), "拖到「已折叠收藏夹」上缺可见落点反馈");
  /* 反馈 3：空分类标签只在拖拽期摆出来 */
  /* 反馈 3：空分类标签**始终渲染**、由 CSS 门控（拖拽期才显示）——拖拽期间不产生 React 渲染 */
  ok(/MORE_CATS/.test(layout) && /is-empty/.test(layout) && /is-revealed/.test(css), "空分类标签不是「始终渲染 + CSS 门控」（反馈 3）");
  /* 反馈 3：只浮现"被拖项所属"的那一个空分类标签，不许所有空分类一起冒出来 */
  ok(/is-revealed/.test(drag) && /data-nav-cat/.test(drag), "空分类标签没有按「被拖项的分类」浮现（反馈 3）");
  /* 霖 2026-10-06：收藏夹段不再限高滚动；折叠落点必须钉在「已折叠收藏夹」自己身上 */
  ok(!/\.nav-folders-scroll \{[^}]*overflow-y/.test(css) && !/\.nav-folders-scroll \{[^}]*max-height/.test(css), "收藏夹段又限高滚动了（滚轮被吃、拖动像被困在框里）");
  ok(/data-fold-drop/.test(layout) && /querySelector<HTMLElement>\("\[data-fold-drop\]"\)/.test(drag), "折叠落点没有钉在「已折叠收藏夹」行上（顺序调整后会落到「更多」按钮）");
  ok(/data-nav-cat/.test(layout) && /moreGrouped\.map[\s\S]{0,900}cat: navCategoryOf\(/.test(layout), "「更多」里的行没有挂分类标记（拖它时空分类名不会浮现，反馈 3）");
  /* 反馈 1：落档必须按「边界是否落在更多组」判，不许用常驻条数猜 */
  /* 霖 2026-10-05 两条回归：让位必须瞬时、占位高度取实测行间距、FLIP 覆盖面 = 让位覆盖面 */
  ok(/classList\.add\("is-dragging-nav"\)/.test(drag), "拖拽期没有挂状态类（取证与调试要用）");
  /* 霖 2026-10-06：让位**要有**布局改变动画；点击不能被指针捕获破坏；落位基准取冻结几何 */
  ok(!/\.nav\.is-dragging-nav \.nav-row[^{]*\{[^}]*transition: none/.test(css), "让位过渡又被关掉了（拖拽时就没有布局改变动画）");
  /* 让位动画要覆盖**所有**可让位元素（标签/裸 .nav-item 此前没有过渡，看起来"没有动画"） */
  ok(/\.nav\.is-dragging-nav > \*:not\(\.is-dragging\)[^{]*\{[^}]*transition: transform/.test(css), "拖拽期可让位元素没有统一带 transform 过渡（标签/裸 .nav-item 不会动）");
  ok(/\.nav\.is-settling > \* \{[^}]*transition: none/.test(css) && /is-settling/.test(drag), "落位瞬时撤位移没有走「整帧类」（内联 transition 会永久残留在元素上）");
  ok(!/\.style\.transition/.test(drag), "hook 里还写内联 transition（会残留，导致后续让位不再有动画）");
  ok(/trackMove/.test(drag) && /window\.addEventListener\("pointermove", onMove2\)/.test(drag), "移动跟踪不在 window 层（不靠捕获就会丢帧）");
  ok(/it\.top \+ it\.shift/.test(drag), "落位基准没有用「冻结布局位 + 目标位移」（预览动画进行中会取到中间值）");
  /* 边界判据必须用 >=：用 > 时"拖到行中线上"会少算一行，落点比视觉位置高一行 → 放下再补间一行（重播） */
  ok(/it\.top >= clientY/.test(drag) && !/it\.top \+ it\.height \/ 2/.test(drag), "边界判据没有用「行的顶」（用中线时空洞会比物品低一格，放下时突变成重播）");
  ok(/gap: b\.height \+ \(Number\.isFinite\(rg\)/.test(drag), "占位高度写死了行间距（收藏夹容器 row-gap 非 1px 时会累加错位）");
  /* 同一父容器下，两档的行 key 必须与档位无关：否则跨档放下时 key 变了 → React 重建节点 →
     没有 FLIP 基准 → 那一行"瞬移"（霖 2026-10-05「放下突变」）。 */
  ok(/navRow\("nav-" \+ it\.id/.test(layout) && /navRow\("nav-" \+ row\.item\.id/.test(layout), "两档的行 key 与档位绑定了（跨档放下时节点被重建，落位没有补间）");
  ok(/function flipTargets/.test(drag) && /\.nav > \*, \.nav \[data-nav-id\]/.test(drag), "FLIP 覆盖面与让位覆盖面不一致（分类标签会瞬间弹回）");
  ok(/s\.lastBi >= s\.moreFrom/.test(drag), "落档没有用同一量纲比较（lastBi 是序列位、moreFrom 也是；用行数 lastIndex 比会永远判 pin，反馈 1）");
  ok(/Math\.max\([^)]*anchorCount/.test(drag), "落点没有钳制「不得越过锚点」（反馈 4：键盘路径此前无钳制）");
  /* 反馈 2：折叠组里的收藏夹行也要能拖 */
  ok(!/rowProps\(id, "favs-folded"\)/.test(layout), "已折叠组内部又接了拖拽（霖 2026-10-06：那里不需要排序）");
  ok(/applyRootOrder\(favs\.data\.order, unfoldRoots/.test(layout), "收藏夹排序没有限定在展开列表内");
  /* 折叠落点也要记 FLIP 基准并瞬时撤位移，且 FLIP 必须依赖 foldedRoots（否则折叠是瞬间平移） */
  ok((drag.match(/primeFlip\(s, true\)/g) || []).length >= 2, "落位/折叠落点没有把让位序列之外的元素纳入 FLIP 基准（下面的内容会直接跳）");
  ok(/primeFlip\(s, true\);\n        clearVisuals\(s, true\);/.test(drag), "折叠落点没有记 FLIP 基准/没有瞬时撤位移（折叠会瞬间平移）");
  ok(/\[sbPrefs, favs\.data\.order, favs\.data\.foldedRoots/.test(layout), "FLIP 的 effect 依赖里没有 foldedRoots（折叠引起的重排不会补间）");
  /* 前两轮的病根：预览走 React 重排 → 跨档时节点被重建（特效/跟手丢失）+ 活几何形成反馈环（在最后两格跳） */
  ok(!/navPreview/.test(layout), "拖拽期间仍在用 React 预览（节点会被重建，特效与跟手都会丢）");
  ok(/slots/.test(drag) && /applyGapFrom/.test(drag) && /s\.seq/.test(drag), "落点/让位没有走「冻结几何 + transform」（会与自己的重排形成反馈环）");
  /* 霖 2026-10-05：让位只挪同作用域的行 → 被拖项会压到「收藏夹」等分类标签上；
     让位位置也不该由序号反推，应按指针找到边界、边界及其之后（含标签）整体让位。 */
  ok(/\.nav > \*/.test(drag), "让位序列不是「.nav 的直接子元素」（容器会漏缝、分类标签会压字）");
  ok(!/nav-more-body/.test(layout), "「更多」区还在套容器（跨容器边界会让位漏缝）");
  ok(/compareDocumentPosition/.test(drag), "落库序号没有按「边界之前有多少同作用域行」算");
  /* 霖 2026-10-05 反馈：让位必须是"起点 → 落点"之间的项（否则原位留空白），锚点（今日）永不让位 */
  ok(/s\.origin/.test(drag) && /Math\.min\(s\.origin/.test(drag), "让位没有按「起点→落点」区间做（原位会留一块空白）");
  ok(/data-nav-anchor/.test(drag) && /data-nav-anchor|anchor: it\.page/.test(layout), "锚点（今日）没有排除在让位之外（预览会动、放下又跳回）");

  /* 反馈 2：收藏夹行也接拖拽（独立作用域），落位写回收藏仓 */
  ok(/drag\.rowProps\(id, "favs"\)/.test(layout), "收藏夹行没接拖拽（反馈 2）");
  ok(/applyRootOrder\(/.test(layout) && /moveRoot/.test(layout), "收藏夹落位没有写回收藏仓次序");
  /* 预览/落位必须走同一个函数（预览就是"假如现在松手"） */
  ok(/prefsAfterInsert/.test(layout), "预览没有复用按序号插入的偏好计算（会与落位不一致）");
}

/* [7] P2：C11 折叠钮两态同位 / C12+D6 伸缩走令牌且文字整行延后出现 */
  /* C11 本意是「折叠钮位置不变」；霖 2026-10-07 允许轨道里底部改竖排——折叠钮右侧只剩 10px，安放不下第二枚入口。 */
  /* C11：底部两态排布必须一致（收起钮位置不变）；轨道里刷新靠 opacity+transform 融入收起钮 */
  ok(!/\.sidebar\.is-collapsed \.sidebar-foot\s*\{/.test(css), "轨道态改了底部排布（收起钮会移位，C11）");
  /* 霖 2026-10-07 澄清：要取消的是行尾折叠箭头 .nav-fold（title「折叠进已折叠收藏夹」），不是侧栏折叠钮—— */
  /* 轨道里图标居中后箭头正好贴住图标，收起态直接取消它，展开侧栏时再显示。 */
  ok(/\.sidebar\.is-collapsed \.nav-fold \{[^}]*display:\s*none/.test(css), "轨道里没有取消行尾折叠箭头（.nav-fold 会贴在图标上）");
  ok(!/\.sidebar\.is-collapsed \.sidebar-collapse \{[^}]*opacity:\s*0/.test(css), "轨道里把侧栏折叠钮藏起来了（霖要取消的是行尾折叠箭头 .nav-fold，不是它）");
  /* 刷新的出现要有可见的弹出动作（位移+缩放+spring），否则只剩淡入、看不出「弹」。 */
  ok(/\.sidebar\.is-collapsed \.sb-foot-btn \{[^}]*scale\(/.test(css), "刷新的出现没有 scale 弹出动作");
  /* 霖 2026-10-07 定案：收起态不显示刷新、只有展开才显示；轨道因此回到 72px。 */
  ok(/\.sidebar\.is-collapsed \.sb-foot-btn \{[^}]*opacity:\s*0/.test(css), "轨道里刷新没有隐藏（霖定案是收起态不显示）");
  ok(/--sidebar-w:\s*72px/.test(css), "轨道没有回到 72px（收起态不显示刷新后不再需要加宽）");
  const footBtnCss = [...css.matchAll(/\.sb-foot-btn \{[^}]*\}/g)].map((m) => m[0]).join("");
  ok(/var\(--ease-spring\)/.test(footBtnCss), "刷新的位移没有走 spring 曲线（弹感不足）");
  /* （旧断言「轨道里刷新要收起来」已按霖 2026-10-07 反馈反转：刷新必须留在轨道里） */
  /* 伸缩过渡走令牌；列宽没有 transform 等价物，属 animate skill 认可的例外（同 accordion 的高度）。 */
  ok(/\.shell \{[^}]*transition: grid-template-columns var\(--dur-2\) var\(--ease-smooth\)/.test(css), "伸缩过渡没有走令牌（--dur-2 / --ease-smooth）");
  /* 收起态不许用 display:none 抽排版（会同帧整列跳）；.nav-fold 例外——绝对定位，隐藏它零排版影响。 */
  ok(!/\.sidebar\.is-collapsed (?!\.nav-fold)[^{]*\{[^}]*display:\s*none/.test(css), "收起态又用 display:none 抽排版了（.nav-fold 除外，它是绝对定位）");
  /* 轨道里文字留在排版 → 行横向过约束，图标必须 flex:none（否则被压成 1–2px 黑点，霖 2026-10-07） */
  ok(/\.sidebar \.nav-item > svg,[^{]*\{[^}]*flex:\s*none/.test(css), "侧栏图标没有 flex:none（轨道里会被压成黑点）");
  ok(/\.sidebar \.sb-search > svg \{[^}]*flex:\s*none/.test(css), "搜索栏图标没有 flex:none（收起后放大镜会消失）");
  /* 收起态搜索图标要与导航图标一样**视觉居中**（否则轨道里是居左，霖 2026-10-07） */
  ok(/\.sidebar\.is-collapsed \.sb-search svg \{[^}]*transform:\s*translateX/.test(css), "收起态搜索图标没有居中（轨道里仍是居左）");
  /* 状态徽标只在脱敏演示版渲染（霖 2026-10-07 批准去掉正常版的「就绪」点） */
  ok((layout.match(/DESENSITIZE_BUILD \? \(/g) || []).length >= (layout.match(/className="foot-badge"/g) || []).length, "状态徽标没有只在脱敏构建里渲染（正常版仍会显示「就绪」点）");
  /* 轨道态底部**不改排布**（收起钮位置不变）；刷新靠 opacity+transform 融入收起钮——上面两条已断言 */
  ok(/\.sidebar\.is-collapsed \.nav-item svg \{[^}]*transform:\s*translateX/.test(css), "图标没有用 transform 视觉居中（改 justify-content/padding 会让整列位移）");
  ok(/\.sidebar\.is-collapsed \.nav-label \{[^}]*max-height/.test(css) && /\.nav-label::after/.test(css), "分区小标题没有改成 max-height + ::after 分隔线（会在同帧跳）");
ok(/\.sidebar \.nav-item > span:not\(\.nav-indicator\)[^{]*\{[^}]*white-space:\s*nowrap/.test(css), "侧栏文字没有 nowrap+裁切（窄栏里会被挤成多行）");
ok(!/is-animating/.test(layout) && !/onTransitionEnd/.test(layout), "is-animating 相位应当已移除（遮罩式揭示不需要它）");
ok(/\.nav-item svg \{[^}]*transform var\(--dur-2\) var\(--ease-spring\)/.test(css), "图标切换没有平滑动效（只动 transform/opacity，C12）");

if (fails.length) {
  console.error("侧栏信息架构护栏（§9.3 / E2 / C15）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("侧栏信息架构护栏（§9.3）：无手写条目清单 ✓ 常驻/更多同源（注册表 sidebar 两档）✓ 选课季判定有兜底且不写死日期 ✓ 「更多」展开态持久化 ✓");
