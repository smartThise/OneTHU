import { Btn } from "@onethu/gui";
import { Select } from "@onethu/gui";
/**
 * 设置页「语音合成」区块（需求 4）——用户要的两件事在这里落地：
 *   ① 静音 / 自动播放二选一：开关「自动朗读 OH 的回复」，**默认关（静音）**；
 *   ② 音色与音效调节：音色下拉（系统引擎的中文嗓音）+ 语速/音高滑杆 + 试听，改完当场能听见。
 *
 * 挂载方式与兄弟区块完全一致（不要自带 Card/SectionHead，否则套两层卡片）：
 *   <SectionHead title="语音" />
 *   <Card><VoiceSettingsSection /></Card>
 *
 * 平台口径：只有 Android 有承载（系统 TextToSpeech）。桌面端**不摆假开关**——照旧显示区块，
 * 但明确写「当前平台不支持」，滑杆与试听一并禁用（与 WidgetSettingsSection 同一套诚实降级）。
 *
 * 滑杆写盘时机：拖动过程只更新本地显示，松手（pointerup/keyup/blur）才落偏好——否则一次拖动
 * 会往 localStorage 写几十次、并让订阅了偏好的聊天坞跟着重渲染。
 */
import { defineSearchRows } from "../state/searchRows.js";
import { goOhRow } from "./OhSettingsPage.js";
import { useEffect, useState, type ReactNode } from "react";
import { Switch } from "./Layout.js";
import {
  PITCH_MAX, PITCH_MIN, RATE_MAX, RATE_MIN,
  resetVoicePrefs, setVoicePrefs, useVoicePrefs,
} from "../state/voicePrefs.js";
import {
  lastTtsError, onTtsDone, previewSpeak, prettyVoiceName,
  ttsPrepare, ttsSetBackend, ttsStatus, ttsStop, ttsVoices,
  type TtsStatus,
} from "../lib/tts.js";
import { t as i18n } from "../i18n/index.js";


/** 试听用的固定句子：能同时听出音色与语速差异，又不长到烦人 */
const PREVIEW_TEXT = "你好，我是 OH。现在用的就是这个音色、这个语速。";

/** 引擎状态 →（标题，说明）人话。null = 还没读到 */
function engineCopy(st: TtsStatus | null, busy: boolean): { title: string; desc: string } {
  if (st === null) {
    return busy
      ? { title: i18n("auto.components.VoiceSettingsSection.p1"), desc: i18n("auto.components.VoiceSettingsSection.p2") }
      : { title: i18n("auto.components.VoiceSettingsSection.p3"), desc: "" };
  }
  switch (st.state) {
    case "unsupported":
      return {
        title: i18n("auto.components.VoiceSettingsSection.p4"),
        desc: i18n("auto.components.VoiceSettingsSection.p5"),
      };
    case "initializing":
      return { title: i18n("auto.components.VoiceSettingsSection.p6"), desc: i18n("auto.components.VoiceSettingsSection.p7") };
    case "ready":
      return {
        title: i18n("auto.components.VoiceSettingsSection.p8"),
        desc: (st.engine ? `本机使用的引擎：${st.engine}` : "本机系统引擎可用。") + (st.note ? `（${st.note}）` : ""),
      };
    case "speaking":
      return { title: i18n("auto.components.VoiceSettingsSection.p9"), desc: st.engine ? `本机使用的引擎：${st.engine}` : "说完会自动停下。" };
    case "error":
      return {
        title: i18n("auto.components.VoiceSettingsSection.p10"),
        desc: `${st.reason ?? "系统没有可用的文字转语音引擎"}。可在系统设置 → 无障碍/语言 → 文字转语音 里安装或启用引擎与中文语音数据，再回来点「重新检查」。`,
      };
    default:
      return { title: i18n("auto.components.VoiceSettingsSection.p11"), desc: i18n("auto.components.VoiceSettingsSection.p12") };
  }
}


/* task-19/22：语音合成设置行注册。go 走 goOhRow（切基础档 + 行滚动高亮；引擎行标题是动态的 → 已在 JSX 里钉 data-set-id="row-引擎状态"） */
defineSearchRows([
  { id: "voice-engine", tab: "OneTHU Harness", section: "语音", title: "引擎状态", aliases: ["语音引擎", "重新检查", "试听"], desc: "当前平台是否支持语音合成 / 重新检查" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "引擎状态"], displayRoot: "设置", go: () => goOhRow("引擎状态", "basic") },
  { id: "voice-tone", tab: "OneTHU Harness", section: "语音", title: "音色", aliases: ["嗓音", "普通话"], desc: "系统引擎报出的可选嗓音" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "音色"], displayRoot: "设置", go: () => goOhRow("音色", "basic") },
  { id: "voice-rate", tab: "OneTHU Harness", section: "语音", title: "语速", aliases: ["速度"], desc: "朗读快慢" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "语速"], displayRoot: "设置", go: () => goOhRow("语速", "basic") },
  { id: "voice-pitch", tab: "OneTHU Harness", section: "语音", title: "音高", aliases: ["音调"], desc: "朗读高低" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "语音", "音高"], displayRoot: "设置", go: () => goOhRow("音高", "basic") },
]);

export function VoiceSettingsSection(): ReactNode {
  const prefs = useVoicePrefs();
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [voices, setVoices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** 拖动中只动本地显示，松手才落偏好 */
  const [dragging, setDragging] = useState<"rate" | "pitch" | null>(null);
  const [dragValue, setDragValue] = useState(1);

  const ready = status?.ready === true;
  const usable = status !== null && status.state !== "unsupported" && status.state !== "error";

  /** 检查/初始化引擎，并就绪后拉一次音色表 */
  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const st = await ttsPrepare();
      setStatus(st);
      setVoices(st.ready ? await ttsVoices() : []);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void (async () => {
      // 后端自愈：神经档本期没有实现，偏好里留着它只会卡在一个用不了的档位上
      if (prefs.backend !== "system") {
        void ttsSetBackend("system");
        setVoicePrefs({ backend: "system" });
      }
      await refresh();
    })();
    // 只在挂载时跑一次：prefs 的改动由下面的控件自己负责同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 原生念完/出错 → 状态从「正在朗读」回到就绪
  useEffect(() => {
    let alive = true;
    let off: (() => void) | null = null;
    void onTtsDone((reason) => {
      setSpeaking(false);
      if (reason.startsWith("error")) {
        setMsg(`朗读出错（${reason}）`);
        void ttsStatus().then(setStatus);
      }
    }).then((f) => {
      if (alive) off = f;
      else f();
    });
    return () => {
      alive = false;
      if (off) off();
    };
  }, []);

  const commitSlider = (): void => {
    if (dragging === "rate") setVoicePrefs({ rate: dragValue });
    else if (dragging === "pitch") setVoicePrefs({ pitch: dragValue });
    setDragging(null);
  };

  const shownRate = dragging === "rate" ? dragValue : prefs.rate;
  const shownPitch = dragging === "pitch" ? dragValue : prefs.pitch;

  const preview = async (): Promise<void> => {
    setMsg(null);
    if (speaking) {
      await ttsStop();
      setSpeaking(false);
      return;
    }
    const ok = await previewSpeak(PREVIEW_TEXT);
    if (ok) setSpeaking(true);
    else setMsg(`试听失败：${lastTtsError() ?? "引擎未就绪"}`);
  };

  const copy = engineCopy(status, busy);

  return (
    <>
      {/* 「自动朗读 OH 的回复」开关已按用户要求**删除**（2026-10-11）：
          自动朗读只在对话面板/悬浮窗顶部的「朗读 开/关」按钮上管，设置里不再出现第二处开关。 */}
      {/* ② 引擎状态：长说明行按「正常设置行」排版（is-copy：文字列吃满宽、按钮与首行同基线） */}
      {/* task-22 检索直达：这行标题是动态的（配音面状态文案），注册表按「引擎状态」检索——显式钉 id，保证落点唯一 */}
      <div className="setting-row is-copy" data-set-id="row-引擎状态">
        <div>
          <div className="setting-title">{copy.title}</div>
          <div className="setting-desc">
            {copy.desc}
            {ready && voices.length > 0 ? (
              <span style={{ color: "var(--text-3)" }}>　{i18n("auto.components.VoiceSettingsSection.1")}{voices.length} {i18n("auto.components.VoiceSettingsSection.2")}</span>
            ) : null}
          </div>
        </div>
        <Btn variant="ghost" disabled={busy} onClick={() => void refresh()}>{busy ? "检查中…" : "重新检查"}</Btn>
      </div>

      {/* ③ 音色 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.VoiceSettingsSection.3")}</div>
          <div className="setting-desc">
            {voices.length === 0
              ? "系统引擎没有报出可选的普通话嗓音，用引擎默认音色朗读。"
              : "不同 ROM 自带的嗓音不同（如小艺、小爱、Google 的普通话嗓音）。"}
          </div>
        </div>
        <Select aria-label={i18n("auto.components.VoiceSettingsSection.3")} disabled={voices.length === 0 || !usable} value={prefs.voiceName} onChange={(value) => setVoicePrefs({ voiceName: value })}><option value="">{i18n("auto.components.VoiceSettingsSection.4")}</option>{voices.map((v) => (
            <option key={v} value={v}>
              {prettyVoiceName(v)}
            </option>
          ))}</Select>
      </div>

      {/* ④ 语速 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.VoiceSettingsSection.5")}</div>
          <div className="setting-desc">{i18n("auto.components.VoiceSettingsSection.6")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", minWidth: 44, textAlign: "right" }}>
            {shownRate.toFixed(2)}×
          </span>
          <input
            type="range"
            aria-label={i18n("auto.components.VoiceSettingsSection.5")}
            min={RATE_MIN}
            max={RATE_MAX}
            step={0.05}
            disabled={!usable}
            value={shownRate}
            style={{ width: 168, accentColor: "var(--accent)" }}
            onChange={(e) => {
              setDragging("rate");
              setDragValue(Number(e.target.value));
            }}
            onPointerUp={commitSlider}
            onPointerCancel={commitSlider}
            onMouseUp={commitSlider}
            onTouchEnd={commitSlider}
            onKeyUp={commitSlider}
            onBlur={commitSlider}
          />
          <Btn variant="ghost" disabled={prefs.rate === 1} onClick={() => setVoicePrefs({ rate: 1 })}>{i18n("auto.components.VoiceSettingsSection.7")}</Btn>
        </div>
      </div>

      {/* ⑤ 音高 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.VoiceSettingsSection.8")}</div>
          <div className="setting-desc">{i18n("auto.components.VoiceSettingsSection.9")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", minWidth: 44, textAlign: "right" }}>
            {shownPitch.toFixed(2)}
          </span>
          <input
            type="range"
            aria-label={i18n("auto.components.VoiceSettingsSection.8")}
            min={PITCH_MIN}
            max={PITCH_MAX}
            step={0.05}
            disabled={!usable}
            value={shownPitch}
            style={{ width: 168, accentColor: "var(--accent)" }}
            onChange={(e) => {
              setDragging("pitch");
              setDragValue(Number(e.target.value));
            }}
            onPointerUp={commitSlider}
            onPointerCancel={commitSlider}
            onMouseUp={commitSlider}
            onTouchEnd={commitSlider}
            onKeyUp={commitSlider}
            onBlur={commitSlider}
          />
          <Btn variant="ghost" disabled={prefs.pitch === 1} onClick={() => setVoicePrefs({ pitch: 1 })}>{i18n("auto.components.VoiceSettingsSection.7")}</Btn>
        </div>
      </div>

      {/* ⑥ 试听 / 停止 */}
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.VoiceSettingsSection.10")}</div>
          <div className="setting-desc">
            {i18n("auto.components.VoiceSettingsSection.11")}<span style={{ color: "var(--text-3)" }}>　{i18n("auto.components.VoiceSettingsSection.12")}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          <Btn variant="outline" disabled={!usable} onClick={() => void preview()}>{speaking ? "停止" : "试听"}</Btn>
          <Btn variant="ghost" titleAttr={i18n("auto.components.VoiceSettingsSection.13")} onClick={() => {
              void ttsStop();
              setSpeaking(false);
              resetVoicePrefs();
              setMsg(i18n("auto.components.VoiceSettingsSection.msg1"));
            }}>{i18n("auto.components.VoiceSettingsSection.14")}</Btn>
        </div>
      </div>

      {msg ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 16px" }}>{msg}</div>
      ) : null}
    </>
  );
}
