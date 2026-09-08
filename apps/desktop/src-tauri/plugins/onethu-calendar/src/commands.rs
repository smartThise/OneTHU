//! 插件命令（JS 入口；平台内部分发）
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "android")]
use tauri::Manager;

use crate::{SyncPayload, SyncResult};

/// 当前平台是否支持原生系统日历读写
#[tauri::command]
pub fn supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "android"))
}

/// 请求系统日历权限（Android 运行时权限弹窗 / macOS TCC 弹窗）
#[tauri::command]
pub async fn request_permission<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuCalendar<R>>().0.clone();
        let v: serde_json::Value = handle
            .run_mobile_plugin("requestPermission", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(v.get("granted").and_then(|g| g.as_bool()).unwrap_or(false))
    }
    #[cfg(target_os = "macos")]
    {
        let _ = &app;
        crate::macos::request_permission()
    }
    #[cfg(not(any(target_os = "android", target_os = "macos")))]
    {
        let _ = &app;
        Ok(false)
    }
}

/// 幂等同步：窗口内清旧 → 全量重写，返回 { added, removed }
#[tauri::command]
pub async fn sync<R: Runtime>(app: AppHandle<R>, payload: SyncPayload) -> Result<SyncResult, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuCalendar<R>>().0.clone();
        let v: serde_json::Value = handle
            .run_mobile_plugin("sync", payload)
            .map_err(|e| e.to_string())?;
        serde_json::from_value(v).map_err(|e| format!("系统日历返回异常：{e}"))
    }
    #[cfg(target_os = "macos")]
    {
        let _ = &app;
        crate::macos::sync(payload)
    }
    #[cfg(not(any(target_os = "android", target_os = "macos")))]
    {
        let _ = (&app, payload);
        Err("此平台不支持写入系统日历（可改用 .ics 导出）".into())
    }
}

/// 移除 OneTHU 专属日历（连同其中全部事件）
#[tauri::command]
pub async fn remove_calendar<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuCalendar<R>>().0.clone();
        let _v: serde_json::Value = handle
            .run_mobile_plugin("removeCalendar", serde_json::json!({ "calendarTitle": crate::CALENDAR_TITLE }))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = &app;
        crate::macos::remove_calendar()
    }
    #[cfg(not(any(target_os = "android", target_os = "macos")))]
    {
        let _ = &app;
        Err("此平台不支持系统日历操作".into())
    }
}
