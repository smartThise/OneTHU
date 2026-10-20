import { useEffect, useRef, useState, type ReactNode } from "react";
import { Btn, Inline, Modal, Stack, Text } from "@onethu/gui";
import { fileToBytes, pickFile } from "../lib/attach.js";
import { showToast } from "../state/toast.js";
import type { CardCover, PersonalCard } from "../state/nameCard.js";
import { IdentityCard } from "./IdentityCard.js";
import { t as i18n } from "../i18n/index.js";


/** 卡面压缩上限：dataURL 字符数（约 1.1MB 图），超出逐步降质。 */
const MAX_CHARS = 1_400_000;
const MAX_SIDE = 1600;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 解码成可画到 canvas 的图：优先 createImageBitmap；失败退回 <img>（兼容旧 WebView）。 */
async function decodeImage(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    return bitmap;
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * 按文字所在区域估算用白字还是黑字：
 * 品牌行在上、名字在中下、联系行在最下，各自有不同权重与蒙层深度；
 * 分别算「白字方案」和「黑字方案」的对比度，取更高的那个。
 */
function pickInk(canvas: HTMLCanvasElement): "light" | "dark" {
  const small = document.createElement("canvas");
  small.width = 32;
  small.height = 20;
  const ctx = small.getContext("2d");
  if (!ctx) return "light";
  ctx.drawImage(canvas, 0, 0, 32, 20);
  const px = ctx.getImageData(0, 0, 32, 20).data;
  const rowLum = (y0: number, y1: number): number => {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        sum += (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
        n += 1;
      }
    }
    return n ? sum / n : 0.5;
  };
  /* 先看文字实际压着的区域：名字带（中下）与联系行（底部）。
     - 任一文字带很暗 → 必须白字（否则就是「黑底黑字」）；
     - 名字带和底部都亮 → 黑字。
     两者之间再按对比度加权细算。 */
  const nameLum = rowLum(8, 17);
  const bottomLum = rowLum(17, 20);
  if (Math.min(nameLum, bottomLum) < 0.3) return "light";
  if (nameLum > 0.76 && bottomLum > 0.55) return "dark";
  /* 三块文字区：品牌行 / 名字与简介 / 底部联系行（与卡面布局对应）。 */
  const bands = [
    { lum: rowLum(0, 6), shadow: 0.16, weight: 0.18 },
    { lum: rowLum(8, 17), shadow: 0.34, weight: 0.52 },
    { lum: rowLum(17, 20), shadow: 0.62, weight: 0.3 },
  ];
  /* 白字方案：蒙层压暗背景；黑字方案：蒙层提亮背景（CSS .is-cover-dark 那层白蒙层）。 */
  let lightContrast = 0;
  let darkContrast = 0;
  for (const b of bands) {
    const bgLight = b.lum * (1 - b.shadow);
    const bgDark = b.lum * (1 - b.shadow * 0.55) + b.shadow * 0.55;
    lightContrast += b.weight * (1.05 / (bgLight + 0.05));
    darkContrast += b.weight * ((bgDark + 0.05) / 0.05);
  }
  return lightContrast >= darkContrast ? "light" : "dark";
}

/** 图片文件 → 压缩 JPEG dataURL + 自动字色。 */
async function prepareImage(file: Awaited<ReturnType<typeof pickFile>>): Promise<{ src: string; ink: "light" | "dark" }> {
  if (!file) throw new Error("没有选择文件");
  if (!file.mime.startsWith("image/")) throw new Error("只支持图片");
  const bytes = await fileToBytes(file, 12 * 1024 * 1024);
  const blob = new Blob([bytes], { type: file.mime || "image/jpeg" });
  const bitmap = await decodeImage(blob);
  try {
    const bw = bitmap.width;
    const bh = bitmap.height;
    if (!bw || !bh) throw new Error("这张图片解不出尺寸，换一张试试");
    const scale = Math.min(1, MAX_SIDE / Math.max(bw, bh));
    const w = Math.max(1, Math.round(bw * scale));
    const h = Math.max(1, Math.round(bh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前环境不支持图片处理");
    /* 透明 PNG 铺白底，避免 JPEG 把透明区压成黑块。 */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    let quality = 0.84;
    let src = canvas.toDataURL("image/jpeg", quality);
    while (src.length > MAX_CHARS && quality > 0.42) {
      quality = Math.round((quality - 0.08) * 100) / 100;
      src = canvas.toDataURL("image/jpeg", quality);
    }
    /* 自动字色：不是看整图平均亮度，而是按「文字实际落在哪」加权，
       并把卡面蒙层也算进去——否则「亮处在上、暗处在下」的照片会误判成黑字，
       压在底部暗部上就看不见了。 */
    const ink = pickInk(canvas);
    return { src, ink };
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

/** 卡面编辑器：选图 → 拖动取景 + 缩放 → 自动字色预览 → 保存。 */
export function CardCoverEditor({
  open,
  card,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  card: PersonalCard;
  onClose: () => void;
  onSave: (cover: CardCover) => void;
  onRemove: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<CardCover | null>(null);
  const [busy, setBusy] = useState(false);
  /** 自动字色之外给个手动兜底：真实照片里「亮处压着暗处」时用户可以自己定。 */
  const [inkMode, setInkMode] = useState<"auto" | "light" | "dark">("auto");
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(card.cover ? { ...card.cover } : null);
    setInkMode("auto");
    drag.current = null;
  }, [open, card.cover]);

  const choose = async (): Promise<void> => {
    setBusy(true);
    try {
      const file = await pickFile();
      if (!file) return;
      const image = await prepareImage(file);
      setDraft((prev) => ({ ...(prev ?? {}), ...image, focusX: 0.5, focusY: 0.5, zoom: 1.1, updatedAt: Date.now() }));
    } catch (e) {
      showToast(`卡面设置失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const shown: CardCover | null = draft ? { ...draft, ink: inkMode === "auto" ? draft.ink : inkMode } : null;
  const save = (): void => {
    if (!shown) return;
    onSave({ ...shown, focusX: clamp01(shown.focusX), focusY: clamp01(shown.focusY), updatedAt: Date.now() });
    onClose();
  };

  const previewCard: PersonalCard = shown ? { ...card, cover: shown } : card;

  return (
    <Modal open={open} onClose={onClose} title={i18n("auto.components.CardCoverEditor.1")} size="lg">
      <Stack gap={4}>
        {draft ? (
          <>
            <div
              ref={stageRef}
              className="cover-editor-stage"
              /* 预览必须和「我的名片」里那张卡同尺寸：用 hero 档固定 540px 上限，
                 否则弹层里卡片被拉宽/压窄都会让字号看起来不对。 */
              style={{ width: "min(540px, 100%)" }}
              role="presentation"
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY, fx: draft.focusX, fy: draft.focusY };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                const rect = stageRef.current?.getBoundingClientRect();
                if (!d || !rect) return;
                const dx = (e.clientX - d.x) / rect.width;
                const dy = (e.clientY - d.y) / rect.height;
                setDraft((prev) => (prev ? { ...prev, focusX: clamp01(d.fx - dx), focusY: clamp01(d.fy - dy) } : prev));
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              <IdentityCard card={previewCard} variant="hero" />
            </div>
            <Text slot="micro" tone="faint">{i18n("auto.components.CardCoverEditor.2")}</Text>
            <Inline gap={2} wrap>
              <Text slot="micro" tone="faint">{i18n("auto.components.CardCoverEditor.3")}</Text>
              {([["auto", "自动"], ["light", "白字"], ["dark", "黑字"]] as const).map(([v, label]) => (
                <Btn key={v} size="sm" variant={inkMode === v ? "solid" : "ghost"} tone={inkMode === v ? "brand" : undefined} onClick={() => setInkMode(v)}>{label}</Btn>
              ))}
            </Inline>
            <label className="cover-editor-zoom">
              <Text slot="micro" tone="faint">{i18n("auto.components.CardCoverEditor.4")}{shown?.zoom.toFixed(2) ?? "1.00"}×</Text>
              <input
                type="range"
                min={1}
                max={2.5}
                step={0.05}
                value={shown?.zoom ?? 1}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, zoom: Number(e.target.value) } : prev))}
              />
            </label>
            <Inline gap={2} wrap>
              <Btn variant="outline" disabled={busy} onClick={() => void choose()}>{busy ? "处理中…" : "换一张照片"}</Btn>
              <Btn variant="ghost" tone="error" onClick={() => { onRemove(); onClose(); }}>{i18n("auto.components.CardCoverEditor.5")}</Btn>
              <Btn variant="ghost" onClick={onClose}>{i18n("auto.components.CardCoverEditor.6")}</Btn>
              <Btn variant="solid" tone="brand" onClick={save}>{i18n("auto.components.CardCoverEditor.7")}</Btn>
            </Inline>
          </>
        ) : (
          <Stack gap={3}>
            <Text slot="micro" tone="faint">{i18n("auto.components.CardCoverEditor.8")}</Text>
            <Inline gap={2} wrap>
              <Btn variant="solid" tone="brand" disabled={busy} onClick={() => void choose()}>{busy ? "处理中…" : "选择照片"}</Btn>
              {card.cover ? <Btn variant="ghost" onClick={() => { onRemove(); onClose(); }}>{i18n("auto.components.CardCoverEditor.5")}</Btn> : null}
              <Btn variant="ghost" onClick={onClose}>{i18n("auto.components.CardCoverEditor.6")}</Btn>
            </Inline>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
