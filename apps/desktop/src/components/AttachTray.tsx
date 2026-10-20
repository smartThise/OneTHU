/**
 * 附件入口条（需求 6/8）：拍照 / 相册 / 上传 三个按钮 → AttachFile[] → 交给 OH。
 *
 * 挂载位置由宿主决定（悬浮球打开后的面板 / 对话面板输入框上方）。组件自包含：
 *  - 传了 `onPicked`：宿主自己发送与渲染气泡（**推荐**——悬浮面板与对话面板都该这样，
 *    否则消息只会经默认通道问 OH，面板里看不到这条气泡）；宿主接管后附件与其预览地址
 *    的使用权也归宿主（本组件只在「没交出去」时负责回收）；
 *  - 没传：调 `lib/attach.ts` 的 `sendToOh()`（默认通道 `askOh()`，纯前端、不打开任何窗口）。
 *
 * 图片会先进滤镜编辑（需求 8）：单选图片才弹（多选时逐张编辑太重，直接发原图）。
 * 编辑取消 = 这次不发送（不做「替你决定发原图」这种事）。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type SVGProps } from "react";
import {
  attachFromDataUrl, fileToBlob, pickCamera, pickFiles, pickGallery, releaseAttachPreviews, sendToOh,
  type AttachFile,
} from "../lib/attach.js";
import { ImageFilterSheet, type FilterResult } from "./ImageFilterSheet.js";
import { IconCamera, IconImage, IconUpload } from "./Icons.js";
import { logLine } from "../lib/clients.js";
import { Chip } from "@onethu/gui";
import { t as i18n } from "../i18n/index.js";


export interface AttachTrayProps {
  /** 宿主接管：拿到附件后自己发送/渲染（不传则走 sendToOh 默认通道） */
  onPicked?: (files: AttachFile[]) => void | Promise<void>;
  /** 图片先编辑再发（默认开） */
  allowEdit?: boolean;
  className?: string;
  style?: CSSProperties;
}

type Source = "camera" | "gallery" | "file";

/** 三个入口：线性图标 + 短标签（2026-10-10 用户：emoji 占地方又不好看 → 全换 Icons 基座） */
const SOURCES: Array<{ id: Source; label: string; title: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement }> = [
  { id: "camera", label: "拍照", title: "调起相机拍一张", icon: IconCamera },
  { id: "gallery", label: "相册", title: "从相册选图片", icon: IconImage },
  { id: "file", label: "上传", title: "选任意文件", icon: IconUpload },
];

interface Editing {
  file: AttachFile;
  src: Blob | string;
}

function msgOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "没取到文件，请重试或换一个入口。";
}


export function AttachTray({ onPicked, allowEdit = true, className, style }: AttachTrayProps): ReactNode {
  const [busy, setBusy] = useState<Source | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  /** 已取件但还没交出去的附件：卸载时回收它们的预览地址 */
  const owned = useRef<AttachFile[]>([]);

  /** 送出去（或放弃）之后，所有权就不归本组件了 */
  const handoff = useCallback(async (files: AttachFile[]): Promise<void> => {
    if (onPicked) {
      await onPicked(files);
    } else {
      await sendToOh(files);
    }
    // 只有真的交出去了才转移所有权：失败了仍由本组件在卸载时回收预览地址
    owned.current = owned.current.filter((f) => !files.includes(f));
  }, [onPicked]);

  const pick = useCallback(async (source: Source): Promise<void> => {
    if (busy) return;
    setBusy(source);
    setNote("正在打开…");
    try {
      let files: AttachFile[] = [];
      if (source === "camera") {
        const one = await pickCamera();
        files = one ? [one] : [];
      } else if (source === "gallery") {
        const one = await pickGallery();
        files = one ? [one] : [];
      } else {
        files = await pickFiles({ multiple: true });
      }
      if (files.length === 0) {
        setNote("已取消");
        return;
      }
      const first = files[0];
      if (allowEdit && files.length === 1 && first && first.mime.startsWith("image/")) {
        // 图片先编辑：编辑用的图源优先内存 File，其次预览地址，都没有才读字节
        const src: Blob | string = first.file ?? first.previewUrl ?? (await fileToBlob(first));
        owned.current = [...owned.current, first];
        setEditing({ file: first, src });
        setNote("");
        return;
      }
      owned.current = [...owned.current, ...files];
      await handoff(files);
      // 宿主接管时它自己给反馈，这里不抢话；走默认通道才提示「已交给 OH」
      setNote(onPicked ? "" : "已交给 OH");
    } catch (e) {
      setNote(msgOf(e));
      void logLine(`[附件] 取件失败：${msgOf(e)}`).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }, [allowEdit, busy, handoff]);

  /** 滤镜应用：编辑结果替掉原图（编辑后的图只有内容、没有路径，别冒充原路径） */
  const onEditApply = useCallback((r: FilterResult): void => {
    const cur = editing;
    setEditing(null);
    if (!cur) return;
    const edited = attachFromDataUrl(r.dataUrl, r.name);
    owned.current = owned.current.filter((f) => f !== cur.file);
    releaseAttachPreviews([cur.file]);
    void handoff([edited]).catch((e: unknown) => setNote(msgOf(e)));
  }, [editing, handoff]);

  const onEditCancel = useCallback((): void => {
    const cur = editing;
    setEditing(null);
    if (cur) releaseAttachPreviews([cur.file]);
    owned.current = owned.current.filter((f) => f !== cur?.file);
    setNote("已取消");
  }, [editing]);

  // 卸载：把还没交出去的预览地址回收（不回收 = 长会话里的内存泄漏）
  useEffect(
    () => (): void => {
      releaseAttachPreviews(owned.current);
      owned.current = [];
    },
    [],
  );

  return (
    <div className={`oh-attach${className ? ` ${className}` : ""}`} style={style} role="group" aria-label={i18n("auto.components.AttachTray.1")}>
      {SOURCES.map((src) => (
        <Chip
          key={src.id}
          className="oh-attach-btn"
          icon={<src.icon width={15} height={15} />}
          onClick={busy !== null ? undefined : () => void pick(src.id)}
          disabled={busy !== null}
        >
          {busy === src.id ? "打开中…" : src.label}
        </Chip>
      ))}
      {note ? <span className="oh-attach-note" aria-live="polite">{note}</span> : null}
      {editing ? (
        <ImageFilterSheet src={editing.src} fileName={editing.file.name} onApply={onEditApply} onCancel={onEditCancel} />
      ) : null}
    </div>
  );
}
