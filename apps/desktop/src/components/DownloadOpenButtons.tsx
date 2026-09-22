/**
 * 下载完成提示右侧的「打开文件 / 打开目录」小图标按钮（R23，霖需求）。
 *
 * - 打开文件：系统默认应用打开；
 * - 打开目录：文件管理器定位并选中该文件（Windows 资源管理器 / macOS Finder；Linux 打开所在目录）；
 * - 图标用应用内联线性图标（1.6px 描边 + currentColor），随提示条继承蓝色，不用 emoji；
 * - 仅桌面显示：Android 下载落在应用私有目录，无「定位」语义（isAndroidNavigator 多信号判定）；
 * - 失败降级为 toast 报错，不抛出。
 *
 * 实现走自写 Rust 命令（`lib/localFile.ts`）而非官方 opener 插件：插件的 openPath 需要
 * capability 配路径 scope，只给命令权限会报「Not allowed to open path ...」，而下载位置
 * 由用户决定、白名单覆盖不全（详见 lib/localFile.ts 注释）。
 */
import { ReactNode, useState } from "react";
import { IconFile, IconFolder } from "./Icons.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { openLocalPath, revealLocalPath } from "../lib/localFile.js";
import { showToast } from "../state/toast.js";

export function DownloadOpenButtons({ path }: { path: string }): ReactNode {
  const [busy, setBusy] = useState<"" | "file" | "dir">("");
  if (isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined)) return null;
  if (!path) return null;

  const run = async (kind: "file" | "dir"): Promise<void> => {
    setBusy(kind);
    try {
      if (kind === "file") await openLocalPath(path);
      else await revealLocalPath(path);
    } catch (e) {
      showToast(`${kind === "file" ? "打开文件" : "打开目录"}失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <span className="dl-open-btns" role="group" aria-label="打开下载的文件">
      <button
        className="btn btn-ghost dl-open-btn"
        title="打开文件（系统默认应用）"
        aria-label="打开文件"
        disabled={busy !== ""}
        onClick={(e) => {
          e.stopPropagation();
          void run("file");
        }}
      >
        <IconFile width={14} height={14} />
      </button>
      <button
        className="btn btn-ghost dl-open-btn"
        title="打开目录（定位到文件）"
        aria-label="打开目录"
        disabled={busy !== ""}
        onClick={(e) => {
          e.stopPropagation();
          void run("dir");
        }}
      >
        <IconFolder width={14} height={14} />
      </button>
    </span>
  );
}
