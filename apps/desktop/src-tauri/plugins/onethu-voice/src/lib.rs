//! OneTHU 语音中枢插件（Android）。
//!
//! sherpa-onnx KWS 自定义唤醒词（"你好小欧"）+ 常驻前台服务（microphone 类型）
//! + 麦克风交接状态机。TS 侧只经 wake_* 命令与 onethu-voice://* 事件交互，
//! 持续监听全部在原生层（报告 §4.2 红线：TS 不实现监听）。
//!
//! 桌面端命令一律返回不支持——JS 按平台路由命令名（与 onethu-speech 同款约定）。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

pub mod commands;

/// Android 插件句柄包装（newtype：app.state 按类型取，裸 PluginHandle 会与其他插件撞类型）
pub struct OnethuVoice<R: Runtime>(#[allow(dead_code)] tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Clone for OnethuVoice<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("onethu-voice")
        .invoke_handler(tauri::generate_handler![
            commands::wake_supported,
            commands::wake_start,
            commands::wake_stop,
            commands::wake_status,
            commands::wake_mark_state,
        ])
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            let _ = (&app, &api);
            // Android：注册 Kotlin 插件（app.onethu.voice.OnethuVoicePlugin）
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("app.onethu.voice", "OnethuVoicePlugin")?;
                app.manage(OnethuVoice(handle));
            }
            Ok(())
        })
        .build()
}
