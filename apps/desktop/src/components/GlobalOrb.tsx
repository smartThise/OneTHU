/**
 * 全局悬浮球前端（需求 5）——桌面悬浮窗 / 安卓悬浮层共用的 UI 面。
 *
 * 形态（原生侧通过 overlaySetMode 驱动；桌面只有前两个，安卓另有侧边条等）：
 *   ball  → 实底 + 1px 细边 + 轻投影的球：单击开面板、按住拖动（桌面）
 *   panel → 单击后铺开的悬浮小窗：**整块圆角毛玻璃 + 裸文字条目**，不是应用内那套气泡 UI
 *   （bar 语音条：桌面已按用户口径下线，仅安卓原生侧保留；桌面说话走输入框 + 系统听写）
 *
 * 设计口径（2026-10-14 OneGUI 收编）：外观全部来自 @onethu/gui ——
 *   - 两块壳自挂 data-og-scope="oh.orb"（专属档位在 explorer/ohOrbScope.ts 经 og.defineScope
 *     登记，由 StyleDirector 写进受控样式表）；壳上只写「纯几何 + OG 语义令牌引用」，
 *     零字面色、零运行时注入样式：旧组件自带 <style> 块（5 条 keyframes）已整体拆除，
 *     过场改为 CSS transition（transform/opacity/border-radius 状态 + OG Motion 令牌
 *     --og-dur-一族、--og-ease-一族），
 *     时长毫秒仍取与原生窗口切换同拍的 JS 常量；
 *   - 顶栏开关走 Segment、动作走 Btn，搜索/对话正文走 Text/Row/Chip/Input。
 *
 * 红线：这里只走纯前端通道（askOh / ohRun），绝不主动把主窗口拉到前台。
 */
import {
  memo, useCallback, useEffect, useRef, useState,
  type ComponentProps, type CSSProperties, type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Btn, Chip, Input, Row, Segment, Text, scopeProps } from "@onethu/gui";
import {
  onOverlayEvent, overlayHide, overlayPushUi, overlaySetMode, setOverlayClosedByUser,
  type OverlayMode,
} from "../lib/overlay.js";
import { askOh } from "../im/oh.js";
import { AttachTray } from "./AttachTray.js";
import { HarnessMark } from "./HarnessMark.js";
import { formatSize, sendToOh, type AttachFile } from "../lib/attach.js";
import { AttachActionsSheet } from "./AttachActionsSheet.js";
import { logLine } from "../lib/clients.js";
import { openExternal } from "../pages/info/openExternal.js";
import { readVoicePrefs, setVoicePrefs, useVoicePrefs } from "../state/voicePrefs.js";
import { speakReply } from "../lib/tts.js";
/* dev-explorer：搜索二合一（explorer-oh）。悬浮球是独立 webview：
   跳转一律走 jump* 系列（内部经 Tauri 事件递给主窗口执行），绝不本地 openTab。 */
import { useOhSearch, jumpEntry, jumpAtom, jumpSearchRow, jumpSettingsTab, jumpTabPayload } from "../plugins/ohSearch.js";
import { explorerPrefsSnapshot, useSearchHistory, type SearchJump } from "../state/explorerPrefs.js";
import { displayBreadcrumb } from "../state/searchRows.js";
import { OH_ORB_SCOPE } from "./explorer/ohOrbScope.js";
import { t as i18n } from "../i18n/index.js";
 // OH 专属档位登记进 OneGUI 管线（scope: oh.orb，受 OneGUI 调度）

/** 面板窗比视觉块四周多出的留白（与 overlay_win.rs 的 PANEL_SHADOW_PAD 同值）：
 *  那圈留白专门给面板的柔和外阴影，视觉块仍严格落在 14px 边距上。 */
const PANEL_PAD = 14;
/** 顶部把手夹取范围（屏高比例；Rust 侧还会再夹一次，前端只为拖动跟手不越界） */
const PANEL_MIN_RATIO = 0.3;
const PANEL_MAX_RATIO = 0.8;

/** 按下滑动多少 px 才算「拖动」（|dx|+|dy| 曼哈顿距离）——小于它一律当「点一下」。
 *  2026-10-11 实测问题：原值 6px 在手握鼠标时太容易触发（微抖就开拖），拖动一开就清掉长按
 *  定时器 → 长按 450ms 永远进不了语音。12px 是「鼠标微抖不会误触、有意拖动一推就走」的折中；
 *  与 lib/overlayDesktop.ts 的 DRAG_PX 必须保持一致。 */
const DRAG_PX = 12;

/** 悬浮窗内的取证日志（Rust 侧 [OVERLAY] + 这里 [orb]，用户跑一轮就能定位通信/把手问题） */
function logOrb(line: string): void {
  void logLine(`[orb] ${line}`).catch(() => undefined);
}

/** 面板高度改窗：夹取与落盘都在 Rust；**调用失败必须留痕**（命令没注册时 handle 会像「无效」） */
async function applyPanelHeight(h: number): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("overlay_set_panel_height", { h });
    logOrb(`handle → panel_h=${Math.round(h)}`);
    return;
  } catch (e) {
    // 专用命令没注册（旧包实测就是这条：Command overlay_set_panel_height not found）
    // → 退到一定注册过的 overlay_set_mode("panel:<高>")，把手在旧包上也能用。
    try {
      await invoke("overlay_set_mode", { mode: `panel:${Math.round(h)}` });
      logOrb(`handle → panel_h=${Math.round(h)}（走 set_mode 兼容路径；建议补注册 overlay_set_panel_height）`);
    } catch (e2) {
      logOrb(`改高度两条路径都失败：${String(e)} / ${String(e2)}`);
    }
  }
}

/* ── 悬浮球几何（**只在这里定尺寸**：窗口尺寸由原生按同样口径给） ──
 *   窗口 = 球 + 两侧各 BALL_PAD；投影画在球之外的留白里，所以永远不会被窗口边界裁掉
 *   （2026-10-11 用户实录：「半个球」「球形状阴影不对」= 球按整屏定位 + 投影被 64px 窗裁断）。 */
const BALL_VISUAL = 58; // 与 overlay_win.rs 的 BALL_VISUAL 一致
const BALL_PAD = 8; //     与 overlay_win.rs 的 BALL_PAD 一致（安卓 BALL_WIN_DP = BALL_DP + 16 同口径）
/* 小窗圆角收编 OneGUI：走 --og-radius-2xl 语义档（安卓原生仍用它的 PANEL_RADIUS_DP=24）。 */

/* ── 过场时长：与安卓同源（Drop 150 + Bloom 280 ≈ 430ms / Collapse 260 / BallIn 200） ── */
const DROP_MS = 150;
const BLOOM_MS = 280;
const COLLAPSE_MS = 260;
const BALL_IN_MS = 200;

/* ── 过场的「球形起止」状态（onegui 收编）：旧 5 条 keyframes 的 0%/100% 两帧平移成
 *  transition 的起止值。铺开与收拢互为镜像，共用这一组；滴落/弹回是球壳自己的两个值，
 *  写在球壳 JSX 上。曲线/时长改走 OG Motion 令牌（--og-ease-*）+ 与原生窗口切换同拍的
 *  JS 毫秒常量，不再有任何 <style> 注入。（ohOrbBarIn 属已下线的 bar 形态，连体删除。） */
const ORB_BALLISH: CSSProperties = {
  opacity: 0,
  transform: "scale(0.94) translateY(14px)",
  borderRadius: "var(--og-radius-full)",
};

interface Bubble { role: "user" | "oh"; text: string }

/** 背板收编 OneGUI：玻璃块的两个常量（background/backdropFilter/border/boxShadow）不再由本文件持有，
 *  面板壳直接引用 OneGUI 的浮层令牌族（--og-surface-overlay / --og-overlay-blur / --og-overlay-tint /
 *  --og-elev-menu，玻璃皮肤下半透明 + 模糊 + 顶沿渐变同量级，中性皮肤下实档浮面），
 *  scope: oh.orb 把面/线档锁成浮体档（见 explorer/ohOrbScope.ts）。
 *  注：透明悬浮窗里 backdrop-filter 只采样本窗口内容（macOS 合成器采样不到别家 App），
 *  所以视觉上是「半透明纸」而非「磨砂玻璃」——平台限制，但整块可见、边界清晰这两条成立。 */
/** 当前是否深色（本仓主题挂 <html data-theme|data-scheme>；取不到就按浅色） */
function isDarkUi(): boolean {
  try {
    const d = document.documentElement.dataset;
    return d.theme === "dark" || d.scheme === "dark";
  } catch {
    return false;
  }
}

/** markdown 里的图片：只渲染直链（data:/blob:/http(s)）。悬浮窗是独立 webview，
 *  没有主窗口那套本地路径读取通道（ChatDock 里有 dataUrlForPath），所以本地路径图**不渲染**，
 *  附件走的是 data:/blob:（AttachTray 给的就是 previewUrl）——这是两端渲染范围的已知差异。 */
function MdImage({ src, alt, ...rest }: ComponentProps<"img">): ReactNode {
  if (typeof src !== "string" || !/^(data:|blob:|https?:)/i.test(src)) return null;
  return <img {...rest} className="dock-md-img" src={src} alt={alt ?? ""} />;
}

/** markdown 里的链接：桌面 webview 里 window.open/<a target=_blank> 都无效（仓库既有结论），
 *  统一交给 openExternal（系统浏览器）——与本体同一条通道。 */
function MdLink({ href, children, ...rest }: ComponentProps<"a">): ReactNode {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) void openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

export const GlobalOrb = memo(function GlobalOrb({ initialMode = "ball" }: { initialMode?: OverlayMode }): ReactNode {
  const [mode, setMode] = useState<OverlayMode>(initialMode);
  /* dev-explorer：面板形态内的 搜索|OH 二合一。初值跟随「点击胶囊默认打开」偏好
     （同一份 explorerPrefs，悬浮球窗口各读一份快照）；面板每次铺开都按偏好重置。 */
  const [omode, setOmode] = useState<"search" | "oh">(() => explorerPrefsSnapshot().capsuleTap);
  const [oquery, setOquery] = useState("");
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sheetFiles, setSheetFiles] = useState<AttachFile[] | null>(null);
  /** 过场状态：drop（球滴落）→ bloom（面板铺开）/ collapse（收拢）→ bounce（球弹回） */
  const [anim, setAnim] = useState<"none" | "drop" | "bloom" | "collapse" | "bounce">("none");
  /** 过场「落位」标志：bloom/bounce 首帧先把壳落到球形起止值（ORB_BALLISH / 球壳 JSX），
   *  隔一帧翻 true → 壳上的 CSS transition（OG Motion 令牌给曲线）把它推回基态。
   *  旧 keyframes 是「组件自带 <style>」的挂载动画；transition 没有挂载帧，
   *  靠这个相位补同一拍，时长毫秒数与旧值一一对齐。 */
  const [settled, setSettled] = useState(false);
  /** 球心相对本窗左上角（逻辑 px），由原生 geometry 事件回传：决定「从球的方位滴落/收拢」 */
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const animTimer = useRef<number | null>(null);
  const modeRef = useRef<OverlayMode>(initialMode);
  /** 顶部把手拖动（改面板高度；记的是 **screenY**，见下面 onPointerMove 的注释） */
  const handleDrag = useRef<{ id: number; screenY0: number; h0: number } | null>(null);
  const lastPanelH = useRef(0);
  /** Rust 回传的真实窗口逻辑高度（geometry.h）——h0 只认它，不再拿常量/缓存推（task-18 ③） */
  const winHRef = useRef(0);
  const [handleDown, setHandleDown] = useState(false);
  const prefs = useVoicePrefs();

  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = (): void => {
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /* bloom/bounce 的挂载相位：首帧落 from 值，双 rAF 后翻 settled（transition 由此滑回基态）。
     drop/collapse 不经过这里——它们的元素已在挂载态，真过渡直接发生。 */
  useEffect(() => {
    if (anim !== "bloom" && anim !== "bounce") {
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
  }, [anim]);

  /** 过场定时器统一收口（连点/中途切形态不会叠动画） */
  const later = useCallback((ms: number, fn: () => void): void => {
    if (animTimer.current) window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => {
      animTimer.current = null;
      fn();
    }, ms);
  }, []);

  /** 开：球先「滴落」150ms，再让原生把窗切到面板，随即「铺开」280ms。
   *  dev-explorer：铺开时按「点击胶囊默认打开」偏好落搜索或 OH 形态。 */
  const openPanel = useCallback((): void => {
    if (modeRef.current === "panel") return;
    setOmode(explorerPrefsSnapshot().capsuleTap);
    setAnim("drop");
    later(DROP_MS, () => {
      setMode("panel");
      void overlaySetMode("panel");
      setAnim("bloom");
      later(BLOOM_MS, () => setAnim("none"));
    });
  }, [later]);

  /** 关：面板「反向收拢」260ms → 原生缩回球窗 → 球「弹回」200ms */
  const collapseToBall = useCallback((): void => {
    if (modeRef.current === "ball") return;
    setAnim("collapse");
    later(COLLAPSE_MS, () => {
      setMode("ball");
      void overlaySetMode("ball");
      setAnim("bounce");
      later(BALL_IN_MS, () => setAnim("none"));
    });
  }, [later]);

  /** 「回到 OneTHU」：唯一把主窗口带前台的路径，且必须由用户点这一下触发 */
  const backToApp = useCallback((): void => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("overlay_back_to_main");
      } catch {
        /* 安卓/浏览器：这条走原生侧自己的实现；失败不弹错 */
      }
    })();
  }, []);

  // 原生手势 → UI 状态机
  useEffect(() => {
    let un: (() => void) | null = null;
    void (async () => {
      un = await onOverlayEvent((e) => {
        if (e.type === "tap") {
          // 球 ↔ 面板：带过场（滴落铺开 / 收拢弹回），别直接硬切
          if (modeRef.current === "panel") collapseToBall();
          else openPanel();
        } else if ((e.type as string) === "geometry") {
          // 原生每次落位后回传：球心相对本窗左上角的逻辑坐标，给过场当 transform-origin
          const g = e as unknown as { x?: unknown; y?: unknown; h?: unknown };
          if (typeof g.x === "number" && typeof g.y === "number") setOrigin({ x: g.x, y: g.y });
          if (typeof g.h === "number" && g.h > 0) winHRef.current = g.h;
        } else if (e.type === "submit") {
          void send(e.text ?? "");
        } else if (e.type === "closed") {
          setOverlayClosedByUser(true);
          setMode("hidden");
          void overlayHide();
        }
      });
    })();
    return () => un?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async (text: string): Promise<void> => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setInput("");
    scrollToEnd();
    setTyping(true);
    try {
      const r = (await askOh(t)) as { answer?: unknown; text?: unknown; error?: unknown } | null;
      // ⚠️ 2026-10-11 用户实录「悬浮窗发消息永远收不到回复」根因：askOh 的返回是
      // `OhChatResult{answer}`（im/oh.ts:96-104），这里原来读的是**不存在的 `.text`** →
      // 永远拿到空串 → 面板只显示「（没有拿到回复）」。链路本身是通的（Promise 正常 resolve），
      // 主窗口的 ChatDock 用的是同一个 askOh/回答字段，所以 app 内正常、浮窗不正常。
      const answer = String(r?.answer ?? r?.text ?? "").trim();
      if (!answer) {
        logOrb(`askOh 返回空答案：keys=[${Object.keys(r ?? {}).join(",")}] err=${String(r?.error ?? "")}`);
      }
      setMsgs((m) => [...m, {
        role: "oh",
        text: answer || `（没有拿到回复${typeof r?.error === "string" ? `：${r.error}` : ""}；调试日志 /tmp/onethu-debug.log 有 [orb] 行）`,
      }]);
      // 需求 4：默认静音；顶栏「自动朗读」开了才念（偏好存 state/voicePrefs）
      if (answer && readVoicePrefs().autoSpeak) void speakReply(answer);
    } catch (e) {
      setMsgs((m) => [...m, { role: "oh", text: `（出错了：${e instanceof Error ? e.message : String(e)}）` }]);
    } finally {
      setTyping(false);
      scrollToEnd();
    }
  }, []);

  // 状态推送：安卓系统悬浮层用原生 UI 渲染，必须由前端把内容推过去
  useEffect(() => {
    void overlayPushUi({
      messages: msgs,
      transcript: "",
      level: 0,
      listening: false,
      busy: typing,
      mode,
      theme: isDarkUi() ? "dark" : "light",
    });
  }, [msgs, typing, mode]);

  // 新消息滚到底（内容完整渲染，可滑动回看）
  useEffect(scrollToEnd, [msgs.length, typing]);

  /* dev-explorer：搜索模式数据源（hooks 必须无条件调用——搜索面只是条件渲染） */
  const { result: oresult, total: ototal } = useOhSearch(oquery);
  const ohist = useSearchHistory();

  if (mode === "hidden") return null;

  /* ── 球：onegui 收编后的壳 ──
   *  几何铁律（2026-10-11 修「半个球 / 阴影不对」）不变：
   *    ① 外框吃满窗口（inset:0），手势挂在外框 → 球外那圈留白也吃点击，没有死区；
   *    ② 球**只在内层**画（BALL_VISUAL），四周留 BALL_PAD 给投影；
   *    ③ 投影半径压到 6px：留白 8px > 偏移 2px + 可见尾巴，绝不会被窗口边界裁出硬线；
   *    ④ 不用 right/bottom 定位（那是整屏窗口的写法，球窗里必然被推出窗外 = 半个球）。
   *  桌面球只做两件事：**单击开面板**、**按住拖动**。长按语音已按用户口径整体下线
   *  （2026-10-11），桌面要说话就用面板里的输入框 + 系统听写。
   *  外观：壳上只引用 OG 语义令牌（scope oh.orb 把 surface-1/line-1 上调到浮体档）；
   *  圆 = --og-radius-full，浮起 = --og-elev-2，模糊挂 --og-surface-blur（玻璃皮肤生效）。
   *  滴落（drop）/弹回（bounce）= CSS transition：旧 ohOrbDrop / ohOrbBounce 的首尾帧
   *  原值平移；弹回的中段过冲交给 --og-ease-spring 曲线本身（与旧贝塞尔同族同参数）。 */
  if (mode === "ball") {
    const fromBall = anim === "bounce" && !settled;
    return (
      /* 手势在外框上（= 整个窗口）；`data-oh-ball` 是 overlayDesktop 手势桥的闸门：
          只有从这里按下的按压才可能触发拖窗，拖把手/划消息/点输入框都不会误触。 */
      <div
        role="button"
        data-oh-ball="1"
        aria-label={i18n("auto.components.GlobalOrb.1")}
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          userSelect: "none", touchAction: "none", cursor: "pointer",
        }}
        onPointerDown={(e) => {
          pressStart.current = { x: e.clientX, y: e.clientY };
          draggedRef.current = false;
        }}
        onPointerMove={(e) => {
          const st = pressStart.current;
          if (!st || draggedRef.current) return;
          if (Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > DRAG_PX) {
            draggedRef.current = true;
            logOrb(`位移 > ${DRAG_PX}px → 判定拖动（松手不再开面板）`);
          }
        }}
        onPointerUp={() => {
          const wasDrag = draggedRef.current;
          draggedRef.current = false;
          pressStart.current = null;
          if (!wasDrag) openPanel(); // 球滴落 → 面板铺开
        }}
      >
        <div
          {...scopeProps(OH_ORB_SCOPE)}
          aria-hidden
          style={{
            width: BALL_VISUAL, height: BALL_VISUAL,
            borderRadius: "var(--og-radius-full)",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--og-surface-1)",
            color: "var(--og-content-1)",
            border: "1px solid var(--og-line-1)",
            boxShadow: "var(--og-elev-2)",
            backdropFilter: "var(--og-surface-blur)",
            WebkitBackdropFilter: "var(--og-surface-blur)",
            transition:
              anim === "bounce"
                ? `transform ${BALL_IN_MS}ms var(--og-ease-spring), opacity ${BALL_IN_MS}ms var(--og-ease-spring)`
                : `transform ${DROP_MS}ms var(--og-ease-standard), opacity ${DROP_MS}ms var(--og-ease-standard)`,
            transform: anim === "drop"
              ? "scale(0.86,1.16) translateY(4px)"
              : fromBall ? "scale(0.82)" : undefined,
            opacity: anim === "drop" ? 0.82 : fromBall ? 0.55 : undefined,
          }}
        >
          <HarnessMark size={17} />
        </div>
      </div>
    );
  }

  /* ── 对话面：悬浮小窗（安卓 A①：左右/底部各留 14、高 44%~80%）里的整块毛玻璃 ──
   *  窗口尺寸由原生给（`overlay_win.rs`：视觉块 14 边距 + 四周 PANEL_SHADOW_PAD 阴影留白），
   *  这里负责：inset 14 的视觉块 + 圆角 + overflow:hidden + 柔和外阴影。
   *  材质 = OneGUI 浮层令牌族（Surface--overlay 组件同款取值：--og-surface-overlay 半透明面 +
   *  --og-overlay-blur 模糊 + --og-overlay-tint 顶沿光 + --og-elev-menu 阴影 + line 档走 scope
   *  提档）。Surface 组件收不下这份「fixed 落位 + 过场状态」的内联几何（组件刻意不暴露
   *  style），所以壳直接引用组件同一组语义令牌 —— 值源仍全在 OH scope 与 OG 皮肤里。
   *  铺开（bloom）/收拢（collapse）= CSS transition，共用球形起止值 ORB_BALLISH；
   *  进场沿 decelerate、离场沿 accelerate —— 旧 ohOrbBloom/ohOrbCollapse 原值平移。 */
  const fromBallish = anim === "collapse" || (anim === "bloom" && !settled);
  const goOut = anim === "collapse";
  const goMs = goOut ? COLLAPSE_MS : BLOOM_MS;
  const goEase = goOut ? "var(--og-ease-accelerate)" : "var(--og-ease-decelerate)";
  return (
    <div
      {...scopeProps(OH_ORB_SCOPE)}
      style={{
        position: "fixed", inset: PANEL_PAD, zIndex: 9999,
        display: "flex", flexDirection: "column",
        padding: "var(--og-space-2) var(--og-space-4) var(--og-space-3)",
        borderRadius: fromBallish ? "var(--og-radius-full)" : "var(--og-radius-2xl)",
        overflow: "hidden",
        color: "var(--og-content-1)",
        border: "1px solid var(--og-line-1)",
        background: "var(--og-surface-overlay)",
        backgroundImage: "var(--og-overlay-tint)", // 顶沿光（Surface--overlay 同款取值），玻璃的「厚度」感
        boxShadow: "var(--og-elev-menu)", // 阴影尾巴落在 PANEL_PAD 留白里不会被窗口边界裁
        backdropFilter: "var(--og-overlay-blur)",
        WebkitBackdropFilter: "var(--og-overlay-blur)",
        // 「从球所在的方位滴落铺开 / 收拢回去」：origin = 球心相对**视觉块**的坐标
        transformOrigin: origin
          ? `${origin.x - PANEL_PAD}px ${origin.y - PANEL_PAD}px`
          : "50% 100%",
        transition:
          `transform ${goMs}ms ${goEase}, opacity ${goMs}ms ${goEase}, border-radius ${goMs}ms ${goEase}`,
        transform: fromBallish ? ORB_BALLISH.transform : undefined,
        opacity: fromBallish ? ORB_BALLISH.opacity : undefined,
        pointerEvents: goOut ? "none" : "auto",
      }}
    >
        {/* 顶部把手（用户口径 2026-10-11：内外悬浮窗最上面都要有个 handle，上下拖可拉长拉短）：
            36×5 圆角条、按下提亮；竖直拖动 → overlay_set_panel_height（Rust 侧夹 30%~80% 屏高并落盘）。
            把手自己的按压被 stopPropagation + 手势桥闸门挡住，不会误触发拖窗。 */}
        <div
          role="separator"
          aria-label={i18n("auto.components.GlobalOrb.2")}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // h0 = 真实窗口高度（优先 Rust geometry 回传的 h，其次 innerHeight）——不从缓存推
            const realH = winHRef.current > 0
              ? winHRef.current - PANEL_PAD * 2
              : Math.max(120, (typeof window !== "undefined" ? window.innerHeight : 0) - PANEL_PAD * 2);
            handleDrag.current = { id: e.pointerId, screenY0: e.screenY, h0: realH };
            lastPanelH.current = realH;
            logOrb(`handle down：h0=${Math.round(realH)}（来源 ${winHRef.current > 0 ? "geometry.h" : "innerHeight"}）screenY0=${Math.round(e.screenY)}`);
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* 旧内核无指针捕获：拖快了会跟丢，已尽力 */
            }
            setHandleDown(true);
          }}
          onPointerMove={(e) => {
            const d = handleDrag.current;
            if (!d || d.id !== e.pointerId) return;
            const avail = typeof window !== "undefined" ? window.screen.availHeight || window.innerHeight : 800;
            // ⚠️2026-10-11 用户实测「handle 无效」的根因：原来用 clientY 算位移。
            //   面板**底边固定**，窗一变高上边就上移 → clientY 跟着窗一起变 →
            //   h_new = C − h_old 这种负反馈，拖起来只在两个高度之间抖，看起来就是没用。
            //   改用 **screenY**（指针的屏幕坐标，与窗自身移动无关）。
            const dy = e.screenY - d.screenY0;
            const next = Math.max(
              avail * PANEL_MIN_RATIO,
              Math.min(avail * PANEL_MAX_RATIO, d.h0 - dy), // 向上拖（dy<0）= 变高
            );
            logOrb(`handle move：dy=${Math.round(dy)} h0=${Math.round(d.h0)} → next=${Math.round(next)}`);
            if (Math.abs(next - lastPanelH.current) < 2) return;
            lastPanelH.current = next;
            void applyPanelHeight(next);
          }}
          onPointerUp={() => {
            if (handleDrag.current) logOrb(`handle up：panel_h=${Math.round(lastPanelH.current)}（Rust 已落盘）`);
            handleDrag.current = null;
            setHandleDown(false);
          }}
          onPointerCancel={() => {
            handleDrag.current = null;
            setHandleDown(false);
          }}
          style={{
            position: "relative", zIndex: 3,
            marginInline: "auto", marginBottom: "var(--og-space-1)",
            paddingBlock: "var(--og-space-1)", // 上下命中区（旧 5px 同量级）
            cursor: "ns-resize", touchAction: "none",
          }}
        >
          <div
            aria-hidden
            style={{
              // 36×5 几何把手（无对应 OG 结构令牌，同 BALL_VISUAL 一样属几何约定）
              width: 36, height: 5, borderRadius: "var(--og-radius-full)", marginInline: "auto",
              background: handleDown
                ? "var(--og-content-2)"
                : "color-mix(in srgb, var(--og-content-2) 55%, transparent)",
              transition: `background var(--og-dur-1) var(--og-ease-standard)`,
            }}
          />
        </div>
        {/* 顶栏**只留三个动作**（用户口径 2026-10-11）：回到 OneTHU / 自动朗读 / 收起
            ——「本次关闭悬浮球」已删（收进本体，浮层不再自带注销开关）。 */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--og-space-2)", marginBottom: "var(--og-space-2)" }}>
          {/* dev-explorer：搜索 | OH 二合一开关（OG Segment：radiogroup + 方向键可达；
              默认动作在铺开时已按偏好落位） */}
          <Segment
            size="sm"
            options={[
              { value: "search", label: i18n("auto.components.GlobalOrb.p1") },
              { value: "oh", label: "OH" },
            ]}
            value={omode}
            onChange={(v) => setOmode(v as "search" | "oh")}
          />
          <div style={{ display: "flex", flex: "none", alignItems: "center", gap: "var(--og-space-1)" }}>
            <Btn size="sm" variant="outline" tone="quiet" onClick={backToApp}>{i18n("auto.components.GlobalOrb.3")}</Btn>
            <Btn size="sm" variant="outline" tone="quiet" selected={prefs.autoSpeak} onClick={() => setVoicePrefs({ autoSpeak: !prefs.autoSpeak })}>
              {prefs.autoSpeak ? "自动朗读 · 开" : "自动朗读"}
            </Btn>
            <Btn size="sm" variant="outline" tone="quiet" onClick={collapseToBall}>{i18n("auto.components.GlobalOrb.4")}</Btn>
          </div>
        </div>

      {omode === "search" ? (
        /* ── dev-explorer：搜索形态（同窗切换；跳转经 Tauri 事件递主窗口 openTab 后回到 OneTHU） ──
           直接压在玻璃上的正文统一走 textShadow（OG 无字面阴影令牌，颜色引用 --og-scrim，
           浅深两套 scheme 都是墨色雾，子树文字级联继承）。 */
        <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--og-space-2)", textShadow: "0 1px 6px var(--og-scrim)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--og-space-2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Input
                autoFocus
                size="sm"
                value={oquery}
                onChange={setOquery}
                placeholder={i18n("auto.components.GlobalOrb.5")}
                aria-label={i18n("auto.components.GlobalOrb.6")}
              />
            </div>
            {oquery ? (
              <Btn size="sm" variant="ghost" tone="quiet" onClick={() => setOquery("")}>{i18n("auto.components.GlobalOrb.7")}</Btn>
            ) : null}
          </div>
          {!oquery.trim() ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--og-space-2)", overflowY: "auto" }}>
              {ohist.length === 0 ? (
                <Text slot="label" tone="faint" as="span">{i18n("auto.components.GlobalOrb.8")}</Text>
              ) : ohist.map((h: SearchJump, i: number) => (
                <span
                  key={`${h.at}-${i}`}
                  title={`${h.title}（${h.query}）`}
                  style={{ maxWidth: "var(--og-ctl-tab-max-w)", minWidth: 0 }}
                >
                  <Chip
                    size="sm"
                    className="og-truncate"
                    onClick={() => { jumpTabPayload(h.page, h.params, h.title, h.query); backToApp(); }}
                  >
                    {h.title || h.query}
                  </Chip>
                </span>
              ))}
            </div>
          ) : !oresult ? (
            <Text slot="label" tone="faint" as="p">{i18n("auto.components.GlobalOrb.9")}</Text>
          ) : ototal === 0 ? (
            <Btn
              block
              variant="outline"
              tone="quiet"
              onClick={() => {
                const q = oquery.trim();
                setOmode("oh"); // 丝滑切换开关：留在同一扇窗里到 OH 对话页
                setOquery("");
                if (q) void send(q);
              }}
            >
              {i18n("auto.components.GlobalOrb.10")}{oquery.trim()}{i18n("auto.components.GlobalOrb.11")}</Btn>
          ) : (
            <div className="ohx-orb-results">
              {oresult.rows.map((x) => (
                <Row
                  key={"row:" + x.row.id}
                  size="sm"
                  compact
                  title={x.row.title}
                  sub={displayBreadcrumb(x.row).join(" → ")}
                  onClick={() => { jumpSearchRow(x.row, oquery.trim()); backToApp(); }}
                />
              ))}
              {oresult.entries.map((en) => (
                <Row
                  key={"n:" + en.id}
                  size="sm"
                  compact
                  title={en.name}
                  sub={en.note ?? en.category}
                  trailing={<Text slot="micro" tone="faint">{i18n("auto.components.GlobalOrb.12")}</Text>}
                  onClick={() => { jumpEntry(en.id, en.page, en.params ?? null, en.name, oquery.trim()); backToApp(); }}
                />
              ))}
              {oresult.atoms.map((a) => (
                <Row
                  key={"a:" + a.kind + "|" + a.key}
                  size="sm"
                  compact
                  title={a.title}
                  sub={(a.group ? a.group + " · " : "") + (a.sub ?? "")}
                  trailing={<Text slot="micro" tone="faint">{i18n("auto.components.GlobalOrb.13")}</Text>}
                  onClick={() => { jumpAtom(a.kind, a.key, a.title, oquery.trim()); backToApp(); }}
                />
              ))}
              {oresult.tabs.map((t) => (
                <Row
                  key={"t:" + t}
                  size="sm"
                  compact
                  title={"设置 · " + t}
                  trailing={<Text slot="micro" tone="faint">{i18n("auto.components.GlobalOrb.14")}</Text>}
                  onClick={() => { jumpSettingsTab(t); backToApp(); }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      <div ref={scroller} style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--og-space-4)", paddingRight: "var(--og-geo-xs)", textShadow: "0 1px 6px var(--og-scrim)" }}>
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: m.role === "user" ? "84%" : "94%",
              textAlign: m.role === "user" ? "right" : "left",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}
          >
            {/* 直压玻璃的正文走 OG Text 字阶（subtitle 替旧 15px 自由值）；自己说的降一档
                字色（旧 opacity .62 的"雾里半字"改成 content-2 语义档），不碰透明度。 */}
            <Text as="div" slot="subtitle" tone={m.role === "user" ? "quiet" : "default"}>
              {m.role === "oh" ? (
                <div className="dock-md">
                  <Markdown remarkPlugins={[remarkGfm]} components={{ img: MdImage, a: MdLink }}>
                    {m.text}
                  </Markdown>
                </div>
              ) : (
                m.text
              )}
            </Text>
          </div>
        ))}
        {typing ? (
          <div style={{ alignSelf: "flex-start", letterSpacing: 2 }}>
            <Text slot="body" tone="faint" as="div">···</Text>
          </div>
        ) : null}
      </div>

      {/* 需求 6：附件入口就在悬浮球打开后的这个位置（拍照 / 相册 / 上传，单张图片可先修一下再发） */}
      <div style={{ position: "relative", zIndex: 1, marginTop: "var(--og-space-2)" }}>
        <AttachTray
          onPicked={async (files: AttachFile[]) => {
            const summary = files.map((f) => `${f.name}（${formatSize(f.size)}）`).join("、");
            setMsgs((m) => [...m, { role: "user", text: `［附件］${summary}` }]);
            scrollToEnd();
            setSheetFiles(files); // 需求 7：拿到附件就先给动作选择（转存云盘 / 交作业 / 发讨论区）
          }}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "var(--og-space-2)", marginTop: "var(--og-space-3)" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={input}
            onChange={setInput}
            onFocusChange={(on) => { if (on) setTyping(false); }}
            placeholder={i18n("auto.components.GlobalOrb.15")}
          />
        </div>
      </form>
      </>
      )}
      {sheetFiles ? (
        <AttachActionsSheet
          files={sheetFiles}
          onClose={() => setSheetFiles(null)}
          onDone={(d) => {
            const r = (d as { result?: { ok?: boolean; path?: string; error?: string } })?.result;
            setMsgs((m) => [...m, {
              role: "oh",
              text: r?.ok ? `已处理附件${r.path ? `：${r.path}` : ""}` : `附件动作未完成${r?.error ? `：${r.error}` : ""}`,
            }]);
            setSheetFiles(null);
            scrollToEnd();
          }}
        />
      ) : null}
      </div>
  );
});
