/**
 * 本地文件「打开 / 定位」（R25）。
 *
 * 为什么不用官方 opener 插件：`openPath` / `revealItemInDir` 除命令权限外还需要 capability
 * 里配**路径 scope**，只给 `opener:allow-open-path` 会直接报
 * 「Not allowed to open path ...」；而下载与「另存为」的落盘位置由用户决定（任意盘符/目录），
 * 白名单式 scope 覆盖不全。故改走自写 Rust 命令（`onethu_open_path` / `onethu_reveal_path`），
 * 自定义命令不受插件 ACL 约束；Rust 侧只放行「绝对路径且已存在」。
 */
import { invoke } from "@tauri-apps/api/core";

/** 用系统默认应用打开本地文件 */
export async function openLocalPath(path: string): Promise<void> {
  await invoke("onethu_open_path", { path });
}

/** 在文件管理器中定位并选中该文件（Windows 资源管理器 / macOS Finder；Linux 打开所在目录） */
export async function revealLocalPath(path: string): Promise<void> {
  await invoke("onethu_reveal_path", { path });
}
