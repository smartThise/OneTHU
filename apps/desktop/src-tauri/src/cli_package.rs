//! Optional, verified CLI distribution. Only the main application window may
//! install it. Profiles and account data are never removed by uninstall.
use crate::cli_daemon as daemon;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::Path,
    time::Duration,
};

fn platform() -> (&'static str, &'static str) {
    (
        if cfg!(windows) {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        },
        if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        },
    )
}
fn status(app: &tauri::AppHandle) -> Result<Value, String> {
    let installed = daemon::manifest(&daemon::install_dir(app)?).ok();
    let version = app.package_info().version.to_string();
    Ok(
        json!({"installed":installed.is_some(),"available":installed.as_ref().is_some_and(|m| m.version==version),
        "version":installed.map(|m| m.version),"expectedVersion":version}),
    )
}
async fn connected_status(app: &tauri::AppHandle) -> Result<Value, String> {
    let mut state = status(app)?;
    if state["available"] == true {
        return Ok(state);
    }
    if let Some(access) = daemon::read_access(&daemon::profile_dir(app)?)? {
        if let Ok(remote) = daemon::rpc(
            &access,
            "daemon.status",
            Value::Null,
            Duration::from_secs(2),
        )
        .await
        {
            if remote["running"] == true
                && remote["desktopProtocolVersion"] == 1
                && remote["version"] == app.package_info().version.to_string()
            {
                state["available"] = json!(true);
                state["external"] = json!(true);
                state["version"] = remote["version"].clone();
            }
        }
    }
    Ok(state)
}

async fn stop(app: &tauri::AppHandle) -> Result<(), String> {
    let profile = daemon::profile_dir(app)?;
    if let Some(access) = daemon::read_access(&profile)? {
        if daemon::process_alive(access.pid) {
            daemon::rpc(&access, "daemon.stop", Value::Null, Duration::from_secs(30)).await?;
            for _ in 0..300 {
                tokio::time::sleep(Duration::from_millis(100)).await;
                if !daemon::process_alive(access.pid) && daemon::read_access(&profile)?.is_none() {
                    return Ok(());
                }
            }
            return Err("CLI_DAEMON_SHUTDOWN_PENDING".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn cli_package_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    daemon::main_only(window.label())?;
    connected_status(&app).await
}
/// Retire an incompatible legacy bundle before selecting an in-app scheduler.
/// Its account/task profile is retained for an explicit package upgrade.
#[tauri::command]
pub async fn cli_package_prepare(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    daemon::main_only(window.label())?;
    let _guard = daemon::ENSURE.lock().await;
    let state = connected_status(&app).await?;
    if state["installed"] == true && state["available"] != true {
        stop(&app).await?;
    }
    Ok(state)
}
fn trusted(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some(
                "api.github.com"
                    | "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
                    | "cloud.tsinghua.edu.cn"
            )
        )
}
async fn fetch(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "CLI_PACKAGE_SOURCE_INVALID")?;
    if !trusted(&parsed) {
        return Err("CLI_PACKAGE_SOURCE_INVALID".into());
    }
    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|_| "CLI_PACKAGE_DOWNLOAD_FAILED")?;
    if !response.status().is_success()
        || response.content_length().is_some_and(|n| n > limit as u64)
    {
        return Err("CLI_PACKAGE_DOWNLOAD_FAILED".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "CLI_PACKAGE_DOWNLOAD_FAILED")?
    {
        if bytes.len() + chunk.len() > limit {
            return Err("CLI_PACKAGE_TOO_LARGE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn unpack(bytes: Vec<u8>, root: &Path) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "CLI_PACKAGE_INVALID")?;
    if archive.len() > 2000 {
        return Err("CLI_PACKAGE_INVALID".into());
    }
    let mut total = 0u64;
    let mut names = std::collections::HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| "CLI_PACKAGE_INVALID")?;
        if entry.is_dir() {
            continue;
        }
        let relative = crate::native_security::relative_path(entry.name())?;
        if !names.insert(relative.to_string_lossy().to_ascii_lowercase())
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("CLI_PACKAGE_INVALID".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("CLI_PACKAGE_TOO_LARGE")?;
        if total > 512 * 1024 * 1024 || entry.size() > 256 * 1024 * 1024 {
            return Err("CLI_PACKAGE_TOO_LARGE".into());
        }
        let dest = root.join(relative);
        daemon::private_directory(dest.parent().ok_or("CLI_PACKAGE_INVALID")?)?;
        let mut data = Vec::new();
        entry
            .take(256 * 1024 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| "CLI_PACKAGE_INVALID")?;
        if data.len() > 256 * 1024 * 1024 {
            return Err("CLI_PACKAGE_TOO_LARGE".into());
        }
        crate::native_security::private_atomic_write(&dest, &data)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn cli_package_install(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    daemon::main_only(window.label())?;
    let _guard = daemon::ENSURE.lock().await;
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("CLI_DAEMON_DESKTOP_REQUIRED".into());
    }
    let version = app.package_info().version.to_string();
    let (platform, arch) = platform();
    let filename = format!("OneTHU-CLI_{version}_{platform}_{arch}.zip");
    let client = reqwest::Client::builder()
        .user_agent("OneTHU-CLI-Installer")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(240))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && trusted(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| "CLI_PACKAGE_DOWNLOAD_FAILED")?;
    let github = async {
        let metadata = fetch(
            &client,
            &format!("https://api.github.com/repos/smartThise/OneTHU/releases/tags/v{version}"),
            2 * 1024 * 1024,
        )
        .await?;
        let release: Value =
            serde_json::from_slice(&metadata).map_err(|_| "CLI_PACKAGE_SOURCE_INVALID")?;
        if release["draft"] != false || release["tag_name"] != format!("v{version}") {
            return Err("CLI_PACKAGE_SOURCE_INVALID".to_string());
        }
        let asset = release["assets"]
            .as_array()
            .and_then(|assets| assets.iter().find(|asset| asset["name"] == filename))
            .ok_or("CLI_PACKAGE_NOT_PUBLISHED")?;
        let expected = asset["digest"]
            .as_str()
            .and_then(|s| s.strip_prefix("sha256:"))
            .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or("CLI_PACKAGE_CHECKSUM_MISSING")?;
        let url = asset["browser_download_url"]
            .as_str()
            .ok_or("CLI_PACKAGE_SOURCE_INVALID")?;
        if url
            != format!(
                "https://github.com/smartThise/OneTHU/releases/download/v{version}/{filename}"
            )
        {
            return Err("CLI_PACKAGE_SOURCE_INVALID".into());
        }
        let bytes = fetch(&client, url, 128 * 1024 * 1024).await?;
        if format!("{:x}", Sha256::digest(&bytes)) != expected {
            return Err("CLI_PACKAGE_CHECKSUM_FAILED".into());
        }
        Ok::<_, String>(bytes)
    }
    .await;
    let bytes = match github {
        Ok(bytes) => bytes,
        Err(_) => {
            // Independently verifiable campus mirror; fixed public release
            // library, metadata version and path, never a caller-supplied URL.
            let share = "https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/files/";
            let bytes = fetch(
                &client,
                &format!("{share}?p=%2Fcli-packages.json&dl=1"),
                1024 * 1024,
            )
            .await?;
            let metadata: Value =
                serde_json::from_slice(&bytes).map_err(|_| "CLI_PACKAGE_SOURCE_INVALID")?;
            if metadata["version"] != version {
                return Err("CLI_PACKAGE_NOT_PUBLISHED".into());
            }
            let entry = metadata["packages"]
                .as_array()
                .and_then(|rows| {
                    rows.iter().find(|row| {
                        row["name"] == filename
                            && row["platform"] == platform
                            && row["arch"] == arch
                    })
                })
                .ok_or("CLI_PACKAGE_NOT_PUBLISHED")?;
            let expected = entry["sha256"]
                .as_str()
                .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
                .ok_or("CLI_PACKAGE_CHECKSUM_MISSING")?;
            let folder = if platform == "win32" {
                "Windows"
            } else if platform == "darwin" {
                "macOS"
            } else {
                "Linux"
            };
            let bytes = fetch(
                &client,
                &format!("{share}?p=%2F{folder}%2F{filename}&dl=1"),
                128 * 1024 * 1024,
            )
            .await?;
            if format!("{:x}", Sha256::digest(&bytes)) != expected {
                return Err("CLI_PACKAGE_CHECKSUM_FAILED".into());
            }
            bytes
        }
    };
    let target = daemon::install_dir(&app)?;
    let staging = target.with_file_name(format!("cli-download-{}", std::process::id()));
    if staging.exists() {
        return Err("CLI_PACKAGE_INSTALL_BUSY".into());
    }
    daemon::private_directory(&staging)?;
    let result = async {
        unpack(bytes, &staging)?;
        let manifest = daemon::manifest(&staging)?;
        if manifest.version != version {
            return Err("CLI_PACKAGE_VERSION_MISMATCH".into());
        }
        // Validate files before stopping the previous working runtime; install_runtime
        // verifies each digest and expands only the fixed Node executable name.
        stop(&app).await?;
        daemon::install_runtime(&staging, &target, &manifest)?;
        status(&app)
    }
    .await;
    let _ = fs::remove_dir_all(&staging);
    result
}
fn remove_autostart(target: &Path, profile: &Path) -> Result<(), String> {
    let node = target.join(if cfg!(windows) { "node.exe" } else { "node" });
    if !node.is_file() {
        return Err("CLI_PACKAGE_REPAIR_REQUIRED".into());
    }
    let mut command = std::process::Command::new(node);
    command
        .arg(target.join("bin/onethu.mjs"))
        .args(["daemon", "uninstall", "--confirm", "--data-dir"])
        .arg(profile)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("ONETHU_ENDPOINT")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "CLI_PACKAGE_AUTOSTART_REMOVE_FAILED")?;
    for _ in 0..200 {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err("CLI_PACKAGE_AUTOSTART_REMOVE_FAILED".into())
                }
            }
            Err(_) => break,
            _ => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("CLI_PACKAGE_AUTOSTART_REMOVE_FAILED".into())
}

#[tauri::command]
pub async fn cli_package_uninstall(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    daemon::main_only(window.label())?;
    let _guard = daemon::ENSURE.lock().await;
    stop(&app).await?;
    let target = daemon::install_dir(&app)?;
    if target.exists() {
        daemon::manifest(&target)?;
        let (runtime, profile) = (target.clone(), daemon::profile_dir(&app)?);
        tokio::task::spawn_blocking(move || remove_autostart(&runtime, &profile))
            .await
            .map_err(|_| "CLI_PACKAGE_AUTOSTART_REMOVE_FAILED")??;
        fs::remove_dir_all(&target).map_err(|_| "CLI_PACKAGE_UNINSTALL_FAILED")?;
    }
    // Never delete profile_dir: it holds credentials, jobs, grants and inboxes.
    status(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distribution_hosts_are_fixed() {
        for url in [
            "http://github.com/a",
            "https://github.com.evil.test/a",
            "https://user@github.com/a",
            "https://github.com:8443/a",
            "https://localhost/a",
        ] {
            assert!(!trusted(&url.parse().unwrap()));
        }
        assert!(trusted(
            &"https://release-assets.githubusercontent.com/a"
                .parse()
                .unwrap()
        ));
    }
}
