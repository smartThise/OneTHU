/**
 * 静态守卫：手机文字/排布统一策略 + OH 限额动作卡 + 面板内输入框已删。
 * （2026-10-19 用户点名：省略号回来了 / 左右挤 / 设置栏目 segment 不直观 /
 *   429 不要原文气泡 / 删掉 OH 自己的输入框）
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
/* 文案已走 i18n：中文原文在 zh-CN 词典里，源码里出现的是键。 */
const zhMessages = read("apps/desktop/src/i18n/locales/zh-CN.ts");
const keyFor = (s) => {
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = zhMessages.match(new RegExp('"([^"]+)"\\s*:\\s*"' + esc + '"'));
  return m ? m[1] : null;
};
const hasCopy = (src, s) => src.includes(s) || (keyFor(s) ? src.includes(keyFor(s)) : false);
const gui = read("packages/gui/src/gui.css");
const phone = read("packages/gui/src/styles/phone.css");
const appCss = read("apps/desktop/src/styles/global.css");
const chat = read("apps/desktop/src/plugins/ChatDock.tsx");
const ohCss = read("apps/desktop/src/styles/explorer-oh.css");
const settings = read("apps/desktop/src/pages/Settings.tsx");
const modeControl = read("apps/desktop/src/components/SimpleExperience.tsx");

/* 手机策略表最后加载，且覆盖行/设置行/键值对/页头 */
assert.ok(/@import "\.\/styles\/phone\.css";/.test(gui), "gui.css 必须最后 import phone.css");
assert.ok(/html:root\.is-phone \.og-row \{/.test(phone), "手机行布局规则缺失（.og-row）");
assert.ok(/html:root\.is-phone \.og-kv \{/.test(phone), "手机键值对改为上下排的规则缺失（.og-kv）");
assert.ok(/html:root\.is-phone \.og-settings-row \{/.test(phone), "手机设置行规则缺失");
assert.ok(/html:root\.is-phone \.og-pagehead-main \{ flex: 1 1 100%; \}/.test(phone), "手机页头上下排规则缺失");
assert.ok(/html:root\.is-phone \.row \{\s*flex-wrap: wrap !important;/.test(appCss), "旧版 .row 仍被钉成单行 nowrap");
assert.ok(/html:root\.is-phone \.row-title,[\s\S]{0,200}-webkit-line-clamp: 2/.test(appCss), "旧版 .row-title 手机端缺少两行截断规则");

/* 设置：手机栏目下拉；「使用模式」默认收起 */
assert.ok(/workbench-settings-phone-nav/.test(settings) && /aria-label=\{i18n\("[^"]+"\)\}/.test(settings), "设置栏目手机下拉缺失");
assert.ok(/useState\(false\)/.test(modeControl) && /open\?<Stack/.test(modeControl), "「使用模式」应默认收起（open 初值 false）");

/* OH：429 动作卡 + 面板输入框删除 */
assert.ok(/notice\?: "madmodel-429"/.test(chat), "429 动作卡消息类型缺失");
assert.ok(hasCopy(chat, "一键续签") && hasCopy(chat, "设置自己的 API"), "429 动作卡按钮缺失");
assert.ok(/ensureMadModelToken\(true\)/.test(chat), "「一键续签」没有调用 MadModel 续签");
assert.ok(/goOhRow\("模型 \/ MCP \/ 日志", "advanced"\)/.test(chat), "「设置自己的 API」没有跳到 OH 高级配置");
assert.ok(!/aria-label="给小OH发消息"/.test(chat), "OH 面板内不应再有独立输入框（胶囊是唯一输入口）");
assert.ok(/\.dock-notice \{/.test(ohCss), "429 动作卡样式缺失");

/* OH 高级配置也要有一键续签；自动续期泵确实存在 */
const ohSettings = read("apps/desktop/src/components/OhSettingsPage.tsx");
const mad = read("apps/desktop/src/state/madmodel.ts");
assert.ok(hasCopy(ohSettings, "一键续签"), "OH 设置里的 MadModel 行按钮应叫一键续签");
const advAt = ohSettings.indexOf(keyFor("IM 通道（进阶）") ?? "IM 通道（进阶）");
const madAt = ohSettings.indexOf(keyFor("免费额度（MadModel）") ?? "免费额度（MadModel）");
assert.ok(advAt > 0 && madAt > advAt, "OH 高级配置缺少 MadModel 一键续签行");
const loader = read("apps/desktop/src/plugins/loader.ts");
assert.ok(/startMadModelPump\(\);/.test(loader), "MadModel 自动续期泵没有启动");
assert.ok(/RENEW_BEFORE_EXP_MS/.test(mad) && /10 \* 60_000/.test(mad), "自动续签阈值/巡检间隔缺失");

/* 小 OH 模型源卡片：设置里能续签/选源；完整模式必须回 OH 页面调整 */
const sourceCard = read("apps/desktop/src/components/OhModelSourceCard.tsx");
assert.ok(hasCopy(sourceCard, "一键续签") && /ensureMadModelToken\(true\)/.test(sourceCard), "设置里的模型源卡片缺少一键续签");
assert.ok(hasCopy(sourceCard, "学校 MadModel") && hasCopy(sourceCard, "自己的 API"), "模型源卡片缺少 MadModel/自费 API 选择");
assert.ok(!/OhModelSourceCard/.test(read("apps/desktop/src/pages/Settings.tsx")), "完整模式设置不应再挂模型源卡片（续签/模型都在 OH 高级配置里调）");
assert.ok(/OhModelSourceCard/.test(read("apps/desktop/src/components/SimpleSettings.tsx")), "极简/实用模式设置未挂模型源卡片");

/* 手机白板：完整模式可切自由摆放（拖动/缩放），默认阅读顺序 */
const freeBoard = read("apps/desktop/src/components/FreeBoard.tsx");
const wbCss = read("packages/gui/src/recipes/workbench.css");
assert.ok(/onethu\.board\.phoneCanvas\.v1/.test(freeBoard), "手机白板自由摆放开关未持久化");
assert.ok(/const stack = phonePortrait && orientation === "portrait" && !penOn && !phoneCanvas;/.test(freeBoard), "手机白板 stack 条件未接入自由摆放/横屏判定");
assert.ok(/phone-canvas/.test(freeBoard) && /freeboard-wrap\.phone-canvas \.free-item \{ touch-action: none; \}/.test(wbCss), "手机自由摆放缺少 touch-action 规则");

/* 横屏手机 = 桌面形态（用户 2026-10-19 拍板） */
const platform = read("apps/desktop/src/state/platform.ts");
assert.ok(/横屏（宽大于高、且宽已过手机断点）不再算手机形态/.test(platform), "横屏手机应切桌面形态（platform.ts 注释/逻辑未更新）");

/* 暂存箱长按来源：日程/云盘/GitLab/附件/新闻/标签页/工作区 */
const catchFiles = [
  ["apps/desktop/src/pages/Schedule.tsx", "vaultCatchSchedule"],
  ["apps/desktop/src/pages/ScheduleAgenda.tsx", "vaultCatchSchedule"],
  ["apps/desktop/src/pages/CloudPage.tsx", "vaultCatchCloudFile"],
  ["apps/desktop/src/pages/GitLabPage.tsx", "vaultCatchGitlabProject"],
  ["apps/desktop/src/pages/learn/NoticeDetailPage.tsx", "vaultCatchAttachment"],
  ["apps/desktop/src/pages/learn/AssignmentDetailPage.tsx", "vaultCatchAttachment"],
  ["apps/desktop/src/pages/info/NewsTab.tsx", "vaultCatchAttachment"],
  ["apps/desktop/src/components/explorer/TabStrip.tsx", "vaultCatchTab"],
  ["apps/desktop/src/components/explorer/TabDrawer.tsx", "vaultCatchWorkspace"],
  ["apps/desktop/src/components/explorer/OneGoSheet.tsx", "vaultCatchWorkspace"],
];
for (const [file, fn] of catchFiles) {
  const txt = read(file);
  assert.ok(txt.includes(fn) && txt.includes("data-vault-catch"), `${file} 缺少 data-vault-catch（${fn}）`);
}
const registry = read("apps/desktop/src/state/vaultRegistry.ts");
for (const kind of ["cloud-file", "cloud-folder", "learn-notice", "learn-attachment", "news-file", "gitlab-project", "workspace", "tab", "schedule"]) {
  assert.ok(registry.includes(`"${kind}"`), `vaultRegistry 缺少 ${kind} 打开方式`);
}
/* 手机长按：触摸抖动放宽 + 吞原生 contextmenu */
const vaultDrag = read("apps/desktop/src/components/vault/vaultDrag.ts");
assert.ok(/pointerType === "touch" \? 14/.test(vaultDrag), "触摸长按抖动上限仍为 8px（手机易被取消）");
assert.ok(/onContextMenu/.test(vaultDrag) && /data-vault-catch/.test(vaultDrag), "手机长按缺少原生菜单抑制");

/* 来访报备：autosubmit + OH 工具 */
const visitDraft = read("apps/desktop/src/state/visitDraft.ts");
const facade = read("apps/desktop/src/plugins/facade.ts");
const visitTab = read("apps/desktop/src/pages/info/VisitTab.tsx");
const rustTools = read("plugins/OneTHU-Harness/core/src/tools.rs");
assert.ok(/pendingSubmit/.test(visitDraft) && /opts\?\.submit/.test(visitDraft), "visitDraft 缺少自动提交标记");
assert.ok(/submit: opts\?\.submit === true/.test(facade), "facade.visit.fill 缺少 submit 透传");
assert.ok(/autoSubmit/.test(visitTab) && /AUTO_SUBMIT_FROM_OH/.test(visitTab), "VisitTab 缺少自动提交");
assert.ok(/name: "visit_fill"/.test(rustTools) && /"visit", "fill"/.test(rustTools), "OH 缺少 visit_fill 工具");

/* 拖入暂存箱 = 文件自动缓存到云盘；日程可选加入我的日程 */
const catches = read("apps/desktop/src/lib/vaultCatch.ts");
const vaultRemote = read("apps/desktop/src/lib/vaultRemote.ts");
const vaultCloudTs = read("apps/desktop/src/state/vaultCloud.ts");
const vaultDragTs = read("apps/desktop/src/components/vault/vaultDrag.ts");
assert.ok(/remote: \{ kind: "seafile"/.test(catches), "云盘文件拖入应带 seafile remote（自动下载缓存）");
assert.ok(/remote: \{ kind: a\.kind, url: a\.url \}/.test(catches), "附件拖入应带 remote url（自动下载缓存）");
assert.ok(/cacheRemoteFileToVault/.test(vaultDragTs), "拖入后未触发自动缓存");
assert.ok(/cacheVaultFiles/.test(vaultRemote) && /\/Vault\/cache/.test(vaultCloudTs), "缺少暂存箱云盘缓存实现");
assert.ok(/offerScheduleToCalendar/.test(vaultRemote) && /offerScheduleToCalendar/.test(read("apps/desktop/src/state/vaultRegistry.ts")), "日程条目缺少「是否加入我的日程」选择");

/* 悬浮球默认开却看不见的 bug：启动要真正 show，设置页进入时同步 */
const overlayLib = read("apps/desktop/src/lib/overlay.ts");
const mainTs = read("apps/desktop/src/main.tsx");
assert.ok(/export async function syncOverlayPreference/.test(overlayLib), "overlay.ts 缺少启动同步函数");
assert.ok(/syncOverlayPreference\(\)/.test(mainTs), "启动未调用 syncOverlayPreference（默认开的球不会显示）");
assert.ok(/syncOverlayPreference/.test(read("apps/desktop/src/components/OverlaySettingsSection.tsx")), "设置页进入时未同步真实显示状态");

console.log("✓ 手机策略 + OH 限额卡静态守卫通过");
