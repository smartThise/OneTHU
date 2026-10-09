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

/// 当前平台是否支持本地 TTS（Android：JNI 库可加载）
#[tauri::command]
pub async fn tts_supported<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let v: serde_json::Value = handle
            .run_mobile_plugin("ttsSupported", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(v.get("value").and_then(|g| g.as_bool()).unwrap_or(false))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(false)
    }
}

/// 触发后台准备（模型下载 → 解包 → 初始化），进度经 tts_status 轮询
#[tauri::command]
pub async fn tts_prepare<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("ttsPrepare", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Err("此平台暂不支持本地语音合成".into())
    }
}

/// 合成并流式朗读（异步：完成/停止经 onethu-voice://tts-done 事件）。
/// speed 两档后端均生效；pitch/voice 仅 system 档生效；sid 仅 neural 档生效。
#[tauri::command]
pub async fn tts_speak<R: Runtime>(
    app: AppHandle<R>,
    text: String,
    speed: Option<f64>,
    pitch: Option<f64>,
    sid: Option<i32>,
    voice: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin(
                "ttsSpeak",
                serde_json::json!({
                    "text": text,
                    "speed": speed.unwrap_or(1.0),
                    "pitch": pitch.unwrap_or(1.0),
                    "sid": sid.unwrap_or(0),
                    "voice": voice.unwrap_or_default(),
                }),
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &text, &speed, &pitch, &sid, &voice);
        Err("此平台暂不支持本地语音合成".into())
    }
}

/// 停止朗读
#[tauri::command]
pub async fn tts_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("ttsStop", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(())
    }
}

/// 查询 TTS 状态：{ state: none|downloading|extracting|ready|error, progress, ready }
#[tauri::command]
pub async fn tts_status<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        handle
            .run_mobile_plugin("ttsStatus", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "state": "unsupported", "progress": 0, "ready": false }))
    }
}

/// 系统引擎中文音色列表（system 档）
#[tauri::command]
pub async fn tts_voices<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        handle
            .run_mobile_plugin("ttsVoices", serde_json::json!({}))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app;
        Ok(serde_json::json!({ "voices": [] }))
    }
}

/// 切换 TTS 后端（system=系统引擎默认 | neural=sherpa-onnx 可选下载）
#[tauri::command]
pub async fn tts_set_backend<R: Runtime>(
    app: AppHandle<R>,
    backend: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::OnethuVoice<R>>().0.clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("ttsSetBackend", serde_json::json!({ "backend": backend }))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, &backend);
        Ok(())
    }
}
