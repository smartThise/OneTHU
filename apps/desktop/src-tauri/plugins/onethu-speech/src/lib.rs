//! OneTHU 灵动岛语音输入插件（Android）。
//!
//! 会话式长按模型：JS 按住胶囊 → speech_start（运行时麦克风权限 + 启动识别）
//! → speech_poll 每 ~180ms 拿部分转写 → speech_stop 收最终文本。
//! Kotlin 侧 SpeechRecognizer + RecognitionListener（onPartialResults 实时更新）。
//!
//! macOS 的语音走 app 主 crate 的 speech.m 桥（SFSpeechRecognizer），不经本插件；
//! 桌面端本插件命令一律返回「此平台暂不支持」——JS 按平台路由命令名。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

pub mod commands;

/// Android 插件句柄包装（newtype：app.state 按类型取，裸 PluginHandle 会与其他插件撞类型）
pub struct OnethuSpeech<R: Runtime>(#[allow(dead_code)] tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Clone for OnethuSpeech<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("onethu-speech")
        .invoke_handler(tauri::generate_handler![
            commands::speech_supported,
            commands::speech_start,
            commands::speech_poll,
            commands::speech_stop,
        ])
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            let _ = (&app, &api);
            // Android：注册 Kotlin 插件（app.onethu.speech.OnethuSpeechPlugin）
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("app.onethu.speech", "OnethuSpeechPlugin")?;
                app.manage(OnethuSpeech(handle));
            }
            Ok(())
        })
        .build()
}
