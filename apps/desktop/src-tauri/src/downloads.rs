//! 桌面下载位置：网络学堂和云盘共用，保存在本机应用状态目录。

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDirectory {
    path: String,
    is_default: bool,
}

#[cfg(not(target_os = "android"))]
const STATE_KEY: &str = "download-directory";

#[cfg(not(target_os = "android"))]
fn default_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    // 尊重 Windows 系统中重定向后的「下载」文件夹。
    app.path()
        .download_dir()
        .map_err(|e| format!("无法定位下载目录：{e}"))
}

#[cfg(not(target_os = "android"))]
fn directory_setting(app: &tauri::AppHandle) -> Result<DownloadDirectory, String> {
    let saved = crate::state_read(app.clone(), STATE_KEY.into())?;
    let custom: Option<std::path::PathBuf> = saved
        .map(|text| serde_json::from_str(&text).map_err(|e| format!("无法读取下载位置：{e}")))
        .transpose()?;
    let is_default = custom.is_none();
    let path = match custom {
        Some(path) if path.is_absolute() => path,
        Some(_) => return Err("下载位置必须是绝对路径，请重新选择文件夹".into()),
        None => default_directory(app)?,
    };
    Ok(DownloadDirectory {
        path: path.to_string_lossy().into_owned(),
        is_default,
    })
}

#[cfg(not(target_os = "android"))]
pub fn directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(std::path::PathBuf::from(directory_setting(app)?.path))
}

/// Android 返回 None，设置页不展示桌面下载位置。
#[tauri::command]
pub fn download_directory_get(app: tauri::AppHandle) -> Result<Option<DownloadDirectory>, String> {
    #[cfg(not(target_os = "android"))]
    {
        directory_setting(&app).map(Some)
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Ok(None)
    }
}

/// 回调式目录选择，避免原生对话框阻塞主线程；取消时不修改配置。
#[tauri::command]
pub async fn download_directory_pick(
    app: tauri::AppHandle,
) -> Result<Option<DownloadDirectory>, String> {
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app.dialog().file().set_title("选择下载文件夹");
        if let Ok(current) = directory(&app) {
            if current.is_dir() {
                dialog = dialog.set_directory(current);
            }
        }
        let (tx, rx) = tokio::sync::oneshot::channel();
        dialog.pick_folder(move |path| {
            let _ = tx.send(path);
        });
        let Some(picked) = rx.await.map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        if !path.is_absolute() || !path.is_dir() {
            return Err("请选择有效的下载文件夹".into());
        }
        let content = serde_json::to_string(&path).map_err(|e| e.to_string())?;
        crate::state_write(app.clone(), STATE_KEY.into(), content)?;
        directory_setting(&app).map(Some)
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Err("Android 使用系统下载目录".into())
    }
}

#[tauri::command]
pub fn download_directory_reset(
    app: tauri::AppHandle,
) -> Result<Option<DownloadDirectory>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let path = default_directory(&app)?;
        crate::state_delete(app, STATE_KEY.into())?;
        Ok(Some(DownloadDirectory {
            path: path.to_string_lossy().into_owned(),
            is_default: true,
        }))
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Err("Android 使用系统下载目录".into())
    }
}
