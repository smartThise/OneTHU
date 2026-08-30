/**
 * 校历 —— info.getCalendarImageUrl（thu-info-app schoolCalendar.tsx 移植，图片版）。
 * 学年/学期/语言选择 + 图片缩放 +「在浏览器打开原图」（openExternal）。
 * 图片地址为纯拼接（app.cs 公网直连），不抛会话错误；加载失败给友好空态。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SectionHead } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { openExternal } from "./openExternal.js";
import { TabEmpty, isServiceUnavailable, logTabErr, tabErrorText, TabError } from "./tabStates.js";

type Sem = "autumn" | "spring";
type Lang = "zh" | "en";

/** 当前学年（秋季学期起始年份）：7 月起算新学年 */
function currentAcademicYear(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

export function CalendarTab() {
  const { status } = useApp();
  const [year, setYear] = useState<number>(currentAcademicYear);
  const [sem, setSem] = useState<Sem>(currentAcademicYear() === new Date().getFullYear() ? "autumn" : "spring");
  const [lang, setLang] = useState<Lang>("zh");
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [zoom, setZoom] = useState(1);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    setImgError(false);
    try {
      // 纯 URL 拼接（不发请求、不依赖会话）；同步返回，包一层以对齐三态
      setSrc(info.getCalendarImageUrl(year, sem, lang));
      setState("ready");
    } catch (err) {
      logTabErr("CALENDAR", err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status, year, sem, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供校历图片，登录后可查看学校校历。" />;
  }

  const years = Array.from({ length: 5 }, (_, i) => currentAcademicYear() - i);

  return (
    <>
      <SectionHead title="校历" aside="我的清华 · 教学日历图片版" />
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <select className="input" style={{ width: "auto" }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="学年">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}-{y + 1} 学年
            </option>
          ))}
        </select>
        <select className="input" style={{ width: "auto" }} value={sem} onChange={(e) => setSem(e.target.value as Sem)} aria-label="学期">
          <option value="autumn">秋季学期</option>
          <option value="spring">春季学期</option>
        </select>
        <select className="input" style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="语言">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
        {src ? (
          <button className="btn btn-ghost" onClick={() => void openExternal(src)}>
            在浏览器打开原图
          </button>
        ) : null}
      </div>

      {src && !imgError ? (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <button className="btn btn-ghost" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5}>
              −
            </button>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>{Math.round(zoom * 100)}%</span>
            <button className="btn btn-ghost" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} disabled={zoom >= 4}>
              +
            </button>
            <button className="btn btn-ghost" onClick={() => setZoom(1)}>
              重置
            </button>
          </div>
          <Card style={{ overflow: "auto", padding: 12 }}>
            <img
              src={src}
              alt={`${year}-${year + 1} ${sem === "autumn" ? "秋" : "春"}季学期校历`}
              onError={() => setImgError(true)}
              style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom === 1 ? "100%" : "none", display: "block", borderRadius: 8 }}
            />
          </Card>
        </>
      ) : state === "ready" ? (
        <TabEmpty text="校历图片暂时无法加载（可能尚未发布该学期校历），可稍后重试。" />
      ) : null}
    </>
  );
}
