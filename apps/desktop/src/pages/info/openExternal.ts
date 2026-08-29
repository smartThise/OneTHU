/**
 * 在系统浏览器打开外部 URL。
 * 分层降级：Tauri opener 插件（未装则跳过）→ window.open → 复制链接兜底。
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:/i.test(url)) return;

  // 1) Tauri 官方 opener 插件（若后续装配，自动生效）
  try {
    const spec = "@tauri-apps/plugin-opener";
    const mod = (await import(/* @vite-ignore */ spec)) as { openUrl?: (u: string) => Promise<void> };
    if (typeof mod?.openUrl === "function") {
      await mod.openUrl(url);
      return;
    }
  } catch {
    /* 插件未安装，继续降级 */
  }

  // 2) WebView / 浏览器新窗口
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win) return;

  // 3) 兜底：复制到剪贴板，交给用户手动打开
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* 剪贴板不可用时静默（行内仍展示来源等上下文） */
  }
}
