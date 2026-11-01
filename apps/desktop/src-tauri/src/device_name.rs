//! Read a public OS display name; never access hardware IDs or register trust.
#[cfg(target_os = "android")]
use tauri::Manager;

#[tauri::command]
pub async fn device_display_name(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(serde::Deserialize)]
        struct DeviceName {
            name: String,
        }
        let result = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .run_mobile_plugin::<DeviceName>("deviceDisplayName", ())
            .map_err(|_| "DEVICE_NAME_UNAVAILABLE".to_string())?;
        return Ok(result.name);
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    #[cfg(target_os = "macos")]
    {
        if let Ok(Ok(output)) = tokio::time::timeout(
            std::time::Duration::from_millis(1500),
            tokio::process::Command::new("/usr/sbin/scutil")
                .args(["--get", "ComputerName"])
                .kill_on_drop(true)
                .output(),
        )
        .await
        {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() && !name.is_empty() {
                return Ok(name);
            }
        }
    }
    #[cfg(target_os = "windows")]
    return Ok(std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows".into()));
    #[cfg(all(unix, not(target_os = "android")))]
    {
        let mut bytes = [0u8; 256];
        // gethostname writes at most the supplied buffer; only read before NUL.
        if unsafe { libc::gethostname(bytes.as_mut_ptr().cast(), bytes.len()) } == 0 {
            let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
            let name = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
            if !name.is_empty() {
                return Ok(name);
            }
        }
        Ok(if cfg!(target_os = "macos") {
            "Mac"
        } else {
            "此设备"
        }
        .into())
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    Ok("此设备".into())
}
