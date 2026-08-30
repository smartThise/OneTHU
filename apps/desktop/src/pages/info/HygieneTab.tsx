/**
 * 卫生成绩 —— info.getDormScore（thu-info-app dormScore.tsx 移植）。
 * 家园网宿舍卫生检查成绩单（base64 图片，可缩放）；null = 暂无检查数据。
 * 空数据/维护态铁律见 tabStates.tsx；绝不自动整页刷新。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, TabError, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready" | "none";

/** core getDormScore 返回图片字节 base64（无 data: 前缀）→ dataURL */
function toImageSrc(raw: string): string {
  if (raw.startsWith("data:") || raw.startsWith("http:") || raw.startsWith("https:")) return raw;
  return `data:image/png;base64,${raw}`;
}

export function HygieneTab() {
  const { status } = useApp();
  const [image, setImage] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    try {
      const raw = await info.getDormScore();
      if (raw === null) {
        setImage(null);
        setState("none"); // 暂无卫生检查数据：友好空态，绝非错误
      } else {
        setImage(toImageSrc(raw));
        setState("ready");
      }
    } catch (err) {
      logTabErr("HYGIENE", err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供卫生成绩数据，登录后可查看宿舍卫生检查成绩。" />;
  }

  return (
    <>
      <SectionHead title="宿舍卫生成绩" aside="家园网 myhome · 卫生检查成绩单" />
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      {state === "loading" ? (
        <SkeletonRows rows={4} />
      ) : state === "none" ? (
        <TabEmpty text="暂无卫生检查记录（本学期尚未开始检查）。" />
      ) : image ? (
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
              src={image}
              alt="宿舍卫生检查成绩单"
              style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom === 1 ? "100%" : "none", display: "block", borderRadius: 8 }}
            />
          </Card>
        </>
      ) : null}
    </>
  );
}
