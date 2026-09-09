//! 插件命令（JS 入口；Android 经 run_mobile_plugin 转发到 Kotlin 同名 @Command）
//! macOS 路径走 app 主 crate 的 speech.m 桥，不经这里。

use tauri::{AppHandle, Runtime};

/// 当前平台是否支持原生语音识别
#[tauri::command]
pub async fn speech_supported<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuSpeech<R>>().0.clone();
        let v: serde_json::Value = handle
            .run_mobile_plugin("speechSupported", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(v.get("value").and_then(|g| g.as_bool()).unwrap_or(false))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(false)
    }
}

/// 开始一次识别会话（Android：运行时麦克风权限弹窗 → SpeechRecognizer 启动）
#[tauri::command]
pub async fn speech_start<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuSpeech<R>>().0.clone();
        handle
            .run_mobile_plugin("speechStart", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Err("此平台暂不支持原生语音识别".into())
    }
}

/// 读取当前转写（部分结果实时更新）
#[tauri::command]
pub async fn speech_poll<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuSpeech<R>>().0.clone();
        let v: serde_json::Value = handle
            .run_mobile_plugin("speechPoll", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(String::new())
    }
}

/// 停止识别（最终文本此后仍可由 poll 拿一次）
#[tauri::command]
pub async fn speech_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuSpeech<R>>().0.clone();
        handle
            .run_mobile_plugin("speechStop", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Err("此平台暂不支持原生语音识别".into())
    }
}
