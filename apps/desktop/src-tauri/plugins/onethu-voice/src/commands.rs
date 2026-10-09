//! 插件命令（JS 入口；Android 经 run_mobile_plugin 转发到 Kotlin 同名 @Command）。
//!
//! 状态机真源在 Kotlin（VoiceHub 单例）；wake_mark_state 是 JS → 原生的状态回告
//! （识别结束/LLM 处理/TTS 播放等只有 JS 侧知道的时刻）。

use tauri::{AppHandle, Runtime};
#[cfg(target_os = "android")]
use tauri::Manager;

/// 当前平台是否支持 KWS 唤醒（Android：模型资产 + JNI 库齐备才算支持）
#[tauri::command]
pub async fn wake_supported<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let v: serde_json::Value = handle
            .run_mobile_plugin("wakeSupported", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(v.get("value").and_then(|g| g.as_bool()).unwrap_or(false))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(false)
    }
}

/// 开启唤醒监听（拉起 microphone 前台服务；权限缺失时 Kotlin 抛错原因）
#[tauri::command]
pub async fn wake_start<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("wakeStart", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Err("此平台暂不支持唤醒词监听".into())
    }
}

/// 停止唤醒监听（停服务、释放麦克风与模型）
#[tauri::command]
pub async fn wake_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("wakeStop", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Err("此平台暂不支持唤醒词监听".into())
    }
}

/// 查询状态机当前状态：{ state, listening, keyword }
#[tauri::command]
pub async fn wake_status<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        handle
            .run_mobile_plugin("wakeStatus", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "state": "unsupported", "listening": false }))
    }
}

/// JS 回告状态转移（mark：processing / speaking / done / error）
#[tauri::command]
pub async fn wake_mark_state<R: Runtime>(
    app: AppHandle<R>,
    mark: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("wakeMarkState", serde_json::json!({ "mark": mark }))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &mark);
        Ok(())
    }
}
