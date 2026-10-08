//! 插件命令（JS 侧只有探活；saveDownload/openIntent/openYktWebLogin/readYktCookies/openWebModal 由主 crate Rust 直调）

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

/// 系统夜间模式的原生信号（b40）：回 "dark" / "light" / "unknown"。
///
/// 为什么走原生：WebView 96（老机型）不把系统暗色透传到 `prefers-color-scheme`，
/// 「跟随系统」在 96 上恒亮色。Kotlin 侧读 Configuration 的实际 night 位绕开该缺口；
/// 非 Android（PC）没有这条桥，回 "unknown" 让前端回落 `matchMedia`。
/// 变更通知走 Kotlin 的 `onConfigurationChanged` → 插件事件 `system-night-mode`
/// （前端 `addPluginListener`），不做轮询。
#[tauri::command]
pub async fn system_night_mode<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let handle = app.state::<crate::OnethuMobile<R>>().0.clone();
        let reply: serde_json::Value = handle
            .run_mobile_plugin("systemNightMode", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(reply
            .get("mode")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok("unknown".to_string())
    }
}

/// 退出应用：Android 上 finish 当前 Activity（前端在返回栈到根时调用）。
///
/// 为什么不用 Tauri 的 `plugin:app|exit`：本项目 ACL 未放行该命令（core:app 权限集里
/// 没有 exit），真机实测被拒；故由本插件转调 Kotlin `exitApp`（语义同为 finish Activity）。
#[tauri::command]
pub async fn mobile_exit<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let handle = app.state::<crate::OnethuMobile<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("exitApp", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
    }
    Ok(())
}
