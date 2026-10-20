import { compactPageAllowed, useIsSimpleLike } from "../state/experienceMode.js";
/** 常驻对话面板（宿主胶水，R2/R4/R5 的 dock 面）：
 *  发现 activate 返回 dock:true 命令的已启用 rust 插件 → 显示常驻气泡；
 *  对话/会话/导出/用量全部走该插件的 JSON-RPC run 命令（结构化契约见
 *  OneTHU-Harness README 与接口指南 §九），本组件不含任何业务逻辑。
 *
 *  v3 交互（用户拍板，灵动岛）：
 *  - 底部中央胶囊（左 OH 标识 + 右智能文本），不再拖拽；
 *  - 智能文本：30 分钟内日程 → 「地点·还有X分钟」；提醒窗口内作业 → 「作业名·还有X分钟」；
 *    默认「点击输入，长按说话」（state/island.ts 的入口文案）；文本切换键盘下坠动画，胶囊宽度随内容伸缩；
 *  - 点击向上展开 50% 高 × 86% 宽面板（不全屏），关闭缩回；
 *  - 长按（≥450ms）→ 胶囊**自然变长**（宽度/圆角/高度/背景 300ms 同过渡）+ 一层雾
 *    （backdrop-filter）+ 随音量跳动的点点波纹，雾里实时显示识别出的字；
 *    松手 → 整句经 ohAsk() **作为完整一条消息直接喂给 OH**（不进输入框，2026-10-10 用户拍板）；
 *  - 单击 → 展开面板；面板底部默认只留一行入口按钮「点击输入，长按说话」，
 *    点它才展开原来的文本输入框（长按它同样进语音；桌面无原生识别时明确降级提示）；
 *  - 会话切换不清空累计用量（总量跨会话持久，仅本会话计数归零）。
 *
 *  OneGUI 收编（2026-10-14，oh.dock scope）：外观全部来自 @onethu/gui ——
 *  面板壳挂 data-og-scope="oh.dock"（dockScope.ts 登记面/线档，StyleDirector 调度），
 *  面板内组件直接用 OG 组件（Btn/IconBtn/Chip/AccordionItem/Banner/Row/Spinner/Text）；
 *  旧 global.css 的 .dock-* 独占段整体退役，语音链（波纹引擎/雾状字幕/--dock-cancel
 *  取消渐进/冻结页）、.dock-md 排印豁免（GlobalOrb 等共用）、底栏共享兜底三段保留。
 */
import {
  memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import Markdown from "react-markdown";
import { navGo } from "./bridges.js";
import { openSettings } from "../state/explorer.js";
import remarkGfm from "remark-gfm";
import {
  AccordionItem, Banner, Btn, Chip, IconBtn, Row, Spinner, Text, TextArea,
} from "@onethu/gui";
import "./dockScope.js"; // OH 对话坞专属档位登记（scope: oh.dock，dockScope.ts，受 OneGUI StyleDirector 调度）
import { callRust, notifyRust } from "./rust.js";
import { commandsSnapshot, subscribeCommands } from "./loader.js";
import { EMPTY_EVENTS, pluginEvents, subscribePluginEvents } from "./events.js";
import { IconClock, IconDownload, IconPlus, IconSpark, IconSpeak, IconSpeakOff, IconUpload, IconX } from "../components/Icons";
import { AttachTray } from "../components/AttachTray.js";
import { AttachActionsSheet, type AttachActionDone } from "../components/AttachActionsSheet.js";
import { bytesToDataUrl, fileToBytes, formatSize, mimeFromName, releaseAttachPreviews, type AttachFile } from "../lib/attach.js";
import { openImageViewer } from "../components/ImageViewer.js";
import { HarnessMark } from "../components/HarnessMark.js";
import { XiaodaPane } from "./XiaodaPane.js";
import { speechAvailable, speechLevel, speechPoll, speechStart, speechStop, speechUnavailableHint } from "../lib/speech.js";
import { onTtsDone, previewSpeak, speakReply, ttsStop, ttsSupported } from "../lib/tts.js";
import { readVoicePrefs, setVoicePrefs, useVoicePrefs } from "../state/voicePrefs.js";
import { requestSettingsTab } from "../state/settingsMode.js";
import { ensureMadModelToken } from "../state/madmodel.js";
import { goOhRow } from "../components/OhSettingsPage.js";
import { showToast } from "../state/toast.js";
import { onOhCommand, type OhCommand, type OhMode } from "./ohControl.js";
import { useOhSearch, jumpEntry, jumpAtom, jumpSearchRow, jumpSettingsTab, jumpTabPayload } from "./ohSearch.js";
import { explorerPrefsSnapshot, useSearchHistory, type SearchJump } from "../state/explorerPrefs.js";
import { displayBreadcrumb } from "../state/searchRows.js";
import { setCreative, subscribeUserExt, userExtSnapshot } from "../state/userext.js";
import "../styles/explorer-oh.css"; // dev-explorer：胶囊/搜索模式样式（悬浮球窗口同 bundle，一处引入两端生效）

import { isAndroidNavigator } from "../lib/androidHost.js";
import { isPhoneNow } from "../state/phoneSheets.js";
import { openExternal } from "../pages/info/openExternal.js";
import { vaultCatchAttr } from "../components/vault/vaultDrag.js";
import { t as i18n } from "../i18n/index.js";


/* eslint-disable @typescript-eslint/no-explicit-any */

/* ══════════ OneGUI 收编 · 外观常量（scope: oh.dock，见 dockScope.ts） ══════════
 *  颜色/字阶/描边/阴影零字面：全部引用 --og-* 语义令牌（oh.dock scope 把面/线档抬到
 *  浮体档）；这些对象都经模块常量/纯函数持有，不落在 JSX 的 style={{…}} 字面里（R2 棘轮）。
 *  几何常量属回落行为几何（胶囊量不到时的居中底板与尺寸口径），沿用 GlobalOrb 的
 *  BALL_VISUAL 判例：行为几何走 JS 常量；动效时长：旧 keyframes 无令牌档的毫秒保持
 *  JS 常量（一一对齐旧值），曲线走 --og-ease-*，短时长走 --og-dur-* 档。 */
const OPEN_KEY = "onethu.chatdock.open";

/** 旧 dock-panel-in / dock-panel-slide 的毫秒（判例：无 --og-dur 档的旧 keyframes 时长保持常量） */
const PANEL_IN_MS = 380;
const PANEL_SLIDE_MS = 420;

/** 面板壳材质 = .og-panel 浮层同款取值（overlay 面 + 顶沿光 + 强线 + 投影；scope 已把 line-1 抬到 line-2） */
const DOCK_PANEL_MAT: CSSProperties = {
  background: "var(--og-fill-overlay)",
  backgroundImage: "var(--og-overlay-tint)", // 玻璃的顶沿光（旧内描边上沿高光同位，属 OG 浮层族七件套）
  border: "1px solid var(--og-line-1)", // oh.dock scope: line-1→line-2（浮体边，等旧 70% inset 环）
  boxShadow: "var(--og-elev-menu)",
  color: "var(--og-content-1)",
  WebkitBackdropFilter: "var(--og-overlay-blur)",
  backdropFilter: "var(--og-overlay-blur)",
};
/** 安卓 WebView 降级（旧 html.is-phone .dock-panel）：不再叠 backdrop-filter（滚动掉帧红线），整块走实档面 */
const DOCK_PANEL_MAT_PHONE: CSSProperties = {
  background: "var(--og-surface-1)",
  backgroundImage: "none",
  border: "1px solid var(--og-line-1)",
  boxShadow: "var(--og-elev-2)",
  color: "var(--og-content-1)",
};

/** 回落底板的公共几何（fixed 浮窗、列向排布、命中区＝面板矩形本身） */
const PANEL_GEO_COMMON: CSSProperties = {
  position: "fixed",
  zIndex: 9992,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  pointerEvents: "auto",
};
/** 桌面回落底板：胶囊量不到时的居中形态（原 .dock-panel 基块几何；62vh/420px 是用户拍的默认高——行为档案） */
const PANEL_GEO_FALLBACK: CSSProperties = {
  ...PANEL_GEO_COMMON,
  left: "50%",
  bottom: "calc(18px + env(safe-area-inset-bottom, 0px))",
  width: "86vw",
  height: "62vh",
  minHeight: 420,
  maxHeight: "calc(100vh - 40px)", // 旧 36 → --og-space-8(40) 档（只防出屏的兜底档）
};
/** 手机回落底板：满水平轴半屏抽屉（原 explorer-oh html.is-phone .dock-panel 的几何并入） */
const PANEL_GEO_FALLBACK_PHONE: CSSProperties = {
  ...PANEL_GEO_COMMON,
  left: 6,
  right: 6,
  bottom: "calc(18px + env(safe-area-inset-bottom, 0px))",
  width: "auto",
  height: "60vh",
  minHeight: 0,
  maxHeight: "94vh",
};

/** 面板过场（旧 dock-panel-in/out 首尾帧平移）：grow 路径的形态动画仍由 explorer-oh.css 契约承担 */
const TR_PANEL_IN = `opacity ${PANEL_IN_MS}ms var(--og-ease-decelerate), transform ${PANEL_IN_MS}ms var(--og-ease-decelerate), border-radius ${PANEL_IN_MS}ms var(--og-ease-decelerate)`;
const TR_PANEL_OUT = `opacity var(--og-dur-3) var(--og-ease-accelerate), transform var(--og-dur-3) var(--og-ease-accelerate), border-radius var(--og-dur-3) var(--og-ease-accelerate)`;
/** 入场相位（原 keyframes from 帧：opacity .25 / 上移 14px / 圆角满——命中区从首帧就是最终矩形，只动这三样；
 *  圆角用四角 longhand（不与面板壳的 borderRadius 组合搭 shorthand——React 警告规范） */
const PANEL_IN_PHASE = (phone: boolean): CSSProperties => ({
  opacity: 0.25,
  transform: phone ? "translateY(14px)" : "translateX(-50%) translateY(14px)",
  borderTopLeftRadius: "var(--og-radius-full)",
  borderTopRightRadius: "var(--og-radius-full)",
  borderBottomLeftRadius: "var(--og-radius-full)",
  borderBottomRightRadius: "var(--og-radius-full)",
});
/** 退场相位（原 dock-panel-out to 帧：缩回胶囊方向再沉一点） */
const PANEL_OUT_PHASE = (phone: boolean): CSSProperties => ({
  opacity: 0,
  transform: phone ? "translateY(10px)" : "translateX(-50%) translateY(10px)",
  borderTopLeftRadius: "var(--og-radius-full)",
  borderTopRightRadius: "var(--og-radius-full)",
  borderBottomLeftRadius: "var(--og-radius-full)",
  borderBottomRightRadius: "var(--og-radius-full)",
});

/** 面板壳的材质 + 圆角 + 过场合成（phone=安卓降级 / grew=胶囊生长契约生效 / phase=过场相位）。
 *  圆角口径：顶角 --og-radius-xl（OneGUI 面板档，与 Modal/Sheet 同档；旧桌面 24 → 档位公差）；
 *  底角：grow 交给 explorer-oh 契约（.ohx-panel-grow 的 14px 原样），回落自己给（手机 sheet 平底）。 */
const panelMat = (phone: boolean, grew: boolean, phase: "in" | "base" | "out"): CSSProperties => ({
  ...(phone ? DOCK_PANEL_MAT_PHONE : DOCK_PANEL_MAT),
  borderTopLeftRadius: "var(--og-radius-xl)",
  borderTopRightRadius: "var(--og-radius-xl)",
  ...(grew ? {} : (phone ? {} : {
    borderBottomLeftRadius: "var(--og-radius-xl)",
    borderBottomRightRadius: "var(--og-radius-xl)",
  })),
  ...(grew ? {} : { transformOrigin: "50% 100%" }),
  ...(grew ? {} : {
    transition: phase === "out" ? TR_PANEL_OUT : TR_PANEL_IN,
    ...(phase === "out" ? PANEL_OUT_PHASE(phone) : phase === "in" ? PANEL_IN_PHASE(phone) : null),
  }),
});

/** 用户气泡材质（旧 .dock-msg + .dock-msg-user；accent 柔面 + 柔线描边 + 说话侧 6px 尾角=--og-radius-sm）。
 *  正文走密度档：桌面 --text-base / 手机 --text-sm（与保留段 .dock-md 排印族同源，正文字号一致性优先）。 */
const matBubbleUser = (phone: boolean): CSSProperties => ({
  alignSelf: "flex-end",
  maxWidth: "84%",
  padding: "var(--og-space-2) var(--og-space-3)",
  fontSize: phone ? "var(--text-sm)" : "var(--text-base, var(--md-sys-typescale-body))",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  color: "var(--og-content-1)",
  background: "var(--og-composer-fill)",
  border: "0",
  WebkitBackdropFilter: phone ? "none" : "var(--og-surface-blur)",
  backdropFilter: phone ? "none" : "var(--og-surface-blur)",
  borderRadius: "var(--og-radius-xl) var(--og-radius-xl) var(--og-radius-sm) var(--og-radius-xl)",
  boxShadow: "none",
  transition: `opacity var(--og-dur-2) var(--og-ease-spring), transform var(--og-dur-2) var(--og-ease-spring)`,
});

/** OH 气泡的壳与正文容器（旧 .dock-msg-assistant 壳 + 内层 .dock-msg 的 padding/形态）。
 *  结构不变：壳只出玻璃材质，正文 padding/字阶挂内层 .dock-msg（类名保留做排印锚点）。 */
const matBubbleOh = (phone: boolean): CSSProperties => ({
  alignSelf: "flex-start",
  background: "transparent",
  border: "0",
  WebkitBackdropFilter: phone ? "none" : "var(--og-surface-blur)",
  backdropFilter: phone ? "none" : "var(--og-surface-blur)",
  borderRadius: "var(--og-radius-xl) var(--og-radius-xl) var(--og-radius-xl) var(--og-radius-sm)",
  color: "var(--og-content-1)",
  boxShadow: "none",
  transition: `opacity var(--og-dur-2) var(--og-ease-spring), transform var(--og-dur-2) var(--og-ease-spring)`,
});
/** 内层正文容器（旧 .dock-msg 在 OH 气泡里的 padding/字阶/形态；背景由壳出） */
const matBubbleOhBody = (phone: boolean): CSSProperties => ({
  maxWidth: "84%",
  padding: "var(--og-space-2) var(--og-space-3)",
  fontSize: phone ? "var(--text-sm)" : "var(--text-base, var(--md-sys-typescale-body))",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
});

/** 最新一条的挂载相位（旧 @keyframes dock-msg-pop from 帧：opacity 0 / 上移 6px / scale .94） */
const MSG_FROM: CSSProperties = { opacity: 0, transform: "translateY(6px) scale(0.94)" };

/** 消息列容器（旧 .dock-msgs）：布局/间距走 --og-space-*；手机档收紧（原 html.is-phone 两档） */
const matMsgs = (phone: boolean): CSSProperties => ({
  flex: 1,
  overflowY: "auto",
  touchAction: "pan-y",
  overscrollBehavior: "contain",
  WebkitOverflowScrolling: "touch",
  display: "flex",
  flexDirection: "column",
  padding: phone
    ? "var(--og-space-3) var(--og-space-3) var(--og-space-2)"
    : "var(--og-space-4) var(--og-space-4) var(--og-space-2)",
  gap: phone ? "var(--og-space-2)" : "var(--og-space-3)",
});

/** 开场空态（旧 .dock-empty，历史会话里也复用这一份） */
const matEmpty: CSSProperties = {
  margin: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  justifyContent: "center",
  gap: "var(--og-space-6)",
  padding: "var(--og-space-2) var(--og-space-3)",
  textAlign: "left",
  minHeight: "100%",
};
/** 开场三行大字的行/字（旧 .dock-hero/.dock-hero-line/.dock-hero-ch；逐字坠落相位由 useMountPhase 驱动） */
const MAT_HERO: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "flex-start",
  gap: "var(--og-space-2)",
};
const MAT_HERO_LINE: CSSProperties = { display: "flex" };
const MAT_HERO_CH: CSSProperties = {
  fontSize: "var(--og-text-title)", // 旧 22px → OneGUI 标题档 20（档位公差）
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "var(--og-content-1)",
  transition: `opacity ${PANEL_SLIDE_MS}ms var(--og-ease-spring), transform ${PANEL_SLIDE_MS}ms var(--og-ease-spring)`,
};
const MAT_HERO_CH_FROM: CSSProperties = { opacity: 0, transform: "translateY(-34px) scale(0.9)" };
/** 建议芯片容器（旧 .dock-empty-chips；芯片本体走 OG Chip） */
const matEmptyChips = (settled: boolean): CSSProperties => ({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-start",
  gap: "var(--og-space-2)",
  maxWidth: "var(--og-ctl-modal-sm)", // 旧 320px 画布宽度档
  transition: `opacity var(--og-dur-3) var(--og-ease-standard)`,
  transitionDelay: "1850ms", // 旧 dock-chips-in 1.85s 延迟（大字落定后浮现）
  opacity: settled ? 1 : 0,
});
/** 附件窄屏的图片瓦片与占位（旧 .dock-imgs/.dock-img/.dock-img-miss） */
const MAT_IMGS: CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: "var(--og-space-2)",
  marginBottom: "var(--og-space-1)",
};
const MAT_IMG_TILE: CSSProperties = {
  padding: 0, lineHeight: 0, overflow: "hidden", cursor: "zoom-in",
  border: "1px solid var(--og-line-1)", borderRadius: "var(--og-radius-lg)", background: "var(--og-surface-1)",
};
const MAT_IMG_TILE_IMG: CSSProperties = {
  display: "block", width: "auto", height: "auto",
  maxWidth: "min(240px, 60vw)", maxHeight: 200, objectFit: "cover",
};
const MAT_IMG_MISS: CSSProperties = { color: "var(--og-content-3)", fontSize: "var(--og-text-micro)" };
/** 头部行与两侧（旧 .dock-head/.dock-title/.dock-ops） */
const MAT_HEAD: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: "var(--og-space-2)",
  padding: "var(--og-space-3) var(--og-space-3) var(--og-space-3) var(--og-space-4)",
  flexWrap: "nowrap",
};
const MAT_TITLE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "var(--og-space-2)" };
const matOps: CSSProperties = {
  display: "flex", gap: "var(--og-space-1)", flexWrap: "nowrap", justifyContent: "flex-end", flexShrink: 0,
};
/** 消息操作行（旧 .dock-msg-ops：朗读键所在行） */
const MAT_MSG_OPS: CSSProperties = {
  display: "flex", gap: "var(--og-space-2)", marginTop: "var(--og-space-1)",
  // 旧 hover 才浮现的 50% 呼吸收编后不可行（inline 无法 :hover）：常显 ghost 图标钮，出声态由 is-on 提亮
  opacity: 0.72,
};
/** 思考链正文的多行排版（旧 .dock-think-body 的 pre-wrap/字断/滚动上限） */
const MAT_PRE: CSSProperties = {
  whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: "100%",
  maxHeight: 220, overflowY: "auto",
};
/** 流式状态行（旧 .dock-thinking：思考提示 + 号角） */
const MAT_INLINE_ROW: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "var(--og-space-2)",
};
/** 历史会话手写浮层（面板族的「手写 Sheet 模式」：锚在面板内，不走 portal——外点收窗守卫无需改动 */
const matHistorySheet = (settled: boolean): CSSProperties => ({
  position: "absolute",
  inset: "44px 0 64px 0",
  zIndex: 1,
  background: "var(--og-fill-overlay)",
  backgroundImage: "var(--og-overlay-tint)",
  border: "1px solid var(--og-line-1)",
  borderRadius: "var(--og-radius-lg)",
  boxShadow: "var(--og-elev-menu)",
  WebkitBackdropFilter: "var(--og-overlay-blur)",
  backdropFilter: "var(--og-overlay-blur)",
  display: "flex", flexDirection: "column",
  overflowY: "auto",
  padding: "var(--og-space-2) var(--og-space-3)",
  gap: "var(--og-space-1)",
  transition: `opacity var(--og-dur-2) var(--og-ease-standard), transform var(--og-dur-2) var(--og-ease-standard)`,
  ...(settled ? {} : { opacity: 0, transform: "translateY(4px)" }),
});
const MAT_HIST_HEAD: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "var(--og-space-1) var(--og-space-1) var(--og-space-2)",
};

/** 挂载相位（ohOrb settled 判例）：首帧落 from 值，双 rAF 后翻 true → transition 滑回基态。
 *  旧 keyframes 是全局 <style> 的挂载动画；transition 没有挂载帧，靠这个相位补同一拍。
 *  on=false 复位（长命组件的每帧重演：面板每次打开都要重放入场）；缺省 on=true =
 *  短命子组件的挂载一次（翻牌后不再回退——历史气泡不闪帧）。 */
function useMountPhase(on = true): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!on) {
      setSettled(false);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [on]);
  return settled;
}

/* 平台判定：安卓才有「显示在其他应用上层」这道系统权限窗。
   桌面端现在 overlayDesktop 还是骨架（supported=false）→ 按钮本就不渲染；
   等桌面适配器落地、按钮在桌面出现时，这条判定能保证不去误跳安卓授权页。 */
const IS_ANDROID = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);

/* ══════════ OH 直达（UI/UX 改造 §2.7 P0：搜索页「问 OH」透传） ══════════
 * 模块级 pending 请求 + useSyncExternalStore：外部（如 ServicesPage 搜索）调
 * ohAsk(text) → ChatDock 消费：打开面板并直接以该文本发送。未挂载（登录前）
 * 则请求留在模块级，挂载后消费。seq 防同文本重复触发。 */
interface OhPromptReq {
  text: string;
  seq: number;
}
let ohPrompt: OhPromptReq | null = null;
const ohPromptListeners = new Set<() => void>();
export function ohAsk(text: string): void {
  const t = text.trim();
  if (!t) return;
  ohPrompt = { text: t, seq: (ohPrompt?.seq ?? 0) + 1 };
  for (const l of ohPromptListeners) l();
}
function subscribeOhPrompt(fn: () => void): () => void {
  ohPromptListeners.add(fn);
  return () => {
    ohPromptListeners.delete(fn);
  };
}
function ohPromptSnapshot(): OhPromptReq | null {
  return ohPrompt;
}
/* dev-explorer：未读徽标外送（OhCapsule 读，纯只读；面板开着不计数） */
let dockBadge = 0;
const badgeListeners = new Set<() => void>();
function setDockBadge(n: number): void {
  if (dockBadge === n) return;
  dockBadge = n;
  for (const f of badgeListeners) f();
}
export function subscribeDockBadge(f: () => void): () => void {
  badgeListeners.add(f);
  return () => {
    badgeListeners.delete(f);
  };
}
export function dockBadgeSnapshot(): number {
  return dockBadge;
}
export function useDockBadge(): number {
  return useSyncExternalStore(subscribeDockBadge, dockBadgeSnapshot, () => 0);
}
/* ══════════ 创造模式（2026-10-13）：userext 开关的小窗呈现 ══════════
   状态真源 = state/userext.ts（随 onethu.userext.v1 持久）；这里只切开关 + 渲染激活态。
   新值经 facade.settings.get 的 creativeMode 泵进引擎，Rust 每轮 run 实时读 → 下轮对话生效。 */
function creativeSnapshot(): boolean {
  return userExtSnapshot().creative;
}
/* ══════════ dev-explorer 二轮：胶囊 ⇄ 面板的共享 UI 通道 ══════════
   OhCapsule（底栏胶囊）与面板是一个连续交互体：胶囊常态像输入框、展开后**就是**输入框、
   收音时是波纹条。这些状态活在 ChatDock，经只读快照外送（useDockUi）；草稿文本双向
   （胶囊输入框 ⇄ 发送按钮）经 dockInput 通道；提交动作经 dockSubmitInput() 注册表。 */

export type DockVoice = "off" | "arming" | "listening" | "sending";

interface DockUiState {
  /** 面板可见（含退场动画期）——胶囊据此切 is-open（真输入框） */
  open: boolean;
  /** 面板形态：search=搜索（胶囊输入=检索词）/ oh=对话（胶囊输入=消息草稿） */
  mode: OhMode;
  voice: DockVoice;
  /** 波纹条提示文案（与面板内同源：取消/授权/松手直发…） */
  hint: string;
}

let dockUi: DockUiState = { open: false, mode: "oh", voice: "off" as DockVoice, hint: "" };
const dockUiListeners = new Set<() => void>();
function setDockUi(patch: Partial<DockUiState>): void {
  let changed = false;
  for (const k of Object.keys(patch) as Array<keyof DockUiState>) {
    if (dockUi[k] !== patch[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  dockUi = { ...dockUi, ...patch };
  for (const f of dockUiListeners) f();
}
export function subscribeDockUi(f: () => void): () => void {
  dockUiListeners.add(f);
  return () => {
    dockUiListeners.delete(f);
  };
}
export function dockUiSnapshot(): DockUiState {
  return dockUi;
}
/** 组件里读胶囊 ⇄ 面板共享 UI 态（OhCapsule 的形态切换真源） */
export function useDockUi(): DockUiState {
  return useSyncExternalStore(subscribeDockUi, dockUiSnapshot, dockUiSnapshot);
}

/** 语音提示文案（纯函数：渲染与 dockUi 同步共用一份，永不打架） */
function voiceHintOf(voice: DockVoice, cancelling: boolean, mode: OhMode): string {
  if (cancelling && voice !== "off") return "松开取消";
  if (voice === "arming") return "首次需弹窗允许";
  if (voice === "sending") return "正在发送…";
  return mode === "search" ? "松手搜索" : mode === "xiaoda" ? "松手直发清小搭" : "松手直发 OH";
}

/* 草稿通道：胶囊输入框是唯一编辑入口（面板内不再有第二个文本框），发送按钮读同一份 */
let dockInputValue = "";
const dockInputListeners = new Set<() => void>();
export function setDockInputValue(v: string): void {
  if (dockInputValue === v) return;
  dockInputValue = v;
  for (const f of dockInputListeners) f();
}
export function dockInputSnapshot(): string {
  return dockInputValue;
}
export function subscribeDockInput(f: () => void): () => void {
  dockInputListeners.add(f);
  return () => {
    dockInputListeners.delete(f);
  };
}
/** 组件内注册的提交动作（mode=oh：草稿作为消息直发） */
let dockSubmitFn: ((text: string) => void) | null = null;
/** 清小搭小窗自己的提交动作：mode=xiaoda 时胶囊回车交给它，与 OH 的发送完全隔离 */
let xiaodaSubmitFn: ((text: string) => void) | null = null;
export function registerXiaodaSubmit(f: ((text: string) => void) | null): void {
  xiaodaSubmitFn = f;
}
export function dockSubmitInput(): void {
  const t = dockInputValue.trim();
  if (!t) return;
  dockSubmitFn?.(t);
}

/** 灵动岛：长按判定时长（毫秒）——超过即进入语音，未超过视为点击 */
const VOICE_HOLD_MS = 450;
/** 面板高度偏好（顶部把手拖出来的高度；没存过就用 CSS 的 62vh 默认） */
const DOCK_H_KEY = "onethu.dock.panelHeight";
/** 竖直拖动的区间：视口高的 30%–80%（用户：可以上下拖动拉长拉短悬浮窗） */
const DOCK_H_MIN_RATIO = 0.3;
const DOCK_H_MAX_RATIO = 0.8;
function readDockHeight(): number | null {
  try {
    const v = Number(localStorage.getItem(DOCK_H_KEY) ?? "");
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
/** 松手后等待识别器吐最终结果的宽限 */
const VOICE_FINAL_GRACE_MS = 320;
/** 上划取消的位移阈值（px）：按住后**向上拉到取消区**再松手才算取消。
 *  2026-10-10 用户反馈「取消太快了」→ 56 → 110（并让 0→阈值 之间只是**提示区**，不产生任何后果）。 */
const CANCEL_PULL_PX = 110;
/** 波纹点个数（5~9 档，取 7：克制的节奏感）——高度/透明度由电平驱动 */
const WAVE_DOTS = 7;
/** 电平轮询间隔：比转写轮询（180ms）快一点，波纹才跟得上嘴 */
const LEVEL_POLL_MS = 90;
/** 雾状字幕只显示转写末尾若干字：长句保持一行，突出「最新说出的词」 */
const LIVE_TAIL_CHARS = 34;
/** 语音结束后字幕多留一拍再淡出（渐出；与条收窄的 300ms 节奏对齐） */
const SUB_LINGER_MS = 240;

/** 语音态条内内容（灵动岛与面板入口条共用）：只剩**随音量跳动的波纹点** + 一行提示。
 *  识别出的字一律放条**上方**那层雾状字幕带（VoiceSubtitle）——两处不重复显示（Lead 2026-10-10 口径）。
 *  点的高度/透明度由 ChatDock 的电平循环直接写 DOM 样式（不进 React 状态，60fps 不重渲染）。
 *  dev-explorer 二轮：导出给 OhCapsule——收音中的胶囊本体就是这条波纹。 */
export function VoiceBar({ hint }: { hint: string }): ReactNode {
  return (
    <span className="dock-voicebar">
      <span className="dock-wave" aria-hidden="true">
        {Array.from({ length: WAVE_DOTS }, (_, i) => (
          <i className="dock-wave-dot" key={i} />
        ))}
      </span>
      <span className="dock-voicebar-hint">{hint}</span>
    </span>
  );
}

/** 条**上方**的雾状字幕带：雾里显示目前识别出来的字（用户原话：「上面稍微一层雾状，
 *  上面显示着目前识别出来的字」）。比条更宽、更淡，雾与字两端渐隐（mask / 动画都在 CSS）。
 *  key=text：识别结果一变就重新淡入一次（140ms，只动透明度不动位置——不抖）。 */
function VoiceSubtitle({ text, out }: { text: string; out: boolean }): ReactNode {
  return (
    <div className={"dock-voice-sub" + (out ? " is-out" : "")} role="status" aria-live="polite">
      <span className="dock-voice-sub-text" key={text}>{text}</span>
    </div>
  );
}

/** 消息里的一张图（附件图片直接显示、点开放大）。src 一律是**耐久地址**：
 *  选中时读成 data URL（控件随后会 revoke previewUrl 那个 blob），或从会话里的本地路径读盘得来。 */
interface ViewImage {
  name: string;
  src: string;
}

/** 从 OH 会话文本里解析附件块（lib/attach.ts 的 buildOhMessage 产物）→ 带本地路径的**图片**附件。
 *  块形如：
 *    【附件 1/1】photo.jpg
 *    类型 image/jpeg · 大小 1.2 MB · 本地路径 /Users/x/photo.jpg
 *  有了它，**重开面板/重启之后**会话里的图片附件也能重新渲染成缩略图，而不是只剩一行文字。 */
function parseAttachImages(text: string): Array<{ name: string; mime: string; path: string }> {
  const out: Array<{ name: string; mime: string; path: string }> = [];
  const re = /【附件 \d+\/\d+】([^\n]+)\n类型 ([^·\n]+?) · 大小 [^·\n]*? · 本地路径 ([^\n]+)/g;
  for (const m of text.matchAll(re)) {
    const name = (m[1] ?? "").trim();
    const mime = (m[2] ?? "").trim();
    const path = (m[3] ?? "").trim();
    if (name && mime.startsWith("image/") && path) out.push({ name, mime, path });
  }
  return out;
}

/** 本地图片路径 → data URL（同一路径只读一次盘；读不到返回 null，界面退化为文件名占位） */
const imgCache = new Map<string, string>();
async function dataUrlForPath(path: string): Promise<string | null> {
  const clean = path.replace(/^file:\/\//, "");
  const hit = imgCache.get(clean);
  if (hit) return hit;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const b64 = await invoke<string>("read_file_base64", { path: clean, maxBytes: 12 * 1024 * 1024 });
    const url = `data:${mimeFromName(clean)};base64,${b64}`;
    imgCache.set(clean, url);
    return url;
  } catch {
    return null; // 文件没了 / 太大 / 不在本机：不编，界面自己退化
  }
}

/** 刚选中的图片附件 → data URL（**不能依赖 previewUrl**：关面板时控件会 revoke 那个 blob） */
async function dataUrlForPick(f: AttachFile): Promise<string | null> {
  const key = f.path || `${f.name}:${f.size}`;
  const hit = imgCache.get(key);
  if (hit) return hit;
  try {
    const url = bytesToDataUrl(await fileToBytes(f, 12 * 1024 * 1024), f.mime);
    imgCache.set(key, url);
    return url;
  } catch {
    return f.previewUrl ?? null; // 读不到就先用 blob 顶着（至少当场能看）
  }
}

/** markdown 里的图片：data: / blob: / http(s) 直接渲染；本机路径先读成 data URL。
 *  正文图片的 src 常常是应用侧写下的本地路径，webview 直接加载会裂图。 */
function MdImage({ src, alt, ...rest }: ComponentProps<"img">): ReactNode {
  const direct = typeof src === "string" && /^(data:|blob:|https?:)/i.test(src);
  const [url, setUrl] = useState<string | null>(direct ? (src as string) : null);
  useEffect(() => {
    if (direct) {
      setUrl(typeof src === "string" ? src : null);
      return;
    }
    if (typeof src !== "string" || !src) {
      setUrl(null);
      return;
    }
    let alive = true;
    void dataUrlForPath(src).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [src, direct]);
  if (!url) return <span className="dock-img-miss" style={MAT_IMG_MISS}>{alt || "图片（没能读出来）"}</span>;
  return (
    <img
      {...rest}
      className="dock-md-img"
      src={url}
      alt={alt ?? ""}
      onClick={() => {
        openImageViewer(url, alt ?? "");
      }}
    />
  );
}

interface ViewMsg {
  role: "user" | "assistant";
  text: string;
  /** 「额度被限流」动作卡：不再把 429 原文塞进气泡，改成可操作提示（续签 / 自己的 API） */
  notice?: "madmodel-429";
  /** 图片附件（选中的那一拍读成 data URL；会话文本里的本地路径在重水合后补上） */
  images?: ViewImage[];
  /** 链元数据（R7）：本条回答的思考链与工具调用链，折叠可展开回看 */
  meta?: { think?: string; trace?: string[] };
}

/** 水合结果与本地视图的合并 —— 修 2026-10-10「语音发出的消息在面板里被吞」的竞态。
 *
 *  `export_session` 的快照可能比本地视图**旧**：本地刚 push 的用户消息、或刚落定还没落库的回答，
 *  都可能不在快照里。所以这里**绝不能整体替换**（旧实现是 `setMsgs(view)`）——那正是「两边消息都被吞」
 *  的成因。规则（纯函数）：
 *   ① export 是本地视图的前缀（本地更新）→ 原样保留本地视图；
 *   ② 否则以 export 为底，把本地多出来（export 里没有的）按原顺序续在后面。 */
function mergeHydrated(view: ViewMsg[], cur: ViewMsg[]): ViewMsg[] {
  // 索引取值可能是 undefined（noUncheckedIndexedAccess）：显式收窄
  const same = (a: ViewMsg | undefined, b: ViewMsg | undefined): boolean =>
    !!a && !!b && a.role === b.role && a.text === b.text;
  if (view.length <= cur.length && view.every((m, i) => same(m, cur[i]))) return cur;
  const tail = cur.filter((m) => !view.some((x) => same(x, m)));
  return tail.length > 0 ? [...view, ...tail] : view;
}

/** 可折叠链块：思考过程 / 工具调用（流式期展开，落定折叠，随时展开回看）。
 *  OneGUI 收编：直接走 OG AccordionItem（og-accordion-head/body 五件套出外观与 a11y），
 *  旧 .dock-think 手写抽屉与 plg-caret 箭头退役。 */
function ChainBlock({ label, lines, defaultOpen = false }: { label: string; lines: string[]; defaultOpen?: boolean }): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  if (lines.length === 0) return null;
  const total = lines.reduce((n, l) => n + l.length, 0);
  return (
    <AccordionItem
      id={label}
      title={label}
      sub={open ? "点击收起" : `${lines.length} 条 · ${total} 字`}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </AccordionItem>
  );
}
interface UsageInfo {
  sessionCostUsd?: number;
  totalCostUsd?: number;
  budgetUsd?: number;
  budgetLeftUsd?: number;
  sessionPrompt?: number;
  sessionCompletion?: number;
  totalPrompt?: number;
  totalCompletion?: number;
  totalCalls?: number;
}
interface SessionRow {
  id: string;
  title: string;
  updatedAt: number;
  messages: number;
  costUsd: number;
}

function readOpen(): boolean {
  const raw = localStorage.getItem(OPEN_KEY);
  return raw == null ? true : raw === "1"; // 首次安装默认弹出
}
function fmtUsd(v?: number): string {
  if (v == null) return "-";
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`;
}

/* ───────── 消息区（memo：拖拽期间 FAB 每帧改位不重排 markdown） ───────── */

interface MsgListProps {
  msgs: ViewMsg[];
  stream: string | null;
  status: string | null;
  think: string;
  thinkOpen: boolean;
  trace: string[];
  confirmCard: string | null;
  busy: boolean;
  /** 本机有无原生 TTS（桌面 false → 不渲染朗读按钮，不留死按钮） */
  ttsOk: boolean;
  /** 「自动朗读」开关：只用来保证按钮文案/状态与设置页一致（真出声与否由 lib/tts 判） */
  autoSpeak: boolean;
  /** 正在朗读的那一条（按文本认；null = 没在念） */
  speakingText: string | null;
  onSpeak: (t: string) => void;
  onRenewMadModel: () => void;
  onOpenOwnApi: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSend: (t: string) => void;
  onPick: (t: string) => void;
  onToggleThink: () => void;
  onMsgsClick: (e: MouseEvent) => void;
}

/** 开场三行（左对齐、逐字下落）：展开成 [行][字+延迟] 一次性算好 */
const HERO_LINES = ["你好！", "我是小OH，", "有什么能帮你的吗？"];
const HERO_CHARS: Array<Array<{ ch: string; delay: number }>> = (() => {
  let n = 0;
  return HERO_LINES.map((line) => [...line].map((ch) => ({ ch, delay: 0.06 + n++ * 0.07 })));
})();

const SUGGESTIONS = ["明天图书馆哪有空座？", "这周考试安排", "卡里还有多少钱", "明天下午有什么日程"];

/** 开场逐字下落的三行大字（旧 dock-hero-drop 平移：两帧 transition + transitionDelay 分档；
 *  模糊帧没有令牌档省略——移动+回弹节奏保留）。 */
function DockHero(): ReactNode {
  const settled = useMountPhase();
  return (
    <div className="dock-hero" style={MAT_HERO} aria-label={i18n("auto.plugins.ChatDock.1")}>
      {HERO_CHARS.map((line, i) => (
        <div className="dock-hero-line" style={MAT_HERO_LINE} key={i}>
          {line.map((c, j) => (
            <span
              className="dock-hero-ch"
              key={j}
              style={{ transitionDelay: `${c.delay}s`, ...(settled ? MAT_HERO_CH : MAT_HERO_CH_FROM) }}
            >{c.ch}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 建议指令条（旧 dock-chips-in：大字落定后浮现；芯片本体直接走 OG Chip——hover/按压状态层由出） */
function DockSuggestedChips({ onPick }: { onPick: (t: string) => void }): ReactNode {
  const settled = useMountPhase();
  return (
    <div className="dock-empty-chips" style={matEmptyChips(settled)}>
      {SUGGESTIONS.map((s) => (
        <Chip key={s} size="sm" onClick={() => onPick(s)}>{s}</Chip>
      ))}
    </div>
  );
}

/** 单条气泡（OneGUI 收编：材质走 --og-*；最新一条走旧 msg-pop 时间轴的相位直译——历史不动画）。 */
function DockBubble({ m, isNew, ttsOk, autoSpeak, speakingText, onSpeak, onRenewMadModel, onOpenOwnApi }: {
  m: ViewMsg;
  isNew: boolean;
  ttsOk: boolean;
  autoSpeak: boolean;
  speakingText: string | null;
  onSpeak: (t: string) => void;
  onRenewMadModel: () => void;
  onOpenOwnApi: () => void;
}): ReactNode {
  const settled = useMountPhase();
  const phone = isPhoneNow();
  const mat = m.role === "user" ? matBubbleUser(phone) : matBubbleOh(phone);
  /* 学校 MadModel 限流（429）：不显示原始报错气泡，给一张能点的动作卡 */
  if (m.role === "assistant" && m.notice === "madmodel-429") {
    return (
      <div className={"dock-msg-assistant dock-notice" + (isNew ? " is-new" : "")} style={mat} role="status">
        <div className="dock-notice-title">{i18n("auto.plugins.ChatDock.2")}</div>
        <div className="dock-notice-sub">{i18n("auto.plugins.ChatDock.3")}</div>
        <div className="dock-notice-actions">
          <Btn variant="solid" tone="brand" onClick={onRenewMadModel}>{i18n("auto.plugins.ChatDock.4")}</Btn>
          <Btn variant="outline" onClick={onOpenOwnApi}>{i18n("auto.plugins.ChatDock.5")}</Btn>
        </div>
      </div>
    );
  }
  if (m.role === "assistant") {
    return (
      <div
        className={"dock-msg-assistant" + (isNew ? " is-new" : "")}
        style={{ ...mat, ...(isNew && !settled ? MSG_FROM : null) }}
      >
        {m.meta?.think ? <ChainBlock label={i18n("auto.plugins.ChatDock.6")} lines={[m.meta.think]} /> : null}
        {m.meta?.trace?.length ? <ChainBlock label={i18n("auto.plugins.ChatDock.7")} lines={m.meta.trace} /> : null}
        {/* 正文容器：内层 .dock-msg（padding/字阶/形态常量）+ .dock-md（排印豁免保留段，GlobalOrb 同用） */}
        <div className="dock-msg dock-md" style={matBubbleOhBody(phone)}>
          <Markdown remarkPlugins={[remarkGfm]} components={{ img: MdImage }}>{m.text}</Markdown>
        </div>
        {/* 需求 4：朗读这一条（手动＝明确意图，无视静音开关；再点一次＝停）。OneGUI 收编 → IconBtn，
            出声态 is-on 由 global.css 保留段接线（Icons.tsx 的 IconSpeak 两道声波呼吸，仓共享件） */}
        {ttsOk ? (
          <div className="dock-msg-ops" style={MAT_MSG_OPS}>
            <IconBtn
              round
              label={speakingText === m.text ? "停止朗读" : "朗读这一条"}
              titleAttr={speakingText === m.text
                ? "停止朗读"
                : autoSpeak ? "朗读这一条（已开自动朗读）" : "朗读这一条（当前静音，点它就念）"}
              variant="ghost"
              size="sm"
              tone={speakingText === m.text ? "brand" : "default"}
              icon={<IconSpeak width={15} height={15} />}
              className={speakingText === m.text ? "is-on" : undefined}
              aria-pressed={speakingText === m.text}
              onClick={() => onSpeak(m.text)}
            />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className={"dock-msg dock-msg-user" + (isNew ? " is-new" : "")}
      style={{ ...mat, ...(isNew && !settled ? MSG_FROM : null) }}
    >
      {m.images && m.images.length > 0 ? (
        <div className="dock-imgs" style={MAT_IMGS}>
          {m.images.map((im, j) => (
            <button
              key={j}
              className="dock-img og-interactive"
              style={MAT_IMG_TILE}
              title={`${im.name}（点开看大图）`}
              aria-label={`查看图片 ${im.name}`}
              onClick={() => {
                openImageViewer(im.src, im.name);
              }}
            >
              <img src={im.src} alt={im.name} style={MAT_IMG_TILE_IMG} />
            </button>
          ))}
        </div>
      ) : null}
      {m.text}
    </div>
  );
}

const DockMsgList = memo(function DockMsgList(p: MsgListProps): ReactNode {
  const phone = isPhoneNow();
  return (
    <div className="dock-msgs" ref={p.scrollRef} onClick={p.onMsgsClick} style={matMsgs(phone)}>
      {p.msgs.length === 0 && p.stream == null ? (
        <div className="dock-empty" style={matEmpty}>
          {/* 新会话开场：左对齐、逐字下落的三行大字（每次新建对话重挂载即重演） */}
          <DockHero />
          <DockSuggestedChips onPick={p.onPick} />
        </div>
      ) : null}
      {p.msgs.map((m, i) => {
        /* 气泡弹入只给最新一条（历史不动画）：最后一条挂 .is-new，相位过渡对齐旧 --ease-spring pop */
        const isNew = i === p.msgs.length - 1;
        return (
          <DockBubble
            key={i}
            m={m}
            isNew={isNew}
            ttsOk={p.ttsOk}
            autoSpeak={p.autoSpeak}
            speakingText={p.speakingText}
            onSpeak={p.onSpeak}
            onRenewMadModel={p.onRenewMadModel}
            onOpenOwnApi={p.onOpenOwnApi}
          />
        );
      })}
      {p.trace.length > 0 ? <ChainBlock label={i18n("auto.plugins.ChatDock.7")} lines={p.trace} defaultOpen /> : null}
      {p.think ? (
        /* 流式思考链（旧 .dock-think 手写抽屉收编 → OG AccordionItem） */
        <AccordionItem
          id="think"
          title={i18n("auto.plugins.ChatDock.6")}
          sub={p.thinkOpen ? "点击收起" : `${p.think.length} 字 · 已折叠`}
          open={p.thinkOpen}
          onToggle={p.onToggleThink}
        >
          <div style={MAT_PRE}>{p.think}</div>
        </AccordionItem>
      ) : null}
      {p.stream != null ? (
        <div className="dock-msg dock-msg-assistant dock-streaming" style={{ ...matBubbleOh(phone), ...matBubbleOhBody(phone), maxWidth: "84%" }}>
          {p.stream ? (
            <>
              <div className="dock-md">
                <Markdown remarkPlugins={[remarkGfm]} components={{ img: MdImage }}>{p.stream}</Markdown>
              </div>
              {/* 流式光标（旧 dock-caret 眨眼条）收编 → OG Spinner（加载语义，OG 动效档驱动） */}
              <span style={MAT_INLINE_ROW}><Spinner size="sm" /></span>
            </>
          ) : (
            <span style={MAT_INLINE_ROW}>
              <Spinner size="sm" />
              <Text tone="quiet">{p.status ?? "思考中…"}</Text>
            </span>
          )}
        </div>
      ) : null}
      {p.confirmCard ? (
        /* 确认卡（旧 .dock-confirm 三件）→ OG Banner（tone=warning；动作区同款 Btn） */
        <Banner
          tone="warning"
          action={
            <span style={MAT_MSG_OPS}>
              <Btn variant="solid" tone="brand" size="sm" disabled={p.busy} onClick={() => p.onSend("确认")}>{i18n("auto.plugins.ChatDock.8")}</Btn>
              <Btn variant="outline" size="sm" disabled={p.busy} onClick={() => p.onSend("取消")}>{i18n("auto.plugins.ChatDock.9")}</Btn>
            </span>
          }
        >
          <span style={MAT_PRE}>{p.confirmCard}</span>
        </Banner>
      ) : null}
    </div>
  );
});

/** dev-explorer：面板搜索模式的内容面（ChatDock 与悬浮球各自渲染外壳，这里只服务 dock）。
 *  空查询 = 最近 10 条搜索跳转记录（explorerPrefs）；有查询 = searchAll 三源命中；
 *  零命中 = 「问小 (OH)」行（onAskOh → 同帧切 OH 模式并把问题发出去）。 */
function OhSearchPane({ query, onClose, onAskOh, onNotice }: {
  query: string;
  onClose: () => void;
  onAskOh: (q: string) => void;
  onNotice: (n: string | null) => void;
}): ReactNode {
  const { result, total } = useOhSearch(query);
  const history = useSearchHistory();
  const compact = useIsSimpleLike();
  const hist = compact ? history.filter(h => compactPageAllowed(h.page) && h.page !== "settings") : history;
  const q = query.trim();

  const jumpTab = (page: Parameters<typeof jumpTabPayload>[0], params: Parameters<typeof jumpTabPayload>[1], title: string): void => {
    jumpTabPayload(page, params, title, q);
    onClose();
  };

  /* dev-explorer 二轮：搜索框已上移进胶囊（ohx-input 是唯一输入口），这里只渲染结果与记录 */
  return (
    <div className="ohx-searchpane">
      {!q ? (
        <div className="ohx-history">
          <div className="ohx-history-head">{i18n("auto.plugins.ChatDock.10")}</div>
          <div className="ohx-history-chips">
            {hist.length === 0 ? (
              <span className="ohx-history-empty">{i18n("auto.plugins.ChatDock.11")}</span>
            ) : hist.map((h: SearchJump, i: number) => (
              <button
                key={`${h.at}-${i}`}
                className="ohx-chip"
                title={`${h.title}（${h.query}）`}
                onClick={() => jumpTab(h.page, h.params, h.title)}
              >
                {h.title || h.query}
              </button>
            ))}
          </div>
        </div>
      ) : !result ? (
        <div className="ohx-search-status">{i18n("auto.plugins.ChatDock.12")}</div>
      ) : total === 0 ? (
        <>
          <div className="ohx-search-status">{i18n("auto.plugins.ChatDock.13")}{q}{i18n("auto.plugins.ChatDock.14")}</div>
          <button className="ohx-askoh" onClick={() => onAskOh(q)}>
            {i18n("auto.plugins.ChatDock.15")}{q.length > 18 ? q.slice(0, 18) + "…" : q}」
          </button>
        </>
      ) : (
        <div className="ohx-results">
          {result.rows.map((x) => (
            <button
              key={"row:" + x.row.id}
              className="ohx-hit"
              data-vault-catch={vaultCatchAttr({ type: "payload", title: x.row.title, sub: i18n("auto.plugins.ChatDock.p1"), payload: { routeId: x.row.id }, source: "OH 搜索" })}
              onClick={() => {
                jumpSearchRow(x.row, q);
                onClose(); // 设置浮层接棒，小窗收掉
              }}
            >
              <span className="ohx-hit-name">{x.row.title}</span>
              <span className="ohx-hit-sub">{displayBreadcrumb(x.row).join(" → ")}</span>
              <span className="ohx-hit-tag">{i18n("auto.plugins.ChatDock.16")}</span>
            </button>
          ))}
          {result.entries.map((en) => (
            <button key={"n:" + en.id} className="ohx-hit" data-vault-catch={vaultCatchAttr({ type: "atom", title: en.name, sub: en.note ?? en.category, atom: { kind: "page", key: en.id }, source: "OH 搜索" })} onClick={() => { jumpEntry(en.id, en.page, en.params ?? null, en.name, q); onClose(); }}>
              <span className="ohx-hit-name">{en.name}</span>
              <span className="ohx-hit-sub">{en.note ?? en.category}</span>
              <span className="ohx-hit-tag">{i18n("auto.plugins.ChatDock.17")}</span>
            </button>
          ))}
          {result.atoms.map((a) => (
            <button key={"a:" + a.kind + "|" + a.key} className="ohx-hit" data-vault-catch={vaultCatchAttr({ type: "atom", title: a.title, sub: a.sub, atom: { kind: a.kind, key: a.key }, source: "OH 搜索" })} onClick={() => { jumpAtom(a.kind, a.key, a.title, q); onClose(); }}>
              <span className="ohx-hit-name">{a.title}</span>
              <span className="ohx-hit-sub">{(a.group ? a.group + " · " : "") + (a.sub ?? "相关内容")}</span>
              <span className="ohx-hit-tag">{i18n("auto.plugins.ChatDock.18")}</span>
            </button>
          ))}
          {result.tabs.map((t) => (
            <button key={"t:" + t} className="ohx-hit" onClick={() => { jumpSettingsTab(t); onClose(); }}>
              <span className="ohx-hit-name">{i18n("auto.plugins.ChatDock.19")}{t}</span>
              <span className="ohx-hit-sub">{i18n("auto.plugins.ChatDock.20")}</span>
              <span className="ohx-hit-tag">{i18n("auto.plugins.ChatDock.16")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatDock(): ReactNode {
  const simple = useIsSimpleLike(); /* 极简与实用都保留 OH 胶囊 */
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const dockCmd = cmds.find((c) => c.dock && c.id === "chat");
  const pid = dockCmd?.pluginId ?? null;
  /* 创造模式开关（真源 userext；按钮在 dock-head 工具条右上，手机同位可见） */
  const creative = useSyncExternalStore(subscribeUserExt, creativeSnapshot, creativeSnapshot);

  const [open, setOpen] = useState(readOpen);
  const [closing, setClosing] = useState(false); // 关闭动画期：面板仍挂载
  /* 灵动岛：语音会话状态机 off→arming（等授权窗）→listening（轮询转写）→sending（等最终结果） */
  const [voice, setVoice] = useState<"off" | "arming" | "listening" | "sending">("off");
  // 语音会话的真实时序源（state 是渲染快照，存在竞态）：idle=未进行；starting=enterVoice
  // 启动中（含 await speechAvailable/speechStart 的窗口）；active=已开始监听
  const voicePhaseRef = useRef<"idle" | "starting" | "active">("idle");
  const [voiceText, setVoiceText] = useState("");
  const [voiceFail, setVoiceFail] = useState<string | null>(null); // 失败原因：在本次长按的宿主上亮 2.6s 再散
  const [voiceHost, setVoiceHost] = useState<"island" | "entry">("island"); // 失败文案落在哪（岛 / 面板入口条）
  const [pressing, setPressing] = useState(false); // 按住未到长按阈值：给一点「准备」反馈
  /* dev-explorer 二轮：文本输入唯一入口 = 底栏胶囊（OhCapsule 的 ohx-input）。
     面板内不再有第二个文本框；草稿走 dockInput 通道（胶囊 ⇄ 发送按钮同源）。 */
  const draft = useSyncExternalStore(subscribeDockInput, dockInputSnapshot, dockInputSnapshot);
  /* 需求 4（TTS）：朗读状态。autoSpeak 默认 false＝静音，所有自动朗读路径都靠 lib/tts 现读偏好兜底；
     组件这份 prefs 只负责界面一致（按钮文案/状态与设置页同一份快照）。 */
  const prefs = useVoicePrefs();
  const [ttsOk, setTtsOk] = useState(false); // 本机有无原生 TTS（桌面 false）
  const [speakingText, setSpeakingText] = useState<string | null>(null); // 正在念的那条（按文本认）
  /* 朗读代次：每次"开始念"+1。Tauri 的事件通道与 invoke 回执没有顺序保证——自己发起的
     ttsStop() 回来的那个 done 属于上一代，不能拿它把新一轮刚点亮的图标灭掉。 */
  const speakGen = useRef(0);
  const [subLinger, setSubLinger] = useState(false); // 语音结束后字幕多留一拍（渐出）
  /* 附件动作面板（需求 7）：拿到附件后待处理的那批（生命周期归本组件，关面板时回收预览地址） */
  const [sheetFiles, setSheetFiles] = useState<AttachFile[] | null>(null);
  const sheetRef = useRef<AttachFile[] | null>(null); // 同一批附件的即时镜像（关面板回收预览用）
  const [slidIn, setSlidIn] = useState(false); // 语音开面板用滑动进场（区别于点击 morph）
  const pressTimer = useRef<number | null>(null); // 长按计时（null=未按/已触发语音）
  /* 上划取消：按下点 + 连续进度 + 是否越过阈值——**判定一律读 ref**，
     渲染快照（state）会滞后一帧，松手瞬间按快照判会误发/误取消。 */
  const holdStartY = useRef<number | null>(null);
  const cancelPctRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const [cancelling, setCancelling] = useState(false); // 只驱动文案与类名（颜色连续量走 --dock-cancel）
  const [msgs, setMsgs] = useState<ViewMsg[]>([]);
  /* 本地视图镜像：水合失败/读不到会话时据此保护非空本地对话（用户实录「主对话被吃」：
     外点关闭→重开→export_session 失败路径会把 msgs 清成 []，UI 退回欢迎页=对话被吃） */
  const msgsRef = useRef<ViewMsg[]>([]);
  msgsRef.current = msgs;
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmCard, setConfirmCard] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageInfo>({});
  const [history, setHistory] = useState<SessionRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  /* 思维链（R4 think 事件聚合）：流式期间展开，首个回答 delta 到达自动折叠，可手动展开回看 */
  const [think, setThink] = useState("");
  const [thinkOpen, setThinkOpen] = useState(true);
  const hydratedFor = useRef<string | null>(null);
  /* 「这个 pid 至少成功水合过一次」——关面板会清 hydratedFor（允许下次重开重水合），
     但 ohAsk 直达路径要据此判断本地视图可不可信（见 ohReq effect）。 */
  const everHydratedFor = useRef<string | null>(null);
  const seenEv = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** ③ 底栏容器（长按判定挂这里，不再挂在入口按钮上） */
  const rowRef = useRef<HTMLDivElement>(null);
  /** A 面板高度（null = 用 CSS 默认 62vh）；拖把手改它，松手写进 localStorage */
  const [panelH, setPanelH] = useState<number | null>(() => readDockHeight());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ y0: number; h0: number } | null>(null);
  /* OneGUI 收编的过场相位：面板回落底板（grow 不可量时）与历史浮层的挂载——
     grow 路径的 ohx-grow/ohx-shrink 契约动画照旧，相位只补回落路径的入场/离场拍 */
  const panelSettled = useMountPhase(open && !closing);
  const histSettled = useMountPhase(history != null);

  /** ② 滚到底（面板打开 / 水合后 / 流式增量 / 发送后 / 图片撑高都要跟进）。
   *  双帧写两次：内容高度常在下一帧才定（图片、代码块异步撑高）。 */
  const stickBottom = useCallback((): void => {
    const sc = scrollRef.current;
    if (!sc) return;
    sc.scrollTop = sc.scrollHeight;
    window.requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /* ② 兜底：内容异步变高（图片 onLoad、markdown 回流、流式增量）时继续贴底。
     用户手动往上翻过就暂停自动贴底（否则读历史会被拽回底部），回到底部附近自动恢复。 */
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !open) return;
    let stick = true;
    const near = (): boolean => sc.scrollHeight - sc.scrollTop - sc.clientHeight < 48;
    const onScroll = (): void => {
      stick = near();
    };
    const pull = (): void => {
      if (stick) sc.scrollTop = sc.scrollHeight;
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    const mo = new MutationObserver(() => pull());
    mo.observe(sc, { childList: true, subtree: true, characterData: true });
    /** 图片是异步撑高的：MutationObserver 看不到它的尺寸变化，得单独挂 load */
    const watchImgs = (): void => {
      sc.querySelectorAll("img").forEach((im) => {
        if (im.dataset.dockScroll === "1") return;
        im.dataset.dockScroll = "1";
        im.addEventListener("load", pull, { once: true });
      });
    };
    watchImgs();
    const mo2 = new MutationObserver(() => watchImgs());
    mo2.observe(sc, { childList: true, subtree: true });
    const ro = new ResizeObserver(() => pull()); // 面板/键盘/横竖屏引起的尺寸变化也要贴底
    ro.observe(sc);
    return () => {
      sc.removeEventListener("scroll", onScroll);
      mo.disconnect();
      mo2.disconnect();
      ro.disconnect();
    };
  }, [open]);
  /* 运行代次：打断/强停/换插件后作废迟到回包；busyRef 是 busy 的即时镜像（异步闭包防陈旧） */
  const runSeq = useRef(0);
  const busyRef = useRef(false);
  const deadman = useRef<number | null>(null);
  /* 链镜像：finalize 时随回答落库为 meta；delta 节流缓冲（markdown 逐帧重解析会卡 UI） */
  const thinkRef = useRef("");
  const traceRef = useRef<string[]>([]);
  const deltaBuf = useRef("");
  const deltaTimer = useRef<number | null>(null);
  /* 自愈看门狗：流式文本镜像 + 最后事件时刻 + 本代次是否已落定（防回复链路丢失后永久 busy） */
  const streamRef = useRef("");
  const lastEvAt = useRef(Date.now());
  const finalizedFor = useRef(0);
  const closeTimer = useRef<number | null>(null);
  /* 导入会话：真按钮 + 隐藏 input（label 方案在触屏密度层下渲染高度与 button 不一致） */
  const fileRef = useRef<HTMLInputElement>(null);
  /* 外部运行标记：IM 入口的对话事件不进本地视图（见事件泵 foreignRun 分支） */
  const foreignRun = useRef(false);

  const flushDelta = (): void => {
    deltaTimer.current = null;
    const t = deltaBuf.current;
    if (!t) return;
    deltaBuf.current = "";
    streamRef.current += t;
    setStream((v) => (v ?? "") + t);
  };

  const toggle = useCallback((): void => {
    if (open) {
      localStorage.setItem(OPEN_KEY, "0");
      setClosing(true); // 先演退场动画，再卸载（缩回胶囊）
      // 关面板即允许下次重开重水合：期间 IM/云盘可能写入了新轮次（2026-10-10）
      hydratedFor.current = null;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setClosing(false);
        setOpen(false);
      }, 200); // ≥退场动画 190ms
    } else {
      localStorage.setItem(OPEN_KEY, "1");
      setClosing(false);
      setOpen(true);
      setUnread(0);
      stickBottom(); // ② 打开就停在最新一条（图片/水合随后撑高由 ResizeObserver+img.onLoad 兜底）
    }
  }, [open]);

  /* ══ dev-explorer：搜索二合一 ══
     mode = 面板当前形态（search=搜索 / oh=对话）；searchQuery 只在 search 态有意义。
     开/收辅助与 toggle 同一套持久化与时序（水合标记、退场定时器），供命令总线复用。 */
  const [mode, setMode] = useState<OhMode>("oh");
  useEffect(() => { if(simple && mode === "xiaoda") setMode("oh"); }, [simple, mode]);
  const modeRef = useRef<OhMode>("search");
  modeRef.current = mode;

  const [searchQuery, setSearchQuery] = useState("");
  const openPanelAs = useCallback((m: OhMode, presetQuery?: string): void => {
    localStorage.setItem(OPEN_KEY, "1");
    setClosing(false);
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    /* 与 ohAsk 直达同款竞态修复：关着的面板被打开时先补水合标记（见 ohReq effect 注释） */
    if (pid && everHydratedFor.current === pid) hydratedFor.current = pid;
    setOpen(true);
    setUnread(0);
    setMode(m);
    if (m === "search") {
      setSearchQuery(presetQuery ?? "");
      setDockInputValue(presetQuery ?? ""); // 胶囊输入框是唯一编辑入口：预填词进胶囊
    } else {
      stickBottom();
    }
  }, [pid, stickBottom]);
  const closePanelNow = useCallback((): void => {
    localStorage.setItem(OPEN_KEY, "0");
    setClosing(true);
    hydratedFor.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      setOpen(false);
    }, 200);
  }, []);

  /** 只清本会话计数，累计用量（跨会话持久）保留并刷新 */
  const keepTotals = (): void => {
    setUsage((u) => ({
      budgetUsd: u.budgetUsd, budgetLeftUsd: u.budgetLeftUsd,
      totalCostUsd: u.totalCostUsd, totalPrompt: u.totalPrompt,
      totalCompletion: u.totalCompletion, totalCalls: u.totalCalls,
    }));
  };

  // 插件变更：清视图，重挂水合标记；作废旧插件迟到回包与死人开关
  useEffect(() => {
    hydratedFor.current = null;
    setMsgs([]);
    setStream(null);
    setThink("");
    setThinkOpen(true);
    setTrace([]);
    thinkRef.current = "";
    traceRef.current = [];
    if (deltaTimer.current) {
      clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
    }
    deltaBuf.current = "";
    setConfirmCard(null);
    setUsage({});
    seenEv.current = 0;
    setHistory(null);
    runSeq.current++;
    if (deadman.current) {
      clearTimeout(deadman.current);
      deadman.current = null;
    }
    busyRef.current = false;
    setBusy(false);
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [pid]);

  // 水合：打开面板且尚未载入当前会话 → 导出会话 JSON 还原视图（R5）+ 拉累计用量。
  // foreignTick：外部入口（IM 微信/飞书）完成对话后打点——本地无运行在途时静默重水合，
  // 把 IM 轮次并入视图（IM 的 delta 会被 R10 迟到守卫拦掉，回答回执只走 IM 通道，
  // 不重水合主界面就永远看不到 IM 的新轮次；2026-10-10 用户实录）。
  const [foreignTick, setForeignTick] = useState(0);
  useEffect(() => {
    if (!pid || !open || hydratedFor.current === pid) return;
    hydratedFor.current = pid;
    // 重水合先清流式残影：此刻若 busy 必为本地在途（foreignTick 分支只在 !busy 时打点），
    // 若非 busy 则 stream/think 里只可能是外部入口（IM）事件的残留——一并冲掉
    if (!busyRef.current) {
      if (deltaTimer.current) {
        clearTimeout(deltaTimer.current);
        deltaTimer.current = null;
      }
      deltaBuf.current = "";
      streamRef.current = "";
      setStream(null);
      setThink("");
    }
    void (async () => {
      try {
        const res: any = await callRust(pid, "run", { command: "export_session", input: "" });
        if (res?.ok && res.json) {
          const s = JSON.parse(res.json);
          const view: ViewMsg[] = [];
          for (const m of s.messages ?? []) {
            if (m.role === "user" && m.content) view.push({ role: "user", text: m.content });
            else if (m.role === "assistant" && m.content) view.push({ role: "assistant", text: m.content });
          }
          // 合并而非整体替换：export 快照可能比本地视图旧（在途轮次还没落库）——见 mergeHydrated
          setMsgs((cur) => mergeHydrated(view, cur));
          if (s.usage) setUsage((u) => ({ ...u, sessionPrompt: s.usage.prompt, sessionCompletion: s.usage.completion, sessionCostUsd: s.cost_usd }));
        } else if (!busyRef.current && msgsRef.current.length === 0) {
          setMsgs([]); // 读不到会话：本地空才允许清空——非空本地对话是用户可见的真相，宁可显示旧的
        }
      } catch {
        if (!busyRef.current && msgsRef.current.length === 0) setMsgs([]); // 同上：失败不清非空本地
      }
      everHydratedFor.current = pid; // 记「本 pid 已水合过」：ohAsk 直达时据此跳过重水合
      try {
        const t: any = await callRust(pid, "run", { command: "usage_report" });
        if (t?.ok && t.totals) {
          setUsage((u) => ({
            ...u,
            totalPrompt: t.totals.prompt, totalCompletion: t.totals.completion,
            totalCalls: t.totals.calls, totalCostUsd: t.totals.costUsd,
          }));
        }
      } catch { /* 保留现值 */ }
    })();
  }, [pid, open, foreignTick]);

  // 事件泵：流式增量 / 工具轨迹 / 用量（R4）
  const events = useSyncExternalStore(subscribePluginEvents, pid ? () => pluginEvents(pid) : () => EMPTY_EVENTS);
  useEffect(() => {
    if (!pid) return;
    const fresh = events.slice(seenEv.current);
    seenEv.current = events.length;
    if (fresh.length === 0) return;
    lastEvAt.current = Date.now();
    for (const e of fresh) {
      if (e.method === "exit") {
        hardStop("插件已停止");
        return;
      }
      const kind = (e as any).kind;
      // 外部运行（IM 微信/飞书入口的对话）：本地无运行在途时收到的 delta/think/tool/log
      // 一律不进本地视图——否则 IM 回复会流进本地流式气泡（永不 finalize → 幽灵光标
      // 常闪、多轮拼成一长串，2026-10-10 用户实录）。轮次由 usage 事件后的重水合并入。
      if (!busyRef.current && (kind === "delta" || kind === "think" || kind === "tool" || kind === "log" || kind === "notice")) {
        foreignRun.current = true;
        continue;
      }
      // R10：已落定的对话不得再吃迟到事件——Tauri 事件通道与 invoke 回执无顺序保证，
      // 迟到 delta 会复活流式气泡（幽灵光标一直闪）
      if (finalizedFor.current === runSeq.current && runSeq.current > 0 && (kind === "delta" || kind === "think" || kind === "tool")) {
        continue;
      }
      if (kind === "delta" && e.text) {
        setThinkOpen(false); // 回答开始 → 思考过程自动折叠
        deltaBuf.current += e.text;
        if (!deltaTimer.current) deltaTimer.current = window.setTimeout(flushDelta, 120);
      } else if (kind === "think" && e.text) {
        thinkRef.current += e.text;
        setThink((t) => t + e.text);
      } else if (kind === "tool" && e.text) {
        traceRef.current = [...traceRef.current.slice(-60), e.text!];
        setTrace((t) => [...t.slice(-40), e.text!]);
      }
      else if (kind === "log" && e.text) {
        // R7 结构化日志（LLM 请求/响应行）同样进「工具调用」链——模型源可证：
        // 「→ LLM 请求 <model> · … · <端点 URL>」直接显示这一轮打到哪个服务
        traceRef.current = [...traceRef.current.slice(-60), e.text!];
        setTrace((t) => [...t.slice(-40), e.text!]);
      }
      else if (kind === "notice" && e.text) setStatus(e.text);
      else if (kind === "usage" && (e as any).payload) {
        setUsage((u) => ({ ...u, ...(e as any).payload }));
        // 外部入口（IM）对话完成：清掉其残留（不进气泡的保证 + 兜底清 stream/think），
        // 静默重水合把新轮次（含 IM 侧的用户消息）并入视图
        if (foreignRun.current || !busyRef.current) {
          foreignRun.current = false;
          if (!busyRef.current) {
            if (deltaTimer.current) {
              clearTimeout(deltaTimer.current);
              deltaTimer.current = null;
            }
            deltaBuf.current = "";
            streamRef.current = "";
            setStream(null);
            thinkRef.current = "";
            setThink("");
            hydratedFor.current = null;
            setForeignTick((t) => t + 1);
          }
        }
      }
    }
    stickBottom();
  }, [events, pid]);

  const finalize = (r: any): void => {
    if (finalizedFor.current === runSeq.current && runSeq.current > 0) return; // 已落定（看门狗兜底后真回复迟到）
    finalizedFor.current = runSeq.current;
    // 冲掉在途 delta 缓冲：否则落定后迟到的定时器会把残余增量拼回 stream，冒出幽灵流式气泡
    if (deltaTimer.current) {
      clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
    }
    deltaBuf.current = "";
    /* 文案规范：不用 emoji/符号当图标（用户 2026-10-11 质量红线）→ 纯文字前缀 */
    const answer = typeof r?.answer === "string" ? r.answer : r?.error != null ? `回答出错：${r.error}` : "(空响应)";
    /* 学校 MadModel 限流/额度类报错：不把原始报错塞进气泡，改成「续签 / 换自己的 API」动作卡。 */
    const rawError = r?.error == null ? "" : String(r.error);
    const limited = /429|请求过多|rate.?limit|too many requests|额度|重新签/i.test(rawError);
    setMsgs((v) => [...v, limited
      ? { role: "assistant", text: "", notice: "madmodel-429" as const }
      : { role: "assistant", text: answer, meta: { think: thinkRef.current, trace: traceRef.current } }]);
    /* 需求 4 自动朗读的**触发点**：就在「回复完成」这一步（紧随回答入列）。
       只念真回答（报错/空响应不念）；静音保证＝speakReply 内部**现读** voicePrefs.autoSpeak
       （默认 false）后直接 return false，连 TTS 引擎都不问。这里刻意不读组件的 prefs 快照：
       finalize 会被 send() 的旧闭包调用，读渲染快照会陈旧（漏判用户刚在设置页打开的开关）。 */
    if (r?.error == null && answer.trim()) {
      void speakReply(answer).then((ok) => {
        if (ok) {
          speakGen.current += 1; // 真出声了才点亮图标（静音/不支持时不假装在念）
          setSpeakingText(answer);
        }
      });
    }
    setStream(null);
    setThinkOpen(false); // 回答落定 → 链折叠（随 meta 挂在本条回答上，可展开回看）
    setTrace([]);
    setStatus(null);
    setConfirmCard(r?.confirm?.summary ?? null);
    if (r?.totalUsage || r?.sessionUsage) {
      setUsage((u) => ({ ...u, ...(r.sessionUsage ?? {}), ...(r.totalUsage ?? {}) }));
    }
    if (!open) setUnread((n) => n + 1);
    stickBottom();
  };

  /** 429 动作卡：一键续签 MadModel 免费额度 */
  const renewMadModel = useCallback((): void => {
    void (async () => {
      try {
        await ensureMadModelToken(true);
        showToast(i18n("auto.plugins.ChatDock.msg1"));
      } catch (e) {
        showToast(`续签失败：${e instanceof Error ? e.message : String(e)}（可改用你自己的 API）`);
      }
    })();
  }, []);
  /** 429 动作卡：直接去 OH 高级配置里调模型源/Key */
  const openOwnApi = useCallback((): void => {
    openSettings("oh");
    goOhRow("模型 / MCP / 日志", "advanced");
  }, []);

  /** 强制收尾：清 busy + 作废迟到回包（打断超时/插件死亡/换插件时的 UI 兜底） */
  const hardStop = (note: string): void => {
    if (deadman.current) {
      clearTimeout(deadman.current);
      deadman.current = null;
    }
    if (!busyRef.current) return;
    runSeq.current++;
    busyRef.current = false;
    setBusy(false);
    setMsgs((v) => [...v, { role: "assistant", text: `■ ${note}` }]);
    setStream(null);
    setTrace([]);
    setStatus(null);
    setConfirmCard(null);
  };

  const send = useCallback(async (raw: string, bubble?: string): Promise<void> => {
    const text = raw.trim();
    if (!pid || busyRef.current || !text) return;
    void ttsStop(); // 朗读中用户发新消息：先掐掉，别和新回答抢耳朵
    setSpeakingText(null);
    const seq = ++runSeq.current;
    finalizedFor.current = 0;
    foreignRun.current = false; // 本地运行启动：此后的事件都属本地（IM 单飞队列不会并发进来）
    streamRef.current = "";
    lastEvAt.current = Date.now();
    busyRef.current = true;
    setBusy(true);
    setMsgs((v) => [...v, { role: "user", text: bubble?.trim() || text }]);
    stickBottom(); // ② 发送后立刻贴底
    setStream("");
    setThink("");
    setThinkOpen(true);
    setTrace([]);
    thinkRef.current = "";
    traceRef.current = [];
    setConfirmCard(null);
    setStatus("思考中…");
    // 自愈看门狗（R9）：流式文本已非空且 8s 无任何新事件 → 视为已完成，
    // 用已流出的内容落定并解锁——无论 run 应答卡在链路哪一环，UI 都不再永久 busy
    const watchdog = window.setInterval(() => {
      if (seq !== runSeq.current || !busyRef.current) {
        window.clearInterval(watchdog);
        return;
      }
      const idle = Date.now() - lastEvAt.current;
      if (streamRef.current && idle > 8_000) {
        window.clearInterval(watchdog);
        console.warn("[dock] 应答链路超时，看门狗按已流出内容落定");
        if (seq === runSeq.current) finalize({ answer: streamRef.current });
        busyRef.current = false;
        setBusy(false);
      }
    }, 1000);
    try {
      const res: any = await callRust(pid, "run", { command: "chat", input: text });
      window.clearInterval(watchdog);
      if (seq !== runSeq.current) return; // 已被打断/强停：迟到回包作废
      finalize(res);
    } catch (e) {
      window.clearInterval(watchdog);
      if (seq !== runSeq.current) return;
      finalize({ answer: "", error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (seq === runSeq.current) {
        busyRef.current = false;
        setBusy(false);
      }
      if (deadman.current) {
        clearTimeout(deadman.current);
        deadman.current = null;
      }
    }
  }, [pid, open]);

  /* OH 直达：外部请求（搜索页「问 OH」）→ 开面板并直接发送（seq 去重，绝不重复发） */
  const ohReq = useSyncExternalStore(subscribeOhPrompt, ohPromptSnapshot, ohPromptSnapshot);
  const ohDoneSeq = useRef(ohPrompt?.seq ?? 0);
  useEffect(() => {
    if (!ohReq || ohReq.seq === ohDoneSeq.current) return;
    ohDoneSeq.current = ohReq.seq;
    localStorage.setItem(OPEN_KEY, "1");
    setClosing(false);
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    /* 修竞态（用户实录「我的消息和他的消息都被吞掉了」）：这条路径 = **关着的面板被打开 + 立刻发送**，
       而关面板时 hydratedFor 已被清空 → 水合 effect 会紧接着拉 export_session，且很可能在新一轮
       落库**之前**取到快照 → 旧实现的 setMsgs(view) 会把刚 push 的用户消息（甚至整轮问答）冲掉。
       本地视图只要已水合过就是可信的，于是**在本帧（setOpen 之前）把水合标记补上**，
       水合 effect 的 deps 里 open 会变，必须赶在它之前生效。 */
    if (pid && everHydratedFor.current === pid) hydratedFor.current = pid;
    setOpen(true);
    setUnread(0);
    void send(ohReq.text);
  }, [ohReq, send]);

  /* dev-explorer 二轮：面板从胶囊顶边「长出来」——量可见胶囊的 rect（left/width），
     bottom 由 explorer-ui.css 契约变量给出；resize/转窗/布局落定后重量。 */
  const [capsuleRect, setCapsuleRect] = useState<{ left: number; width: number; bottom: number; topdock: boolean; maxHeight: number; bottomInset: number } | null>(null);
  /* 锚端判定 ref：面板 top 锚（顶置桌面形态、把手在底部）时拖拽方向反向（拖拽回调读） */
  const topdockRef = useRef(false);
  topdockRef.current = !!capsuleRect?.topdock;
  useEffect(() => {
    if (!open && !closing) {
      setCapsuleRect(null);
      return;
    }
    const measure = (): void => {
      const all = Array.from(document.querySelectorAll<HTMLElement>(".ohx-capsule"));
      const el = all.find((n) => n.offsetParent !== null) ?? all[0];
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        /* 手机（A5）：不再与胶囊等宽——满水平轴半屏抽屉，左右各留 6px 缝（「弹一下」的语义照旧）；
           底栏在底（topdock=false），把手仍在顶部，高度可拉满。 */
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
        if (isPhoneNow()) {
          const gap = 6;
          const barTop = el.closest(".ex-bbar")?.getBoundingClientRect().top ?? r.top;
          const bottomEdge = Math.min(barTop - gap, viewportBottom - gap);
          setCapsuleRect({
            left: gap, width: Math.max(window.innerWidth - gap * 2, 0), bottom: r.bottom, topdock: false,
            bottomInset: window.innerHeight - bottomEdge,
            maxHeight: Math.max(0, bottomEdge - viewportTop - gap),
          });
          return;
        }
        /* 顶置判定：胶囊所在 ex-bbar 在视口上半部 = 两行顶置桌面形态（窗朝下生长）；
           手机底栏（bottom 形态）在同页签里 y≈vh-48，判定天然分叉 */
        const bar = el.closest(".ex-bbar");
        const inTopbar = !!bar && bar.getBoundingClientRect().top < window.innerHeight / 2;
        const bottomEdge = Math.min(r.top - 4, viewportBottom - 8);
        setCapsuleRect({
          left: r.left, width: r.width, bottom: r.bottom, topdock: inTopbar,
          bottomInset: window.innerHeight - bottomEdge,
          maxHeight: Math.max(0, inTopbar ? viewportBottom - r.bottom - 12 : bottomEdge - viewportTop - 8),
        });
      }
    };
    measure();
    const t1 = window.setTimeout(measure, 60); // 底栏/顶栏布局动画落定后补量
    const t2 = window.setTimeout(measure, 260);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [open, closing, mode]);

  /* dev-explorer：OH 命令总线订阅（胶囊条/悬浮球/首页搜索框都从这里进来）。
     handler 每渲染刷新进 ref，订阅只在挂载时建立一次——回调永远拿到最新状态。 */
  const cmdHandler = useRef<(cmd: OhCommand) => void>(() => undefined);
  cmdHandler.current = (cmd: OhCommand): void => {
    if (cmd.type === "panel") {
      // 语音进行中：任何面板命令＝取消（胶囊「上划取消」的契约通道）
      if (voicePhaseRef.current !== "idle") {
        void finishVoice(true);
        return;
      }
      // 已开着且就在目标模式（无预填词）＝再点一下收起
      if (open && mode === cmd.mode && !cmd.presetQuery) {
        closePanelNow();
        return;
      }
      openPanelAs(cmd.mode, cmd.presetQuery);
      return;
    }
    // voice：第一条＝开始收音（胶囊按住跨过 450ms 时发），**窗同时弹出**（用户口径：
    // 波纹在胶囊里、对话区在头顶窗里）；收音中再收＝松手直发
    if (voicePhaseRef.current === "idle") {
      setVoiceHost("island");
      setVoiceFail(null);
      document.body.classList.add("dock-voice-lock");
      voicePhaseRef.current = "starting";
      openPanelAs("oh");
      void enterVoice();
      return;
    }
    void finishVoice(cancelArmedRef.current);
  };
  useEffect(() => onOhCommand((c) => cmdHandler.current(c)), []);
  /* 点外部自然关闭：胶囊与小窗之外的任何按-down 都收窗（语音中除外） */
  useEffect(() => {
    if (!open || voice !== "off") return;
    const h = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null;
      /* 排除一切 portal 弹层：它们挂在 body 上不在 .dock-panel 里，点它们同样不该收主窗。
         附件动作面板已收编 OG Sheet：`.ohaa-backdrop` 亡，锚 = 其 scope 标记（面板+遮罩都可命中）。 */
      if (el?.closest(".dock-panel, .ohx-capsule, .dock-voice-toast, .imgview, .ohf-backdrop, .confirm-mask, .tab-manage-mask, .settings-mask, [data-og-scope='ohaa.sheet'], .ex-sheet-mask")) return;
      closePanelNow();
    };
    document.addEventListener("pointerdown", h, true);
    return () => document.removeEventListener("pointerdown", h, true);
  }, [open, voice]);

  /* 未读徽标外送（OhCapsule 的红点） */
  useEffect(() => {
    setDockBadge(unread);
  }, [unread]);
  /* 胶囊 ⇄ 面板共享 UI 外送：开合/形态随渲染态；语音/提示随语音态（voiceHintOf 单一真源） */
  useEffect(() => {
    setDockUi({ open: open || closing, mode });
  }, [open, closing, mode]);
  useEffect(() => {
    setDockUi({ voice, hint: voiceHintOf(voice, cancelling, mode) });
  }, [voice, cancelling]);
  /* 草稿提交（胶囊输入框 Enter / 面板发送按钮 都走 dockSubmitInput → 这里） */
  useEffect(() => {
    dockSubmitFn = (t: string) => {
      /* 用户定案：胶囊是独立输入组件，文字送给谁由上方切换按钮（mode）决定 */
      if (mode === "search") return; /* 检索词经 live 镜像已实时生效，Enter 无事可做 */
      if (mode === "xiaoda") {
        /* 清小搭态：草稿交给清小搭小窗（它自己管对话号与流式上屏） */
        setDockInputValue("");
        xiaodaSubmitFn?.(t);
        return;
      }
      if (!pid) {
        setNotice("小OH 还没就绪（Harness 插件未加载）——对话需要完整桌面环境");
        return;
      }
      setDockInputValue("");
      void send(t);
    };
    return () => {
      dockSubmitFn = null;
    };
  }, [send, mode, pid]);
  /* 搜索态：胶囊输入即检索词（单向镜像 dockInput → searchQuery；不等值才写，防打环） */
  useEffect(() => {
    if (mode === "search" && searchQuery !== draft) setSearchQuery(draft);
  }, [draft, mode, searchQuery]);

  const runCmd = async (command: string, input = ""): Promise<any> => {
    if (!pid) return null;
    try {
      return await callRust(pid, "run", { command, input });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  /** 累计用量刷新（usage_report：跨会话总量，切换/新建后立即可见） */
  const refreshTotals = async (): Promise<void> => {
    if (!pid) return;
    try {
      const r: any = await callRust(pid, "run", { command: "usage_report" });
      if (r?.ok && r.totals) {
        setUsage((u) => ({
          ...u,
          totalPrompt: r.totals.prompt, totalCompletion: r.totals.completion,
          totalCalls: r.totals.calls, totalCostUsd: r.totals.costUsd,
        }));
      }
    } catch { /* 保留现值 */ }
  };

  const newSession = async (): Promise<void> => {
    void ttsStop(); // 会话换掉了：正在念的那条一起停，图标状态同步收
    setSpeakingText(null);
    if (busyRef.current) {
      // 打断中也能开新会话：强制解锁，迟到回包作废
      hardStop("已打断，开新会话");
      await new Promise((r) => setTimeout(r, 60));
    }
    await runCmd("new_session");
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    keepTotals();
    void refreshTotals();
    setNotice("已新建会话");
  };

  const openHistory = async (): Promise<void> => {
    const r = await runCmd("list_sessions");
    setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
  };

  const switchSession = async (id: string): Promise<void> => {
    void ttsStop();
    setSpeakingText(null);
    if (busyRef.current) {
      hardStop("已打断，切换会话");
      await new Promise((r) => setTimeout(r, 60));
    }
    await runCmd("switch_session", id);
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    keepTotals();
    setHistory(null);
    void refreshTotals();
    // 立即水合新会话
    try {
      const res: any = await callRust(pid!, "run", { command: "export_session", input: id });
      if (res?.ok && res.json) {
        const s = JSON.parse(res.json);
        const view: ViewMsg[] = [];
        for (const m of s.messages ?? []) {
          if (m.role === "user" && m.content) view.push({ role: "user", text: m.content });
          else if (m.role === "assistant" && m.content) view.push({ role: "assistant", text: m.content });
        }
        setMsgs(view);
        if (s.usage) setUsage((u) => ({ ...u, sessionPrompt: s.usage.prompt, sessionCompletion: s.usage.completion, sessionCostUsd: s.cost_usd }));
      }
    } catch {
      /* 保持空视图 */
    }
  };

  const deleteSession = async (id: string): Promise<void> => {
    const r = await runCmd("delete_session", id);
    setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
    if (r?.ok) {
      // 修（老 bug，云盘之前就存在）：删除的若是当前显示会话，视图会残留旧对话——
      // 关开面板也不重水合（hydratedFor 已等于 pid 短路了 345 行的 effect）。
      // 删除成功即重置水合标记，让 effect 按 core 返回的新 active 立即重建视图。
      setMsgs([]);
      setStream(null);
      setConfirmCard(null);
      setStatus(null);
      setNotice("已删除");
      hydratedFor.current = null;
    } else {
      setNotice(r?.error ?? "删除失败");
    }
  };

  const exportSession = async (): Promise<void> => {
    const r = await runCmd("export_session", "");
    if (!r?.ok || !r.json) {
      setNotice(r?.error ?? "导出失败");
      return;
    }
    // R10：WKWebView 无下载管理器，a[download] 点击静默无效——宿主代写 ~/Downloads
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("save_text_file", {
        filename: `onethu-harness-${(r.sessionId ?? "session").slice(0, 18)}.json`,
        contents: r.json,
      });
      setNotice(path ? `已导出：${path}` : "已取消导出");
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importSession = async (f: File): Promise<void> => {
    const text = await f.text();
    const r = await runCmd("import_session", text);
    if (r?.ok) {
      hydratedFor.current = pid;
      setMsgs([]);
      setNotice(`已导入：${r.title ?? "会话"}`);
      void switchSession(r.sessionId);
    } else {
      setNotice(r?.error ?? "导入失败");
    }
  };

  const stop = (): void => {
    if (!pid) return;
    void notifyRust(pid, "interrupt").catch(() => undefined);
    setStatus("正在打断…");
    // 死人开关：插件 12s 内没自行收尾就强制解锁——打断永不卡死 UI
    if (!deadman.current && busyRef.current) {
      deadman.current = window.setTimeout(() => {
        deadman.current = null;
        hardStop("已打断（插件未及时响应，已强制解锁）");
      }, 12_000);
    }
  };

  /** 消息区链接一律外跳系统浏览器（webview 内导航会带走整个应用） */
  const onMsgsClick = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    // onethu-news://<xxid> = 站内新闻直达（小OH 新闻链接专用），不开浏览器
    const m = /^onethu-news:\/\/(.+)$/.exec(href);
    if (m?.[1]) {
      navGo("info", { infoNewsId: decodeURIComponent(m[1]) });
      return;
    }
    void openExternal(href);
  };

  /* ───────── 灵动岛：点击展开 / 长按语音 ───────── */

  // 语音轮询：listening 期间每 180ms 拉一次部分转写
  useEffect(() => {
    if (voice !== "listening") return;
    const t = window.setInterval(() => {
      void speechPoll().then(setVoiceText);
    }, 180);
    return () => window.clearInterval(t);
  }, [voice]);

  /* 波纹点动画：音量电平（speech_level → 0..1）驱动。
     - 直接写 DOM 样式（转写文本仍走 180ms 的 state 通道）——60fps 不引发 React 重渲染；
     - 电平每 LEVEL_POLL_MS 拉一次 + 指数平滑：变化滞后一拍 → 观感「柔」，不抖；
     - 取不到电平（桌面端 / 识别器不给 onRmsChanged）时振幅有下限 0.42 —— 退化为**时间正弦**，
       始终在动；NaN/越界一律夹回 0..1，不存在空转或 NaN；
     - 宿主可能是岛、也可能是面板里的入口条，两个都刷（只有可见的那个看得见）。 */
  useEffect(() => {
    if (voice === "off") return;
    const dots = Array.from(document.querySelectorAll<HTMLElement>(".dock-wave-dot"));
    if (dots.length === 0) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alive = true;
    let raf = 0;
    let target = 0; // 最新电平
    let smooth = 0; // 平滑后电平：驱动振幅与透明度
    let poll: number | null = null;

    const pull = (): void => {
      void speechLevel().then((v) => {
        if (alive) target = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      });
    };
    if (voice === "listening") {
      pull();
      poll = window.setInterval(pull, LEVEL_POLL_MS);
    }

    if (reduce) {
      // 系统「减弱动态效果」：静帧点列（只留轻微高低差），连 rAF 都不开
      dots.forEach((el, i) => {
        el.style.transform = `scaleY(${(0.44 + (i % 3) * 0.14).toFixed(2)})`;
        el.style.opacity = "0.55";
      });
    } else {
      const t0 = performance.now();
      const tick = (now: number): void => {
        if (!alive) return;
        const t = (now - t0) / 1000;
        smooth += (target - smooth) * 0.16; // 电平跳变被摊平（ease-in-out 的观感）
        if (!Number.isFinite(smooth)) smooth = 0;
        const amp = 0.42 + 0.58 * smooth; // 无电平时 0.42：正弦照常呼吸
        const dim = 1 - 0.55 * cancelPctRef.current; // 上划取消候选：波纹整体压暗（随位移连续）
        dots.forEach((el, i) => {
          const s = 0.5 + 0.5 * Math.sin(t * 5.2 - i * 0.62);
          const h = Math.min(1.28, Math.max(0.18, 0.26 + s * amp));
          el.style.transform = `scaleY(${h.toFixed(3)})`;
          el.style.opacity = ((0.34 + 0.66 * s * (0.5 + 0.5 * smooth)) * dim).toFixed(3);
        });
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    }
    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
      if (poll != null) window.clearInterval(poll);
    };
  }, [voice]);

  // 卸载：语音还在进行就按取消收尾（停识别器 + 解冻页面 + 清掉全局的取消进度变量）
  useEffect(() => () => {
    if (voicePhaseRef.current !== "idle") {
      voicePhaseRef.current = "idle";
      speechStop();
    }
    document.body.classList.remove("dock-voice-lock");
    document.documentElement.style.setProperty("--dock-cancel", "0");
  }, []);

  /* 图片附件补渲染（需求：图片直接显示、md 那一块也要能出图）：
     会话里的用户消息长这样——「【附件 1/1】a.jpg ⏎ 类型 image/jpeg · 大小 … · 本地路径 /x/a.jpg」。
     重开面板 / 重启后 msgs 是从 export_session 来的**纯文本**，这里按路径把图读回来补成缩略图。
     只在还没有 images 的消息上补；读盘结果按路径缓存（同一张只读一次），因此 setMsgs 后收敛、
     不会反复读盘。 */
  useEffect(() => {
    const need: Array<{ idx: number; name: string; path: string }> = [];
    msgs.forEach((m, idx) => {
      if (m.images && m.images.length > 0) return;
      for (const a of parseAttachImages(m.text)) need.push({ idx, name: a.name, path: a.path });
    });
    if (need.length === 0) return;
    let alive = true;
    void (async () => {
      const byIdx = new Map<number, ViewImage[]>();
      for (const n of need) {
        const src = await dataUrlForPath(n.path);
        if (!alive || !src) continue;
        byIdx.set(n.idx, [...(byIdx.get(n.idx) ?? []), { name: n.name, src }]);
      }
      if (!alive || byIdx.size === 0) return;
      setMsgs((cur) => cur.map((m, i) => {
        const add = byIdx.get(i);
        return add && !(m.images && m.images.length > 0) ? { ...m, images: add } : m;
      }));
    })();
    return () => {
      alive = false;
    };
  }, [msgs]);

  /* 本机 TTS 能力（一次探测）：桌面端插件如实回 false → 不渲染朗读按钮，也不会出现点不动的死状态 */
  useEffect(() => {
    void ttsSupported().then(setTtsOk);
  }, []);

  /* 原生「念完了 / 被停了 / 出错了」→ 收口图标；error 不弹任何东西，最多 console 一行（Lead 口径） */
  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | null = null;
    void onTtsDone((reason) => {
      if (!alive) return;
      /* 只收"自己这一代"的图标：代次已被新一轮顶掉 = 这条 done 是上一代的残留（120ms 后核对） */
      const g = speakGen.current;
      window.setTimeout(() => {
        if (alive && speakGen.current === g) setSpeakingText(null);
      }, 120);
      if (reason.startsWith("error")) console.warn("[dock] 朗读异常结束：", reason);
    }).then((d) => {
      dispose = d;
      if (!alive) d(); // 订阅比卸载晚到：立刻退订，别泄漏
    });
    return () => {
      alive = false;
      dispose?.();
    };
  }, []);

  /* 字幕渐出：语音结束后多留 SUB_LINGER_MS（也覆盖「识别完 → 面板滑入」那一拍），
     否则条一收窄字幕就瞬闪消失。 */
  useEffect(() => {
    if (voice !== "off") {
      setSubLinger(true);
      return;
    }
    const t = window.setTimeout(() => setSubLinger(false), SUB_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [voice]);

  // 兜底：按住期间窗口失焦（Cmd+Tab、切换空间等），pointerup 不会到达按钮，语音会
  // 悬死。失焦时若语音仍在进行则立即收尾。
  useEffect(() => {
    const onBlur = (): void => {
      if (voicePhaseRef.current !== "idle") void finishVoice(true); // 失焦：按取消（不误发）
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  /** 语音失败：在本次长按的那个宿主上亮 2.6s（岛=雾状浮片，面板内=入口条内联；notice 看不见） */
  const showVoiceFail = (msg: string): void => {
    setVoice("off");
    setVoiceText("");
    setVoiceFail(msg);
    window.setTimeout(() => setVoiceFail(null), 2600);
  };

  const enterVoice = async (): Promise<void> => {
    if (voicePhaseRef.current !== "starting") return; // 防重入
    if (!(await speechAvailable())) {
      voicePhaseRef.current = "idle";
      // 桌面端/未提供系统识别服务的机子：明确降级文案，别静默（需求 5）
      showVoiceFail(speechUnavailableHint());
      return;
    }
    setVoice("arming");
    setVoiceText("");
    try {
      await speechStart(); // 首次会同步等待系统授权窗（麦克风+语音识别）
      // 启动期间用户已松手（finishVoice 置 idle）：立即收尾，杜绝「无人监听却停不下来」
      if (voicePhaseRef.current !== "starting") {
        speechStop();
        setVoice("off");
        setVoiceText("");
        return;
      }
      voicePhaseRef.current = "active";
      setVoice("listening");
    } catch (e) {
      voicePhaseRef.current = "idle";
      showVoiceFail(`语音启动失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 松手：收最终文本 → **整句直接喂给 OH**（ohAsk：开面板 + 直接发送）。
   *  不进输入框、不建新会话（2026-10-10 用户拍板：识别结果就是一条完整消息）。
   *  cancel=true（上划取消 / pointercancel / 失焦）→ 丢弃识别文本，**不发送**。 */
  const finishVoice = async (cancel = false): Promise<void> => {
    // 守卫读 phase ref（真时序），不读渲染快照的 voice——启动窗口内松手也能正确收尾
    if (voicePhaseRef.current === "idle") return;
    const started = voicePhaseRef.current === "active";
    voicePhaseRef.current = "idle";
    setPressing(false);
    resetCancelPull();
    if (!started) {
      // 尚未进入监听：无需等识别器收尾
      speechStop();
      setVoice("off");
      setVoiceText("");
      return;
    }
    if (cancel) {
      // 上划取消：直接收，不等最终结果（反正要丢），也不发送
      speechStop();
      setVoice("off");
      setVoiceText("");
      showVoiceFail("已取消");
      return;
    }
    setVoice("sending");
    speechStop();
    await new Promise((r) => setTimeout(r, VOICE_FINAL_GRACE_MS)); // 识别器收尾出最终结果
    const final = (await speechPoll()).trim();
    setVoice("off");
    if (!final) {
      setVoiceText(""); // 什么都没听到：安静收场，不发空消息
      return;
    }
    // 这里**不清** voiceText：字幕要多留一拍做渐出（清空由下次 enterVoice 负责）
    if (busyRef.current) {
      // ohAsk 的 send 被 busy 守卫挡住会静默吞掉这一句——明说，别让用户以为识别失败了
      showVoiceFail("小OH 正在回答，稍后再长按说");
      return;
    }
    /* dev-explorer（用户定案）：胶囊/语音只负责产生文字，送给谁由上方切换按钮（mode）决定——
       search = 文本预填进胶囊（live 镜像即时更新窗内检索结果）；oh = 直发对话。 */
    if (modeRef.current === "search") {
      openPanelAs("search", final);
      return;
    }
    setSlidIn(true); // 面板滑动进场（区别于点击的 morph）
    ohAsk(final); // ← 唯一出口：完整一条消息直接发给 OH
    window.setTimeout(() => setSlidIn(false), 700);
  };

  /** 「自动朗读」开关（对话界面的入口；**设置 → OH → 普通配置 → 语音** 是同源开关，同一份 prefs）：
   *  点击 = 切 autoSpeak（读现读值，不用渲染快照，避免连点丢状态）；长按/右键 = 跳到设置页那个分区。 */
  const toggleAutoSpeak = (): void => {
    const next = !readVoicePrefs().autoSpeak;
    setVoicePrefs({ autoSpeak: next });
    setNotice(next ? "已开启自动朗读：OH 的回复会念出来" : "已静音：OH 的回复不再自动朗读");
  };
  const openVoiceSettings = (): void => {
    /* 2026-10-11 用户要求「彻底切割」：对话面板与 OneTHU Harness **没有任何跳转关系**，
       这里只提示路径，不做导航（顺手收起面板以免挡视线）。 */
    if (open) toggle();
    setNotice("语音设置：插件 → OneTHU Harness → 基础设置");
  };

  /** 附件（需求 6+7）：AttachTray 取到文件 → ① 面板里记一条**用户气泡**；
   *  ② 弹出动作面板（转存云盘 / 交作业 / 发讨论区）。与悬浮面板（GlobalOrb）同一套口径：
   *  气泡由宿主渲染，动作执行在 AttachActionsSheet 内部，结果回来再提示 / 导航。 */
  const attachPicked = useCallback(async (files: AttachFile[]): Promise<void> => {
    if (files.length === 0) return;
    const summary = files.map((f) => `${f.name}（${formatSize(f.size)}）`).join("、");
    /* 图片附件：先读成 data URL 再入列——AttachTray 会在交付后回收 previewUrl（blob:），
       气泡里的缩略图不能依赖它，否则关上动作面板图就白了。读不到就退回文件名（text 还在）。 */
    const images: ViewImage[] = [];
    for (const f of files) {
      if (!f.mime.startsWith("image/")) continue;
      const src = await dataUrlForPick(f);
      if (src) images.push({ name: f.name, src });
    }
    setMsgs((v) => [...v, { role: "user", text: `［附件］${summary}`, ...(images.length > 0 ? { images } : {}) }]);
    sheetRef.current = files;
    setSheetFiles(files);
  }, []);

  /** 动作面板收口：成功/失败给一行提示；需要回本体某页才能继续的（result.ui.route）直接导航。
   *  **不关面板**：needUi 时面板里还有「打开官方作答页」按钮，关掉就没得点了。 */
  const attachDone = useCallback((d: AttachActionDone): void => {
    const r = d.result;
    setNotice(r.ok ? `附件已处理${r.path ? `：${r.path}` : ""}` : `附件动作未完成${r.error ? `：${r.error}` : ""}`);
    if (r.ui?.route) navGo(r.ui.route, r.ui.params as Record<string, unknown> | undefined);
  }, []);

  const attachClosed = useCallback((): void => {
    releaseAttachPreviews(sheetRef.current ?? []); // 生命周期归宿主：面板关掉即回收预览地址
    sheetRef.current = null;
    setSheetFiles(null);
  }, []);

  /** 手动「朗读这一条」：用户当场点的＝明确意图，走 previewSpeak 强制出声（无视静音开关）；
   *  再点同一条＝停。自动朗读那条路径完全交给 speakReply 内部判 autoSpeak（见 finalize）。 */
  const speakOne = useCallback((text: string): void => {
    if (speakingText === text) {
      void ttsStop();
      setSpeakingText(null);
      return;
    }
    void (async () => {
      await ttsStop(); // 换条目：先掐上一条，避免两段叠着念
      if (await previewSpeak(text)) {
        speakGen.current += 1;
        setSpeakingText(text);
      }
    })();
  }, [speakingText]);

  /* ── 上划取消（微信式）─────────────────────────────────────────────
     位移进度 0..1 连续写进 :root 的 --dock-cancel（CSS 用它做颜色渐变，不引发重渲染）；
     是否算「取消」只读 cancelArmedRef（迟滞：跨阈值才 arm，回落到 0.85×阈值以下算反悔）。 */
  const applyCancelPull = (clientY: number): void => {
    const y0 = holdStartY.current;
    if (y0 == null) return;
    const dy = y0 - clientY; // 向上为正
    const pct = Math.max(0, Math.min(1, dy / CANCEL_PULL_PX));
    cancelPctRef.current = pct;
    document.documentElement.style.setProperty("--dock-cancel", pct.toFixed(3));
    const armed = cancelArmedRef.current ? pct > 0.85 : pct >= 1;
    if (armed !== cancelArmedRef.current) {
      cancelArmedRef.current = armed;
      setCancelling(armed);
    }
  };
  const resetCancelPull = (): void => {
    document.body.classList.remove("dock-voice-lock"); // 手指抬起/取消：解冻页面
    holdStartY.current = null;
    cancelPctRef.current = 0;
    cancelArmedRef.current = false;
    document.documentElement.style.setProperty("--dock-cancel", "0");
    setCancelling(false);
  };
  /** 按住期间的 pointermove：两个宿主共用（指针已被 setPointerCapture 捕获，事件必到按钮） */
  /** ③③ 手势是否归我们：附件三入口不接管（保留原生点按），其余（含输入框）都归长按判定。
   *  输入框里**已经有字**时把长按让给选词/光标（空着才当「长按说话」）。 */
  const holdMine = (target: EventTarget | null): boolean => {
    const el = target instanceof Element ? target : null;
    return !el?.closest(".dock-attach"); // 输入框已上移进胶囊：只有附件三入口不接管长按
  };
  const onRowPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!holdMine(e.target)) return;
    beginHold("entry", e.clientY);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败仍可长按 */
    }
  };
  /** 未到阈值 = 单击：输入口在胶囊里，这里不做事（长按语音照旧） */
  const onRowPointerUp = (): void => endHold(() => undefined);
  const onRowLostCapture = (): void => {
    if (voicePhaseRef.current !== "idle") void finishVoice(true);
  };
  const onRowPointerCancel = (): void => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      resetCancelPull();
      return;
    }
    void finishVoice(true);
  };

  /* A 顶部把手：竖直拖动改面板高度（面板贴底，所以**往上拖=变高**）。 */
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const panel = (e.currentTarget as HTMLElement).closest(".dock-panel") as HTMLElement | null;
    dragRef.current = { y0: e.clientY, h0: panel?.getBoundingClientRect().height ?? 0 };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败也能拖（事件仍冒泡到达） */
    }
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    const vh = window.innerHeight;
    /* 手机（A5）：可拉满高——区间放宽到 0.35 ⟷ 0.94（桌面维持 0.3 ⟷ 0.8） */
    const phoneH = isPhoneNow();
    const hi = Math.min(vh * (phoneH ? 0.94 : DOCK_H_MAX_RATIO), capsuleRect?.maxHeight ?? vh);
    const lo = Math.min(hi, vh * (phoneH ? 0.35 : DOCK_H_MIN_RATIO));
    /* 顶置形态（top 锚、把手在底部）：向下拽=变长（h=h0+dy）；底部形态（bottom 锚、把手在顶部）：
       向上拽=变长（h=h0−dy，原语义）。 */
    const topdock = topdockRef.current;
    const raw = topdock ? d.h0 + (e.clientY - d.y0) : d.h0 - (e.clientY - d.y0);
    const next = Math.max(lo, Math.min(hi, raw));
    setPanelH(Math.round(next));
  };
  const onHandleUp = (): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    setPanelH((h) => {
      if (h != null) {
        try {
          localStorage.setItem(DOCK_H_KEY, String(h));
        } catch {
          /* 存不进去也能用（本次会话内生效） */
        }
      }
      return h;
    });
    stickBottom();
  };

  const onHoldMove = (e: ReactPointerEvent<HTMLElement>): void => {
    if (holdStartY.current == null) return; // 没在按住（正常移动/惯性滑动）
    applyCancelPull(e.clientY);
  };

  /* ── 长按语音的按下/抬起：灵动岛与面板入口条共用同一套 450ms 语义 ── */
  const beginHold = (host: "island" | "entry", clientY: number): void => {
    /* 语音手势期间冻结页面：touch-action 沿祖先链取交集，body 上写 none 就等于整页不许滚。
       这样「上划取消」不会再带着页面一起上滑，浏览器也不会把这次触摸判成滚动而抢走指针。 */
    document.body.classList.add("dock-voice-lock");
    holdStartY.current = clientY;
    cancelPctRef.current = 0;
    cancelArmedRef.current = false;
    document.documentElement.style.setProperty("--dock-cancel", "0");
    void ttsStop(); // 开始长按说话 → 正在念的回答立刻让路（两个声音别打架）
    setSpeakingText(null);
    setVoiceFail(null);
    setVoiceHost(host);
    setPressing(true); // 先给「准备中」的轻微反馈，越过 450ms 才真的长起来
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      setPressing(false);
      voicePhaseRef.current = "starting";
      void enterVoice();
    }, VOICE_HOLD_MS);
  };
  /** 抬起：未到阈值 → 走调用方的点击语义；已进语音 → 收尾（取消判定读 ref，不看快照） */
  const endHold = (onTap: () => void): void => {
    setPressing(false);
    const pulled = cancelArmedRef.current;
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      resetCancelPull();
      if (pulled) return; // 还没进语音就上划离开：点击也一并取消（微信式，不发不点）
      onTap();
      return;
    }
    const cancel = cancelArmedRef.current;
    void finishVoice(cancel);
  };

  /* ── dev-explorer：原位语音胶囊的手势 ──
     空闲态的胶囊已外移为 OhCapsule（components/explorer/OhCapsule.tsx，纯触发器）；
     这里只保留**语音进行中**的原位胶囊：点按＝收尾直发，上划过阈值＝取消（与旧岛同口径）。 */
  const onPillPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    holdStartY.current = e.clientY;
    cancelPctRef.current = 0;
    cancelArmedRef.current = false;
    document.documentElement.style.setProperty("--dock-cancel", "0");
    document.body.classList.add("dock-voice-lock");
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败仍可收尾 */
    }
  };
  const onPillPointerUp = (): void => {
    document.body.classList.remove("dock-voice-lock");
    holdStartY.current = null;
    void finishVoice(cancelArmedRef.current);
  };
  const onPillPointerCancel = (): void => {
    document.body.classList.remove("dock-voice-lock");
    holdStartY.current = null;
    void finishVoice(true); // 系统手势抢占：按取消处理
  };

  /* 面板底栏：手势（点 = 展开输入框、长按 = 语音）统一挂在**容器**上（见 onRowPointerDown），
     这样进输入态之后长按照样能重新进语音。这里只留键盘可达性。 */
  /* dev-explorer：面板不再只属于 OH 对话——搜索模式是宿主侧能力，无 Harness 进程也要能开。
     OH 对话本身仍需 pid（send/runCmd 各自有 !pid 守卫）。 */
  if (!pid && !open) return null;
  /* 语音态：条内只留一行提示（波纹在上），识别出的字一律进条上方的雾状字幕带 —— 两处不重复 */
  /* OneGUI 收编的外观降级开关：安卓手机档去 blur/换实档面（原 html.is-phone 契约，纯读平台） */
  const phone = isPhoneNow();
  const voiceHint = voiceHintOf(voice, cancelling, mode);
  const liveShown = voiceText.length > LIVE_TAIL_CHARS ? `…${voiceText.slice(-LIVE_TAIL_CHARS)}` : voiceText;
  const subText = cancelling && voice !== "off"
    ? "松开取消"
    : voice === "off" ? liveShown : voice === "arming" ? "正在启动语音…" : liveShown || "请说话…";

  return (
    <>
      {/* 条**上方**的雾状字幕带：长按期间雾里显示目前识别出来的字（比条更宽、更淡、两端渐隐） */}
      {(voice !== "off" || subLinger) && subText.trim() ? (
        <VoiceSubtitle text={subText} out={voice === "off"} />
      ) : null}

      {/* dev-explorer：空闲胶囊外移为 OhCapsule（底栏中央/桌面顶栏，纯触发器）。
          这里只渲染**语音进行中**的原位胶囊（同一位置现出波纹/雾），点=收尾、上划=取消；
          捕获丢失（onLostPointerCapture）按取消兜底，语音绝不悬死。 */}
      {/* dev-explorer（用户拍板）：语音波纹只渲染在底栏胶囊本体（OhCapsule is-hold），
          这里不再有第二颗波纹条；雾状识别字幕仍在本行上方（VoiceSubtitle）。 */}

      {/* 语音失败的雾状浮片：本次长按发生在岛上时（发生在面板里时落在入口条内联） */}
      {voiceFail && voiceHost === "island" ? (
        <div className="dock-voice-toast" role="status" aria-live="polite">{voiceFail}</div>
      ) : null}

      {open || closing ? (
        <div
          data-og-scope="oh.dock"
          className={"dock-panel" + (capsuleRect ? " ohx-panel-grow" : "") + (capsuleRect?.topdock ? " is-topdock" : "") + (closing ? " is-closing" : "") + (slidIn ? " is-slide" : "")}
          role="dialog"
          aria-label={i18n("auto.plugins.ChatDock.21")}
          style={{
            /* 从胶囊顶边长出来：left/width 量可见胶囊的 rect；bottom 走 explorer-ui 契约变量（行为几何原样）。
               材质/圆角/过场相位合进 panelMat（oh.dock scope 调度，OneGUI 令牌，见文件头常量块）。
               量不到胶囊（极端：底栏未渲染）时挂回落底板常量（旧居中形态），绝不错位。 */
            ...PANEL_GEO_COMMON,
            ...(capsuleRect
              ? capsuleRect.topdock
                ? /* 顶置底栏（桌面/横屏）：窗从胶囊**底边向下**生长，朝上会出屏 */
                  { left: capsuleRect.left, width: capsuleRect.width, bottom: "auto", top: capsuleRect.bottom + 4 }
                : { left: capsuleRect.left, width: capsuleRect.width, bottom: capsuleRect.bottomInset }
              : (phone ? PANEL_GEO_FALLBACK_PHONE : PANEL_GEO_FALLBACK)),
            height: panelH != null ? `${panelH}px` : phone ? "60dvh" : "62dvh",
            minHeight: 0,
            maxHeight: capsuleRect?.maxHeight ?? "calc(100dvh - 80px)",
            /* 过场相位：in=首帧 from 值 → base；out=离场。grow 路径的 ohx-grow/ohx-shrink 契约动画照旧承担 */
            ...panelMat(phone, !!capsuleRect, closing ? "out" : panelSettled ? "base" : "in"),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 面板自己接住点按，且不再冒泡：应用里的委托监听不该把「面板内的点按」当页面点击。
              命中区域被动画缩放搞小的那段历史见 global.css 的 keyframes 注释。 */}
          {/* A 把手：所有悬浮窗顶部都有，上下拖动拉长拉短（高度写进 localStorage，下次沿用） */}
          <div
            className={"dock-handle" + (dragging ? " is-drag" : "")}
            role="separator"
            aria-label={i18n("auto.plugins.ChatDock.22")}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onLostPointerCapture={onHandleUp}
          />
          {/* 头部行（OneGUI 收编）：动作钮走 Btn/IconBtn（ghost/outline 语义出外观与 a11y），
              创造模式以 tone=brand + is-on 类点亮（旧 .dock-btn.dock-creative 手写样退役）。 */}
          <div className="dock-head" style={MAT_HEAD}>
            <span className="dock-title" style={MAT_TITLE} title={i18n("auto.plugins.ChatDock.23")}><HarnessMark size={15} /></span>
            {/* dev-explorer：搜索 | OH 二合一开关（同一扇窗两种形态；小窗可拖、气泡不动的口径不变）。
                OOSE 红线：`?explorer-preview=search-oh` 以 `.dock-panel [role='tab']` 命中第二个 tab
                收到 OH —— 这组_raw-tablist 结构（explorer-oh.css 契约样式）保持原样。
                 */}
            <div className="ohx-modeswitch" role="tablist" aria-label={i18n("auto.plugins.ChatDock.24")}>
              <Btn size="sm" role="tab" aria-selected={mode === "search"} className={mode === "search" ? "is-active" : ""} onClick={() => setMode("search")}>{i18n("auto.plugins.ChatDock.25")}</Btn>
              <Btn size="sm" role="tab" aria-selected={mode === "oh"} className={mode === "oh" ? "is-active" : ""} onClick={() => { setMode("oh"); requestAnimationFrame(() => stickBottom()); }}>OH</Btn>
              {/* 第三态：清小搭（2026-10-15 用户口径「搜索 / OH / 清小搭 三选一」）。务必追加在 OH 之后：
                  OOSE 预览契约以 `.dock-panel [role='tab']` 的**第二个** tab 命中 OH，顺序不能动。 */}
              {/* 用 OG Btn 出本体（不新增裸控件计数），但保留 role=tab —— OOSE 预览契约按
                  `.dock-panel [role='tab']` 找页签，顺序仍是 搜索 / OH / 清小搭。 */}
              {!simple && <Btn
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={mode === "xiaoda"}
                className={mode === "xiaoda" ? "is-active" : ""}
                onClick={() => setMode("xiaoda")}
              >
                {i18n("auto.plugins.ChatDock.26")}</Btn>}
            </div>
            <div className="dock-ops" style={matOps}>
              {mode === "oh" ? <>
              {/* 创造模式（2026-10-13）：图标+文字开关钮（用户拍板：不能只是一颗星，旁边要写字）。
                  开=OG brand tone 描边点亮；引擎下轮对话收到 creativeMode=true，系统提示词追加「主动创造」段 */}
              {!simple && <Btn
                variant="ghost" size="sm"
                tone={creative ? "brand" : "default"}
                titleAttr={i18n("auto.plugins.ChatDock.27")}
                aria-label={i18n("auto.plugins.ChatDock.28")}
                aria-pressed={creative}
                className={creative ? "is-on" : undefined}
                icon={<IconSpark />}
                onClick={() => setCreative(!creative)}
              >
                {i18n("auto.plugins.ChatDock.28")}</Btn>}
              <IconBtn label={i18n("auto.plugins.ChatDock.29")} variant="outline" size="sm" titleAttr={i18n("auto.plugins.ChatDock.29")} icon={<IconPlus />} onClick={() => void newSession()} />
              <IconBtn label={i18n("auto.plugins.ChatDock.30")} variant="outline" size="sm" titleAttr={i18n("auto.plugins.ChatDock.30")} icon={<IconClock />} onClick={() => void openHistory()} />
              <IconBtn label={i18n("auto.plugins.ChatDock.31")} variant="outline" size="sm" titleAttr={i18n("auto.plugins.ChatDock.32")} icon={<IconDownload />} onClick={() => void exportSession()} />
              <IconBtn label={i18n("auto.plugins.ChatDock.33")} variant="outline" size="sm" titleAttr={i18n("auto.plugins.ChatDock.34")} icon={<IconUpload />} onClick={() => fileRef.current?.click()} />
              <input
                ref={fileRef}
                type="file" accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importSession(f);
                  e.target.value = "";
                }}
              />
              {ttsOk ? (
                <IconBtn
                  label={prefs.autoSpeak ? "关闭自动朗读" : "开启自动朗读"}
                  titleAttr={prefs.autoSpeak ? "自动朗读已开启（点击改静音；长按进语音合成设置）" : "当前静音（点击开自动朗读；长按进语音合成设置）"}
                  variant="ghost" size="sm"
                  tone={prefs.autoSpeak ? "brand" : "default"}
                  className={prefs.autoSpeak ? "is-on" : undefined}
                  icon={prefs.autoSpeak ? <IconSpeak /> : <IconSpeakOff />}
                  aria-pressed={prefs.autoSpeak}
                  onClick={toggleAutoSpeak}
                  onContextMenu={(e) => { e.preventDefault(); openVoiceSettings(); }}
                />
              ) : null}
              </> : null}
              <IconBtn label={i18n("auto.plugins.ChatDock.35")} variant="outline" size="sm" titleAttr={i18n("auto.plugins.ChatDock.35")} icon={<IconX />} onClick={toggle} />
            </div>
          </div>
          {notice ? (
            /* 通知条（旧 .dock-notice 琥珀一行）→ OG Banner（tone=warning，X 退场按钮出 dismiss） */
            <Banner tone="warning" onDismiss={() => setNotice(null)}>
              <span style={MAT_PRE}>{notice}</span>
            </Banner>
          ) : null}
          {/* dev-explorer：search 态整块换成搜索面（同窗切换；oh 态气泡区原样保留） */}
          {/* dev-explorer：pid 未就绪（浏览器预览/Harness 未加载）时 OH 对话不可能在此渲染——
              欢迎页会伪装成「对话被吃」，直接给明确说明卡，搜索模式照常可用 */}
          {mode === "oh" && !pid ? (
            <div className="dock-oh-missing">
              <b>{i18n("auto.plugins.ChatDock.36")}</b>
              <p>{i18n("auto.plugins.ChatDock.37")}</p>
              <p>{i18n("auto.plugins.ChatDock.38")}</p>
            </div>
          ) : mode === "xiaoda" ? (
            <XiaodaPane onNotice={setNotice} />
          ) : mode === "search" ? (
            <OhSearchPane
              query={searchQuery}
              onClose={toggle}
              onAskOh={(q) => {
                setMode("oh");
                setSearchQuery("");
                if (q) ohAsk(q); // 丝滑切换：小窗内一键到 OH 对话页并把问题发出去
              }}
              onNotice={setNotice}
            />
          ) : (
          <DockMsgList
            msgs={msgs}
            stream={stream}
            status={status}
            think={think}
            thinkOpen={thinkOpen}
            trace={trace}
            confirmCard={confirmCard}
            busy={busy}
            ttsOk={ttsOk}
            autoSpeak={prefs.autoSpeak}
            speakingText={speakingText}
            onSpeak={speakOne}
            onRenewMadModel={renewMadModel}
            onOpenOwnApi={openOwnApi}
            scrollRef={scrollRef}
            onSend={(t) => void send(t)}
            onPick={(t) => setDockInputValue(t)}
            onToggleThink={() => setThinkOpen((o) => !o)}
            onMsgsClick={onMsgsClick}
          />
          )}
          {sheetFiles ? (
            <AttachActionsSheet files={sheetFiles} onClose={attachClosed} onDone={attachDone} />
          ) : null}
          {/* 输入框已删（用户 2026-10-19：「胶囊自带接管所有这个地方的文字输入，删了 OH 自己的输入框」）：
              文本输入唯一入口 = 底栏胶囊 ohx-input。这行只剩附件入口；search 态整行收起。 */}
          {mode === "oh" ? (
          <div className="dock-input-row" ref={rowRef}>
            <div className="dock-attach">
              <AttachTray onPicked={attachPicked} />
            </div>
          </div>
          ) : null}
          {history != null ? (
            /* 历史会话浮层（OG 收编）：手写 Sheet 模式——锚在面板内（不走 portal，外点收窗
               closest(".dock-panel") 守卫仍可覆盖），材质/描边走 oneGUI 浮层令牌 + 挂载相位；
               行本体直接用 OG Row（标题/元信息/尾钮槽），删除钮 stopPropagation 保序（不再误切会话）。 */
            <div className="dock-history" role="menu" style={matHistorySheet(histSettled)}>
              <div className="dock-history-head" style={MAT_HIST_HEAD}>
                <b>{i18n("auto.plugins.ChatDock.30")}</b>
                <Btn variant="outline" size="sm" onClick={() => setHistory(null)}>{i18n("auto.plugins.ChatDock.39")}</Btn>
              </div>
              {history.length === 0 ? (
                <div className="dock-empty" style={matEmpty}>{i18n("auto.plugins.ChatDock.40")}</div>
              ) : history.map((s, idx) => (
                idx === 0 ? (
                  /* 1 号主对话永久保留（用户定案）：不提供删除入口 */
                  <Row
                    key={s.id}
                    title={`① ${s.title || "未命名"}`}
                    sub={`主对话 · ${s.messages} 轮 · ${fmtUsd(s.costUsd)}`}
                    titleAttr={i18n("auto.plugins.ChatDock.41")}
                    trailing={<Text slot="micro" tone="faint">—</Text>}
                  />
                ) : (
                  <Row
                    key={s.id}
                    title={s.title || "未命名"}
                    sub={`${s.messages} 轮 · ${fmtUsd(s.costUsd)}`}
                    onClick={() => void switchSession(s.id)}
                    trailing={
                      <IconBtn
                        label={i18n("auto.plugins.ChatDock.42")}
                        variant="outline"
                        size="sm"
                        icon={<IconX />}
                        onClick={(e) => { e.stopPropagation(); void deleteSession(s.id); }}
                      />
                    }
                  />
                )
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
