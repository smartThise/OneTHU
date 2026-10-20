import { Btn, Chip, Inline, Row, Sheet, Stack, Surface, Text } from "@onethu/gui";
/**
 * 图片滤镜编辑（需求 8）：预设缩略图横排 + 旋转 + 应用/取消。
 *
 * 交互与性能取舍：
 *  - 预览只跑 ≤720px（`PREVIEW_EDGE`）：切预设、点旋转都要即时，像素循环按这个尺寸
 *    只要几十毫秒；点「应用」时才按 ≤2000px 出成图（`MAX_EDGE`），手机原图也能收得住。
 *  - 缩略图五张各 ≤72px，随旋转一起重算，让横排上的图跟着转，避免「缩略图和预览两个朝向」。
 *  - 滤镜是同步像素运算：点应用前先让「处理中」渲染一帧（await 一个宏任务），
 *    否则大图那几百毫秒会把按钮的忙碌态一起卡住，用户以为没反应。
 *  - 组件自包含（自带样式、portal 到 body），宿主只需要给图源与两个回调。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  FILTER_PRESETS, MAX_EDGE, PREVIEW_EDGE, applyFilter, applyFilterToCanvas, canvasToDataUrl,
  drawToCanvas, loadImageSource, releaseImage,
  type FilterPreset, type ImageSource, type RotationDeg,
} from "../lib/imageFilters.js";
import { extForMime } from "../lib/attach.js";
import { IconRefresh } from "./Icons.js";
import { t as i18n } from "../i18n/index.js";


export interface FilterResult {
  /** 处理后的图（dataURL，默认 JPEG q0.88） */
  dataUrl: string;
  preset: FilterPreset;
  rotate: RotationDeg;
  width: number;
  height: number;
  /** 建议文件名（含预设/旋转后缀与正确扩展名） */
  name: string;
}

export interface ImageFilterSheetProps {
  /** 原图：File / Blob / dataURL / objectURL / 已解码画源 */
  src: Blob | string | ImageSource;
  /** 建议文件名（应用后按它命名） */
  fileName?: string;
  onApply: (r: FilterResult) => void;
  /** 取消：宿主什么都别发（诚实的「没选」） */
  onCancel: () => void;
  /** 成图长边上限（默认 2000） */
  maxEdge?: number;
  /** 成图 MIME（默认 image/jpeg） */
  mime?: string;
  quality?: number;
  title?: string;
}

const ROTATIONS: RotationDeg[] = [0, 90, 180, 270];

function msgOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "这一步没做完，请重试";
}

function outputName(base: string | undefined, preset: FilterPreset, rotate: RotationDeg, mime: string): string {
  const raw = (base || "图片").replace(/\.[^.]*$/, "");
  const suffix = `${preset === "original" ? "" : `-${preset}`}${rotate ? `-r${rotate}` : ""}`;
  return `${raw}${suffix}.${extForMime(mime)}`;
}


export function ImageFilterSheet(props: ImageFilterSheetProps): ReactNode {
  const {
    src, fileName, onApply, onCancel, maxEdge = MAX_EDGE, mime = "image/jpeg", quality = 0.88,
    title = "编辑图片",
  } = props;
  const [preset, setPreset] = useState<FilterPreset>("original");
  const [rotate, setRotate] = useState<RotationDeg>(0);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState("");
  const [thumbs, setThumbs] = useState<Array<{ id: FilterPreset; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sourceRef = useRef<ImageSource | null>(null);

  /* ① 装载原图（一次；卸载时把位图内存还回去） */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const img = await loadImageSource(src);
        if (!alive) {
          releaseImage(img);
          return;
        }
        sourceRef.current = img;
        setLoaded(true);
      } catch (e) {
        if (alive) setErr(msgOf(e));
      }
    })();
    return () => {
      alive = false;
      releaseImage(sourceRef.current);
      sourceRef.current = null;
    };
  }, [src]);

  /* ② 旋转 / 预设变化 → 缩略图与预览（预览尺寸，别跑原图） */
  useEffect(() => {
    const img = sourceRef.current;
    if (!img) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      try {
        const base = drawToCanvas(img, { maxEdge: PREVIEW_EDGE, rotate });
        setThumbs(FILTER_PRESETS.map((p) => ({ id: p.id, url: applyFilter(base, p.id, { maxEdge: PREVIEW_EDGE }) })));
        setPreview(applyFilter(base, preset, { maxEdge: PREVIEW_EDGE }));
        setErr("");
      } catch (e) {
        setErr(msgOf(e));
      }
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [preset, rotate, loaded]);

  /* ③ Esc 退出（不发送任何东西） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  /** 应用：按全尺寸出图（同步运算，先让忙碌态渲染一帧） */
  const doApply = useCallback(async (): Promise<void> => {
    const img = sourceRef.current;
    if (!img || busy) return;
    setBusy(true);
    setErr("");
    await new Promise((r) => window.setTimeout(r, 16));
    try {
      const full = drawToCanvas(img, { maxEdge, rotate });
      applyFilterToCanvas(full, preset);
      const dataUrl = canvasToDataUrl(full, mime, quality);
      onApply({
        dataUrl,
        preset,
        rotate,
        width: full.width,
        height: full.height,
        name: outputName(fileName, preset, rotate, mime),
      });
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  }, [busy, fileName, maxEdge, mime, onApply, preset, quality, rotate]);

  const info = FILTER_PRESETS.find((p) => p.id === preset);
  const dirty = preset !== "original" || rotate !== 0;
  const note = err
    ? err
    : !loaded
      ? "正在读取图片…"
      : busy
        ? "正在生成，请稍候…"
        : `${info?.hint ?? ""}${rotate ? ` · 已旋转 ${rotate}°` : ""}${dirty ? "" : " · 未改动"}`;

  if (typeof document === "undefined") return null;

  return createPortal(
    <Sheet
      open
      onClose={onCancel}
      title={title}
      maskClose
      className="ohf-panel"
      scope="imageFilter.sheet"
    >
      <Stack gap={3}>
        <Surface level={2} radius="md" pad="sm" className="ohf-stage">
          {preview ? <img src={preview} alt={i18n("auto.components.ImageFilterSheet.1")} /> : <Text slot="label" tone="faint">{i18n("auto.components.ImageFilterSheet.2")}</Text>}
        </Surface>

        <div role="group" aria-label={i18n("auto.components.ImageFilterSheet.3")}>
        <Inline gap={2} wrap>
          {thumbs.map((t) => {
            const meta = FILTER_PRESETS.find((f) => f.id === t.id);
            return (
              <Chip
                key={t.id}
                selected={t.id === preset}
                onClick={() => setPreset(t.id)}
                icon={<img src={t.url} alt={meta?.label ?? t.id} width={56} height={56} style={{ borderRadius: "var(--og-radius-xs)", objectFit: "cover" as const }} />}
              >
                {meta?.label ?? t.id}
              </Chip>
            );
          })}
        </Inline>
        </div>

        <Row
          leading={<Btn variant="outline" size="sm" onClick={() => setRotate((r) => ROTATIONS[(ROTATIONS.indexOf(r) + 1) % ROTATIONS.length] ?? 0)}>{i18n("auto.components.ImageFilterSheet.4")}</Btn>}
          title={<Text slot="label" tone="faint">{note}</Text>}
        />
      </Stack>

      <Inline gap={2} justify="end" className="ohf-foot">
        <Btn variant="outline" onClick={onCancel} disabled={busy}>{i18n("auto.components.ImageFilterSheet.5")}</Btn>
        <Btn variant="solid" tone="brand" onClick={() => void doApply()} disabled={!loaded || busy || !!err}>{busy ? "处理中…" : "应用"}</Btn>
      </Inline>
    </Sheet>,
    document.body,
  );
}
