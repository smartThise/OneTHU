//! OneTHU 系统日历原生同步插件。
//!
//! 模型（学习 learnX）：不碰用户已有日历，创建/复用名为 `OneTHU 日程` 的专属日历；
//! 每次同步对窗口内旧事件清空重写（幂等）；课程/考试可带 -15 分钟提醒。
//!
//! 平台：Android（Kotlin CalendarProvider，华为/鸿蒙投影兼容）；
//! macOS（EventKit / EKEventStore）。其余平台 `supported()` 返回 false（前端退 .ics 导出）。
//!
//! 命令路由：JS `invoke("plugin:onethu-calendar|…")` → 本 crate 的 `#[tauri::command]`
//! → Android 上经 `run_mobile_plugin` 转发到 `OnethuCalendarPlugin` 的同名 `@Command`。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

pub mod commands;

/// 专属日历名（与 learnX「learnX 课表」同思路，两平台一致）
pub const CALENDAR_TITLE: &str = "OneTHU 日程";

/* ---------- 数据模型（与 JS 层 camelCase 对齐） ---------- */

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SysCalEvent {
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// 提前提醒分钟数（课程/考试 15；缺省无提醒）
    #[serde(default)]
    pub alarm_minutes: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPayload {
    pub calendar_title: String,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    pub events: Vec<SysCalEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub added: u32,
    pub removed: u32,
}

/* ---------- 插件入口 ---------- */

#[cfg(target_os = "macos")]
mod macos;

/// Android 插件句柄包装（newtype：app.state 按类型取，裸 PluginHandle 会与其他插件撞类型）
pub struct OnethuCalendar<R: Runtime>(#[allow(dead_code)] tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Clone for OnethuCalendar<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("onethu-calendar")
        .invoke_handler(tauri::generate_handler![
            commands::supported,
            commands::request_permission,
            commands::sync,
            commands::remove_calendar
        ])
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            let _ = (&app, &api);
            // Android：注册 Kotlin 插件（app.onethu.calendar.OnethuCalendarPlugin）
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("app.onethu.calendar", "OnethuCalendarPlugin")?;
                app.manage(OnethuCalendar(handle));
            }
            Ok(())
        })
        .build()
}
