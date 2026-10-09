/**
 * 语音唤醒悬浮球（Android）：右侧悬浮小圆球。
 * - 呼吸态 = KWS 监听中（你好小欧 / 小欧小欧）
 * - 唤醒命中 → 悬浮球展开为语音会话卡（状态 + 实时转写），识别完自动经
 *   ohAsk() 打开 ChatDock 并发送（seq 去重，与搜索页「问 OH」同一通道）
 * - 交互：点击球 = 开监听 / 监听中点球开对话；长按球 = 开关监听
 * 状态真源在 Kotlin VoiceHub；TS 只订阅事件（onethu-voice://wake|state）。
 */
import {
  memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent,
} from "react";
import { markVoiceState, onVoiceState, onWake, wakeStart, wakeStop, wakeSupported } from "../lib/wake.js";
import { speechAvailable, speechPoll, speechStart, speechStop } from "../lib/speech.js";
import { ohAsk } from "../plugins/ChatDock.js";

type Phase = "idle" | "listening" | "recognizing" | "sending" | "error";

/** 识别静默判定：转写稳定 1.4s 视为说完整句 */
const SILENCE_MS = 1_400;
/** 会话总上限（防止环境噪音下挂着不停） */
const MAX_SESSION_MS = 12_000;
/** 松口后等识别器吐最终结果的宽限（与 ChatDock 手动语音同值） */
const FINAL_GRACE_MS = 320;

export const FloatingOrb = memo(function FloatingOrb(): React.ReactNode | null {
  const [phase, setPhase] = useState<Phase>("idle");
  const [supported, setSupported] = useState(false);
  const [text, setText] = useState("");
  const [fail, setFail] = useState<string | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const holdTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);

  const setPhaseSafe = (p: Phase): void => {
    phaseRef.current = p;
    setPhase(p);
  };

  // 挂载：探测支持 + 订阅事件；支持则默认开启监听（首版自动开，设置项后补）
  useEffect(() => {
    let unWake: (() => void) | null = null;
    let unState: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      const ok = await wakeSupported();
      if (disposed || !ok) return;
      setSupported(true);
      unWake = await onWake(() => void startWakeSession());
      unState = await onVoiceState((e) => {
        if (e.to === "LISTENING") setPhaseSafe("listening");
        else if (e.to === "IDLE") setPhaseSafe("idle");
        else if (e.to === "SPEAKING") setPhaseSafe("sending"); // 朗读中：KWS 暂停，不显示监听呼吸
      });
      // 前台服务由用户动作拉起（Android while-in-use 限制）——首次需用户点一下球
    })();
    return () => {
      disposed = true;
      unWake?.();
      unState?.();
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 唤醒命中 → 自动语音会话：识别 → 静默收口 → ohAsk 自动发送 */
  const startWakeSession = async (): Promise<void> => {
    if (phaseRef.current === "recognizing" || phaseRef.current === "sending") return;
    if (!(await speechAvailable())) {
      setFail("此设备无可用语音识别（ROM 未提供识别服务）");
      markVoiceState("error");
      window.setTimeout(() => setFail(null), 2_600);
      return;
    }
    setPhaseSafe("recognizing");
    setText("");
    markVoiceState("recognizing");
    try {
      await speechStart();
    } catch (e) {
      setFail(`识别启动失败：${e instanceof Error ? e.message : String(e)}`);
      markVoiceState("error");
      setPhaseSafe("listening");
      return;
    }
    const startedAt = Date.now();
    let lastText = "";
    let lastChangeAt = Date.now();
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = window.setInterval(() => {
      if (phaseRef.current !== "recognizing") return;
      void speechPoll().then((t) => {
        if (t !== lastText) {
          lastText = t;
          lastChangeAt = Date.now();
          setText(t);
        }
        const stable = lastText.length > 0 && Date.now() - lastChangeAt > SILENCE_MS;
        const tooLong = Date.now() - startedAt > MAX_SESSION_MS;
        if (stable || tooLong) finishSession();
      });
    }, 180);
  };

  /** 收口：停识别 → 取 final → 自动发送（经 ohAsk 开面板+发）→ 恢复监听 */
  const finishSession = (): void => {
    if (phaseRef.current !== "recognizing") return;
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setPhaseSafe("sending");
    markVoiceState("processing");
    speechStop();
    void (async () => {
      await new Promise((r) => setTimeout(r, FINAL_GRACE_MS));
      const final = (await speechPoll()).trim();
      setText(final);
      if (final) ohAsk(final); // ChatDock 自动打开 + 发送（无 TTS 阶段，直接 done）
      markVoiceState("done");
      setPhaseSafe("listening");
      window.setTimeout(() => setText(""), 1_200);
    })();
  };

  // 长按开关监听 / 点击开监听或对话
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      void toggleListening();
    }, 450);
  };
  const onPointerUp = (): void => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
      void onOrbTap();
    }
  };
  const onPointerCancel = (): void => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const toggleListening = async (): Promise<void> => {
    if (phase === "listening") {
      await wakeStop().catch(() => undefined);
      setPhaseSafe("idle");
    } else if (phase === "idle") {
      await enableListening();
    }
  };

  const enableListening = async (): Promise<void> => {
    try {
      await wakeStart(); // 首次：mic 权限弹窗（需前台，正是用户点击时）
      setPhaseSafe("listening");
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
      window.setTimeout(() => setFail(null), 2_600);
    }
  };

  const onOrbTap = async (): Promise<void> => {
    if (phase === "idle") {
      await enableListening();
      return;
    }
    // 监听中点球：打开对话面板（经 ohAsk 空文本不会发送——直接开面板需事件，简化为无操作提示）
    setFail("说「你好小欧」唤醒语音；长按可停止监听");
    window.setTimeout(() => setFail(null), 2_600);
  };

  if (!supported) return null;

  const listening = phase === "listening" || phase === "recognizing" || phase === "sending";
  const expanded = phase === "recognizing" || phase === "sending";

  const orbStyle: CSSProperties = {
    position: "fixed",
    right: 0,
    top: "56%",
    width: 48,
    height: 48,
    borderRadius: "50%",
    zIndex: 80,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    fontWeight: 700,
    userSelect: "none",
    cursor: "pointer",
    touchAction: "none",
    background: listening ? "var(--dsw-alias-brand-primary, #15f)" : "rgba(20,22,26,.42)",
    color: "#fff",
    boxShadow: listening ? "0 0 0 4px rgba(59,130,246,.18)" : "0 2px 10px rgba(0,0,0,.22)",
    backdropFilter: "blur(6px)",
    borderRight: "none",
    animation: phase === "listening" ? "voice-orb-breathe 2.6s ease-in-out infinite" : undefined,
    transition: "background .25s, box-shadow .25s",
  };

  return (
    <>
      <style>{`@keyframes voice-orb-breathe{0%,100%{box-shadow:0 0 0 3px rgba(59,130,246,.14)}50%{box-shadow:0 0 0 9px rgba(59,130,246,.30)}}`}</style>
      <div
        style={orbStyle}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        role="button"
        aria-label={listening ? "语音监听中，长按停止" : "点击开启语音唤醒监听"}
      >
        OH
      </div>
      {expanded ? (
        <div
          style={{
            position: "fixed",
            right: 8,
            top: "44%",
            width: 232,
            zIndex: 81,
            padding: "12px 14px",
            borderRadius: 14,
            background: "rgba(255,255,255,.92)",
            color: "#1c1f24",
            boxShadow: "0 8px 30px rgba(0,0,0,.18)",
            backdropFilter: "blur(8px)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: "#f59e0b", display: "inline-block" }} />
            {phase === "recognizing" ? "在听，请讲…" : "已听到，发送中"}
          </div>
          <div style={{ minHeight: 40, opacity: text ? 1 : 0.55 }}>
            {text || "（等待语音…说完稍停即自动发送）"}
          </div>
        </div>
      ) : null}
      {fail ? (
        <div
          style={{
            position: "fixed",
            right: 60,
            top: "57%",
            zIndex: 82,
            maxWidth: 200,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(20,22,26,.86)",
            color: "#fff",
            fontSize: 12.5,
          }}
        >
          {fail}
        </div>
      ) : null}
    </>
  );
});
