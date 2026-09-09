//! 插件命令（JS 侧只有探活；saveDownload/openIntent 由主 crate Rust 直调）

use tauri::{AppHandle, Runtime};

/// 本平台是否有移动系统桥（Android=true；前端可用于条件降级）
#[tauri::command]
pub async fn mobile_supported<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let _ = &app;
        Ok(true)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(false)
    }
}
