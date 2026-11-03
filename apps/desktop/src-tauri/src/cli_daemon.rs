//! Main-window-only bridge to the single, independently resident CLI runtime.
//! Discovery credentials never cross IPC and requests never use system proxies.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

const PROTOCOL: u64 = 1;
const MAX_REQUEST: usize = 8 * 1024 * 1024;
const MAX_RESPONSE: usize = 16 * 1024 * 1024;
pub(crate) static ENSURE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
const METHODS: &[&str] = &[
    "desktop.status",
    "desktop.adoptSession",
    "desktop.exportSession",
    "desktop.logout",
    "desktop.policy",
    "desktop.migrateTasks",
    "desktop.call",
    "desktop.notificationsSync",
    "desktop.yuketangSync",
    "desktop.dataRead",
    "desktop.dataWrite",
    "desktop.dataBootstrap",
    "desktop.retire",
    "desktop.unretire",
    "desktop.cloudSync",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Access {
    port: u16,
    token: String,
    pub(crate) pid: u32,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Manifest {
    protocol_version: u64,
    pub(crate) version: String,
    platform: String,
    arch: String,
    node_version: String,
    node_sha256: String,
    build_id: String,
    files: BTreeMap<String, String>,
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(crate) fn main_only(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("CLI_DAEMON_MAIN_WINDOW_REQUIRED".into())
    }
}
fn allow_method(method: &str) -> Result<(), String> {
    if METHODS.contains(&method) {
        Ok(())
    } else {
        Err("CLI_DAEMON_METHOD_DENIED".into())
    }
}
fn unsafe_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
fn reject_link(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if unsafe_link(&meta) => Err("CLI_DAEMON_UNSAFE_PATH".into()),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("CLI_DAEMON_PATH_UNAVAILABLE".into()),
    }
}
fn regular_file(path: &Path, limit: u64, private: bool) -> Result<File, String> {
    reject_link(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options
        .open(path)
        .map_err(|_| "CLI_DAEMON_FILE_UNAVAILABLE")?;
    let meta = file.metadata().map_err(|_| "CLI_DAEMON_FILE_UNAVAILABLE")?;
    if !meta.is_file() || unsafe_link(&meta) || meta.len() > limit {
        return Err("CLI_DAEMON_UNSAFE_FILE".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() != 1
            || (private && (meta.mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() }))
        {
            return Err("CLI_DAEMON_PRIVATE_FILE_REQUIRED".into());
        }
    }
    #[cfg(windows)]
    if private {
        windows_private_acl(&file)?;
    }
    Ok(file)
}
fn read_json(path: &Path, limit: u64, private: bool) -> Result<Value, String> {
    let mut bytes = Vec::new();
    regular_file(path, limit, private)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "CLI_DAEMON_FILE_UNAVAILABLE")?;
    if bytes.len() as u64 > limit {
        return Err("CLI_DAEMON_UNSAFE_FILE".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "CLI_DAEMON_INVALID_FILE".into())
}
pub(crate) fn read_access(profile: &Path) -> Result<Option<Access>, String> {
    reject_link(profile)?;
    #[cfg(unix)]
    if let Ok(meta) = fs::symlink_metadata(profile) {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
            return Err("CLI_DAEMON_PRIVATE_DIRECTORY_REQUIRED".into());
        }
    }
    let path = profile.join("daemon-access.json");
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("CLI_DAEMON_FILE_UNAVAILABLE".into()),
        _ => (),
    }
    let access: Access = serde_json::from_value(read_json(&path, 4096, true)?)
        .map_err(|_| "CLI_DAEMON_INVALID_ACCESS")?;
    if access.port == 0
        || access.pid == 0
        || access.pid > i32::MAX as u32
        || !is_hash(&access.token)
    {
        return Err("CLI_DAEMON_INVALID_ACCESS".into());
    }
    Ok(Some(access))
}

pub(crate) fn profile_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        app.path()
            .local_data_dir()
            .map(|p| p.join("OneTHU CLI"))
            .map_err(|_| "CLI_DAEMON_PROFILE_UNAVAILABLE".into())
    }
    #[cfg(target_os = "macos")]
    {
        app.path()
            .home_dir()
            .map(|p| p.join("Library/Application Support/OneTHU CLI"))
            .map_err(|_| "CLI_DAEMON_PROFILE_UNAVAILABLE".into())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        app.path()
            .data_dir()
            .map(|p| p.join("OneTHU CLI"))
            .map_err(|_| "CLI_DAEMON_PROFILE_UNAVAILABLE".into())
    }
}
pub(crate) fn install_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        app.path()
            .local_data_dir()
            .map(|p| p.join("OneTHU/cli"))
            .map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE".into())
    }
    #[cfg(not(windows))]
    {
        app.path()
            .home_dir()
            .map(|p| p.join(".local/share/onethu-cli"))
            .map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE".into())
    }
}
pub(crate) fn manifest(dir: &Path) -> Result<Manifest, String> {
    reject_link(dir)?;
    let m: Manifest =
        serde_json::from_value(read_json(&dir.join("runtime.json"), 1024 * 1024, false)?)
            .map_err(|_| "CLI_DAEMON_RUNTIME_INVALID")?;
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        "unsupported"
    };
    if m.protocol_version != PROTOCOL
        || m.platform != platform
        || m.arch != arch
        || !is_hash(&m.build_id)
        || m.version.len() > 64
        || m.node_version.len() > 64
        || m.files.len() > 2000
        || m.files.is_empty()
        || !m.files.contains_key("bin/onethu.mjs")
        || !m.files.contains_key("dist/sdk/index.mjs")
        || !m.files.contains_key("node.gz")
        || !is_hash(&m.node_sha256)
    {
        return Err("CLI_DAEMON_RUNTIME_INCOMPATIBLE".into());
    }
    for (file, digest) in &m.files {
        crate::native_security::relative_path(file)?;
        if !is_hash(digest) {
            return Err("CLI_DAEMON_RUNTIME_INVALID".into());
        }
    }
    Ok(m)
}
fn resource_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = install_dir(app)?;
    let installed = manifest(&dir).map_err(|_| "CLI_PACKAGE_NOT_INSTALLED")?;
    if installed.version != app.package_info().version.to_string() { return Err("CLI_PACKAGE_UPDATE_REQUIRED".into()); }
    Ok(dir)
}

pub(crate) async fn rpc(
    access: &Access,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let body =
        serde_json::to_vec(&json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
            .map_err(|_| "CLI_DAEMON_INVALID_REQUEST")?;
    if body.len() > MAX_REQUEST {
        return Err("CLI_DAEMON_REQUEST_TOO_LARGE".into());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(timeout)
        .build()
        .map_err(|_| "CLI_DAEMON_UNAVAILABLE")?;
    let mut response = client
        .post(format!("http://127.0.0.1:{}/cli/v1", access.port))
        .bearer_auth(&access.token)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "CLI_DAEMON_UNAVAILABLE")?;
    if response.status() != reqwest::StatusCode::OK {
        return Err("CLI_DAEMON_REQUEST_REJECTED".into());
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE as u64)
    {
        return Err("CLI_DAEMON_RESPONSE_TOO_LARGE".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "CLI_DAEMON_CONNECTION_INTERRUPTED")?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err("CLI_DAEMON_RESPONSE_TOO_LARGE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "CLI_DAEMON_INVALID_RESPONSE")?;
    if value.get("id").and_then(Value::as_u64) != Some(id)
        || value.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
    {
        return Err("CLI_DAEMON_INVALID_RESPONSE".into());
    }
    if let Some(error) = value.get("error") {
        // Only machine-readable safe codes leave this boundary. Remote error
        // messages could accidentally contain session or service credentials.
        let code = error
            .pointer("/data/code")
            .and_then(Value::as_str)
            .filter(|s| {
                s.len() <= 100
                    && s.bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            })
            .unwrap_or("CLI_DAEMON_REQUEST_FAILED");
        return Err(code.into());
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| "CLI_DAEMON_INVALID_RESPONSE".into())
}
fn compatible(status: &Value) -> bool {
    status.get("running").and_then(Value::as_bool) == Some(true)
        && status.get("desktopProtocolVersion").and_then(Value::as_u64) == Some(PROTOCOL)
}
pub(crate) fn process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid as i32, 0) == 0
                || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
        }
    }
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        unsafe {
            match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                Ok(handle) => {
                    let mut code = 259;
                    let result = GetExitCodeProcess(handle, &mut code);
                    let _ = CloseHandle(handle);
                    result.is_err() || code == 259
                }
                // ERROR_INVALID_PARAMETER means no process with this PID;
                // access-denied is treated as live, never as an upgrade signal.
                Err(error) => error.code().0 != 0x80070057u32 as i32,
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        true
    }
}
fn public_status(status: &Value) -> Value {
    json!({"running":true,"protocolVersion":PROTOCOL,"version":status.get("version"),"pid":status.get("pid"),"runtimeId":status.get("runtimeId")})
}
fn version_parts(value: &str) -> Option<[u64; 4]> {
    let (base, fix) = match value.split_once("-fix-") {
        Some((base, fix)) => (base, fix.parse::<u64>().ok()?),
        None => (value, 0),
    };
    let mut parts: Vec<_> = base
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<_, _>>()
        .ok()?;
    if parts.len() != 3 {
        return None;
    }
    parts.push(fix);
    parts.try_into().ok()
}
fn later_version(status: &Value, bundled: &Manifest) -> bool {
    match (
        status
            .get("version")
            .and_then(Value::as_str)
            .and_then(version_parts),
        version_parts(&bundled.version),
    ) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

pub(crate) fn private_directory(dir: &Path) -> Result<(), String> {
    reject_link(dir)?;
    fs::create_dir_all(dir).map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")?;
    }
    Ok(())
}
pub(crate) fn install_runtime(source: &Path, target: &Path, m: &Manifest) -> Result<(), String> {
    let parent = target.parent().ok_or("CLI_DAEMON_INSTALL_UNAVAILABLE")?;
    // Check every existing component under the user's trusted home/AppData.
    for ancestor in parent.ancestors().take_while(|p| p.parent().is_some()) {
        reject_link(ancestor)?;
    }
    reject_link(target)?;
    fs::create_dir_all(parent).map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")?;
    let stamp = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let staging = parent.join(format!(".onethu-cli-stage-{}-{stamp}", std::process::id()));
    let backup = parent.join(format!(
        ".onethu-cli-previous-{}-{stamp}",
        std::process::id()
    ));
    fs::create_dir(&staging).map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")?;
    private_directory(&staging)?;
    let result = (|| {
        for (relative, expected) in &m.files {
            let rel = crate::native_security::relative_path(relative)?;
            let src = crate::native_security::confined_path(source, &rel)?;
            let mut bytes = Vec::new();
            regular_file(&src, 256 * 1024 * 1024, false)?
                .take(256 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "CLI_DAEMON_RUNTIME_UNAVAILABLE")?;
            if hash(&bytes) != *expected {
                return Err("CLI_DAEMON_RUNTIME_CHECKSUM_FAILED".into());
            }
            let dest = if relative == "node.gz" {
                let mut decoded = Vec::new();
                flate2::read::GzDecoder::new(&bytes[..])
                    .take(256 * 1024 * 1024 + 1)
                    .read_to_end(&mut decoded)
                    .map_err(|_| "CLI_DAEMON_RUNTIME_INVALID")?;
                if decoded.len() > 256 * 1024 * 1024 || hash(&decoded) != m.node_sha256 {
                    return Err("CLI_DAEMON_RUNTIME_CHECKSUM_FAILED".into());
                }
                bytes = decoded;
                staging.join(if cfg!(windows) { "node.exe" } else { "node" })
            } else {
                staging.join(rel)
            };
            private_directory(dest.parent().ok_or("CLI_DAEMON_INSTALL_UNAVAILABLE")?)?;
            crate::native_security::private_atomic_write(&dest, &bytes)?;
        }
        let metadata =
            fs::read(source.join("runtime.json")).map_err(|_| "CLI_DAEMON_RUNTIME_UNAVAILABLE")?;
        crate::native_security::private_atomic_write(&staging.join("runtime.json"), &metadata)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(staging.join("node"), fs::Permissions::from_mode(0o700))
                .map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")?;
        }
        let existed = target.exists();
        if existed {
            fs::rename(target, &backup).map_err(|_| "CLI_DAEMON_INSTALL_BUSY")?;
        }
        if fs::rename(&staging, target).is_err() {
            if existed {
                let _ = fs::rename(&backup, target);
            }
            return Err("CLI_DAEMON_INSTALL_UNAVAILABLE".into());
        }
        if existed {
            let _ = fs::remove_dir_all(&backup);
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(staging);
    }
    result
}
fn startup_error(profile: &Path) -> String {
    let mut data = String::new();
    if let Ok(file) = regular_file(&profile.join("daemon-startup.log"), 65536, true) {
        let _ = file.take(65536).read_to_string(&mut data);
    }
    let code = data.lines().find_map(|line| {
        let value: Value = serde_json::from_str(line).ok()?;
        let code = value.get("error")?.get("code")?.as_str()?;
        if (3..=80).contains(&code.len())
            && code
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        {
            Some(code.to_owned())
        } else {
            None
        }
    });
    code.map_or_else(
        || "CLI_DAEMON_START_FAILED".into(),
        |code| format!("CLI_DAEMON_START_FAILED: {code}"),
    )
}
fn spawn_daemon(dir: &Path, profile: &Path, runtime: &Manifest) -> Result<Arc<AtomicBool>, String> {
    // GUI data can survive uninstall while the separately located CLI profile
    // is absent. Prepare it before opening any startup log or child process.
    private_directory(profile)?;
    // The child owns this private file handle after the App exits. A parent pipe
    // would break a resident process's stderr when its GUI host is closed.
    let log_path = profile.join("daemon-startup.log");
    crate::native_security::private_atomic_write(&log_path, b"")
        .map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")?;
    let log = OpenOptions::new()
        .append(true)
        .open(&log_path)
        .map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")?;
    let mut command = Command::new(dir.join(if cfg!(windows) { "node.exe" } else { "node" }));
    command
        .arg(dir.join("bin/onethu.mjs"))
        .args(["daemon", "serve", "--data-dir"])
        .arg(profile)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("ONETHU_ENDPOINT")
        .env("ONETHU_CLI_RUNTIME_ID", &runtime.build_id)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000008 | 0x00000200 | 0x08000000);
    }
    // std::process::Child has no kill-on-drop. A dedicated waiter reaps a child
    // exiting while the GUI remains open; closing the GUI leaves it resident.
    let mut child = command.spawn().map_err(|error| {
        crate::debug_log_line(&format!(
            "CLI daemon spawn failed; os_code={:?}",
            error.raw_os_error()
        ));
        "CLI_DAEMON_START_FAILED"
    })?;
    let exited = Arc::new(AtomicBool::new(false));
    let finished = exited.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        finished.store(true, Ordering::Release);
    });
    Ok(exited)
}

#[tauri::command]
pub async fn cli_daemon_ensure(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    main_only(window.label())?;
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Err("CLI_DAEMON_DESKTOP_REQUIRED".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _guard = ENSURE.lock().await;
        let profile = profile_dir(&app)?;
        // 首次运行时这个目录还不存在；下面 spawn 要先往 profile 里写 daemon-startup.log，
        // 目录缺失会让那次写入以 ENOENT 失败（Windows 上就是「系统找不到指定的路径」
        // os error 3），整条「确保守护进程」链路随之打回。登录流程在联网之前就要读共享
        // 运行时状态，于是新机器上的表现是「装好之后一直登不上」。这里先建目录。
        private_directory(&profile)?;
        // A separately downloaded CLI already using the standard account
        // profile is a valid host too; no duplicate managed install is needed.
        if let Some(access)=read_access(&profile)? {
            if let Ok(status)=rpc(&access,"daemon.status",Value::Null,Duration::from_secs(2)).await {
                if compatible(&status)&&status.get("version").and_then(Value::as_str)==Some(&app.package_info().version.to_string()) {return Ok(public_status(&status));}
            }
        }
        let source = resource_dir(&app)?;
        let bundled = manifest(&source)?;
        let target = install_dir(&app)?;
        if let Some(access) = read_access(&profile)? {
            match rpc(
                &access,
                "daemon.status",
                Value::Null,
                Duration::from_secs(3),
            )
            .await
            {
                Ok(status) => {
                    if compatible(&status)
                        && (status.get("runtimeId").and_then(Value::as_str)
                            == Some(&bundled.build_id)
                            || later_version(&status, &bundled))
                    {
                        return Ok(public_status(&status));
                    }
                    // Graceful stop waits for active tasks/atomic persistence.
                    // No PID signal, deletion of profile files, or forced kill.
                    rpc(&access, "daemon.stop", Value::Null, Duration::from_secs(10)).await?;
                    let mut gone = false;
                    for _ in 0..200 {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        match read_access(&profile)? {
                            None if !process_alive(access.pid) => {
                                gone = true;
                                break;
                            }
                            Some(current)
                                if current.pid != access.pid || current.token != access.token =>
                            {
                                return Err("CLI_DAEMON_RESTART_RACE".into())
                            }
                            _ => (),
                        }
                    }
                    if !gone {
                        return Err("CLI_DAEMON_SHUTDOWN_PENDING".into());
                    }
                }
                Err(error) if error == "CLI_DAEMON_UNAVAILABLE" && !process_alive(access.pid) => (),
                Err(error) => return Err(error),
            }
        }
        let install_needed =
            manifest(&target).map_or(true, |installed| installed.build_id != bundled.build_id);
        if install_needed {
            let (source, target, bundle) = (source.clone(), target.clone(), bundled.clone());
            tokio::task::spawn_blocking(move || install_runtime(&source, &target, &bundle))
                .await
                .map_err(|_| "CLI_DAEMON_INSTALL_UNAVAILABLE")??;
        }
        let exited = spawn_daemon(&target, &profile, &bundled)?;
        for _ in 0..150 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if exited.load(Ordering::Acquire) {
                let reason = startup_error(&profile);
                crate::debug_log_line(&reason);
                return Err(reason);
            }
            if let Some(access) = read_access(&profile)? {
                if let Ok(status) = rpc(
                    &access,
                    "daemon.status",
                    Value::Null,
                    Duration::from_secs(2),
                )
                .await
                {
                    if compatible(&status) {
                        return Ok(public_status(&status));
                    }
                    return Err("CLI_DAEMON_PROTOCOL_MISMATCH".into());
                }
            }
        }
        let reason = startup_error(&profile);
        crate::debug_log_line(&reason);
        Err(reason)
    }
}

#[tauri::command]
pub async fn cli_daemon_request(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    main_only(window.label())?;
    allow_method(&method)?;
    if method=="desktop.cloudSync" && params.as_ref().is_some_and(|value| !value.get("config").is_none_or(Value::is_null)) {
        crate::privacy_consent::require_cloud()?;crate::privacy_consent::require_oh()?;
    }
    if method=="desktop.yuketangSync" && params.as_ref().is_some_and(|value| !value.get("credential").is_none_or(Value::is_null)) {crate::privacy_consent::require_oh()?;}

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, params);
        return Err("CLI_DAEMON_DESKTOP_REQUIRED".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let access = read_access(&profile_dir(&app)?)?.ok_or("CLI_DAEMON_NOT_RUNNING")?;
        rpc(
            &access,
            &method,
            params.unwrap_or(Value::Null),
            Duration::from_secs(150),
        )
        .await
    }
}

#[cfg(windows)]
fn windows_private_acl(file: &File) -> Result<(), String> {
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
    use windows::Win32::Security::{
        EqualSid, GetAce, GetTokenInformation, IsWellKnownSid, TokenUser,
        WinBuiltinAdministratorsSid, WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL,
        DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
        TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|_| "CLI_DAEMON_PRIVATE_FILE_REQUIRED")?;
        let result = (|| {
            let mut size = 0;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size);
            // Aligned allocation for TOKEN_USER and its variable SID payload.
            let mut user =
                vec![0usize; (size as usize + size_of::<usize>() - 1) / size_of::<usize>()];
            GetTokenInformation(
                token,
                TokenUser,
                Some(user.as_mut_ptr().cast()),
                size,
                &mut size,
            )
            .map_err(|_| "CLI_DAEMON_PRIVATE_FILE_REQUIRED")?;
            let sid = (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid;
            let mut owner = PSID::default();
            let mut dacl: *mut ACL = std::ptr::null_mut();
            let mut descriptor = PSECURITY_DESCRIPTOR::default();
            GetSecurityInfo(
                HANDLE(file.as_raw_handle()),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                Some(&mut owner),
                None,
                Some(&mut dacl),
                None,
                Some(&mut descriptor),
            )
            .ok()
            .map_err(|_| "CLI_DAEMON_PRIVATE_FILE_REQUIRED")?;
            let check = (|| {
                EqualSid(owner, sid).map_err(|_| "CLI_DAEMON_PRIVATE_FILE_REQUIRED")?;
                if dacl.is_null() {
                    return Err("CLI_DAEMON_PRIVATE_FILE_REQUIRED".into());
                }
                for index in 0..(*dacl).AceCount {
                    let mut ace = std::ptr::null_mut();
                    GetAce(dacl, index as u32, &mut ace)
                        .map_err(|_| "CLI_DAEMON_PRIVATE_FILE_REQUIRED")?;
                    let header = &*ace.cast::<ACE_HEADER>();
                    if header.AceFlags & 8 != 0 {
                        continue;
                    } // inherit-only
                    if header.AceType == 0 {
                        // ACCESS_ALLOWED_ACE_TYPE
                        let allow = &*ace.cast::<ACCESS_ALLOWED_ACE>();
                        let allowed_sid = PSID((&allow.SidStart as *const u32).cast_mut().cast());
                        if EqualSid(allowed_sid, sid).is_err()
                            && !IsWellKnownSid(allowed_sid, WinLocalSystemSid).as_bool()
                            && !IsWellKnownSid(allowed_sid, WinBuiltinAdministratorsSid).as_bool()
                        {
                            return Err("CLI_DAEMON_PRIVATE_FILE_REQUIRED".into());
                        }
                    } else if header.AceType != 1 {
                        // deny ACEs are safe
                        return Err("CLI_DAEMON_PRIVATE_FILE_REQUIRED".into());
                    }
                }
                Ok(())
            })();
            let _ = LocalFree(Some(HLOCAL(descriptor.0)));
            check
        })();
        let _ = CloseHandle(token);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_hotfixes_sort_between_base_and_next_patch() {
        assert!(version_parts("0.11.4-fix-1") > version_parts("0.11.4"));
        assert!(version_parts("0.11.4-fix-2") > version_parts("0.11.4-fix-1"));
        assert!(version_parts("0.11.5") > version_parts("0.11.4-fix-2"));
        assert!(version_parts("0.11.4-fix-x").is_none());
    }
    #[test]
    fn startup_diagnostics_only_surface_structured_safe_codes() {
        let dir = std::env::temp_dir().join(format!(
            "onethu-startup-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        private_directory(&dir).unwrap();
        let file = dir.join("daemon-startup.log");
        for (body, expected) in [
            (
                r#"{"error":{"code":"CLI_STORAGE_ACL_FAILED","message":"private details"}}"#,
                "CLI_DAEMON_START_FAILED: CLI_STORAGE_ACL_FAILED",
            ),
            ("unstructured private details", "CLI_DAEMON_START_FAILED"),
            (
                r#"{"error":{"code":"private value"}}"#,
                "CLI_DAEMON_START_FAILED",
            ),
        ] {
            crate::native_security::private_atomic_write(&file, body.as_bytes()).unwrap();
            assert_eq!(startup_error(&dir), expected);
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn command_surface_is_main_window_and_fixed_methods_only() {
        assert!(main_only("main").is_ok());
        for label in ["overlay", "plugin-test", "auth", ""] {
            assert!(main_only(label).is_err());
        }
        for method in METHODS {
            assert!(allow_method(method).is_ok());
        }
        for method in [
            "daemon.stop",
            "auth.login",
            "service/call",
            "exec",
            "desktop.exec",
        ] {
            assert!(allow_method(method).is_err());
        }
    }
    #[test]
    fn public_discovery_never_leaks_credentials_or_session() {
        let value = public_status(
            &json!({"pid":2,"version":"0.11.3","token":"secret","session":{"cookies":"private"},"desktopProtocolVersion":1}),
        );
        assert!(value.get("token").is_none());
        assert!(value.get("session").is_none());
        assert_eq!(value["protocolVersion"], 1);
    }
    #[test]
    fn strict_access_rejects_forged_discovery() {
        for value in [
            json!({"port":65536,"token":"a".repeat(64),"pid":1}),
            json!({"port":80,"token":"a".repeat(64),"pid":1,"host":"remote.invalid"}),
        ] {
            assert!(serde_json::from_value::<Access>(value).is_err());
        }
        assert!(!is_hash(&"A".repeat(64)));
        assert!(!is_hash("cookie"));
    }
    #[cfg(unix)]
    #[test]
    fn discovery_rejects_world_readable_files_and_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = std::env::temp_dir().join(format!(
            "onethu-daemon-boundary-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        private_directory(&dir).unwrap();
        let file = dir.join("daemon-access.json");
        fs::write(
            &file,
            serde_json::to_vec(&json!({"port":1234,"token":"a".repeat(64),"pid":42})).unwrap(),
        )
        .unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_access(&dir).is_err());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read_access(&dir).unwrap().unwrap().port, 1234);
        fs::rename(&file, dir.join("other")).unwrap();
        symlink(dir.join("other"), &file).unwrap();
        assert!(read_access(&dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn install_is_verified_before_replacing_the_existing_cli() {
        let dir = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "onethu-daemon-install-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
        let source = dir.join("bundle");
        let target = dir.join("installed");
        fs::create_dir_all(source.join("bin")).unwrap();
        fs::create_dir_all(source.join("dist/sdk")).unwrap();
        fs::create_dir_all(target.join("bin")).unwrap();
        fs::write(target.join("bin/onethu.mjs"), b"previous package").unwrap();
        let mut files = BTreeMap::new();
        for (name, content) in [
            ("bin/onethu.mjs", "new package"),
            ("dist/sdk/index.mjs", "sdk bundle"),
        ] {
            fs::write(source.join(name), content).unwrap();
            files.insert(name.to_owned(), hash(content.as_bytes()));
        }
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"test runtime").unwrap();
        let compressed = encoder.finish().unwrap();
        fs::write(source.join("node.gz"), &compressed).unwrap();
        files.insert("node.gz".into(), hash(&compressed));
        let m = Manifest {
            protocol_version: 1,
            version: "0.11.3".into(),
            platform: if cfg!(target_os = "macos") {
                "darwin"
            } else if cfg!(windows) {
                "win32"
            } else {
                "linux"
            }
            .into(),
            arch: if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "x64"
            }
            .into(),
            node_version: "v22.22.1".into(),
            node_sha256: hash(b"test runtime"),
            build_id: "a".repeat(64),
            files,
        };
        fs::write(
            source.join("runtime.json"),
            serde_json::to_vec(&json!({
                "protocolVersion":m.protocol_version,"version":m.version,"platform":m.platform,
                "arch":m.arch,"nodeVersion":m.node_version,"nodeSha256":m.node_sha256,"buildId":m.build_id,"files":m.files,
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(source.join("dist/sdk/index.mjs"), "corrupted bundle").unwrap();
        assert_eq!(
            install_runtime(&source, &target, &m).unwrap_err(),
            "CLI_DAEMON_RUNTIME_CHECKSUM_FAILED"
        );
        assert_eq!(
            fs::read_to_string(target.join("bin/onethu.mjs")).unwrap(),
            "previous package"
        );
        fs::write(source.join("dist/sdk/index.mjs"), "sdk bundle").unwrap();
        install_runtime(&source, &target, &m).unwrap();
        assert_eq!(
            fs::read_to_string(target.join("bin/onethu.mjs")).unwrap(),
            "new package"
        );
        assert_eq!(manifest(&target).unwrap().build_id, m.build_id);
        assert_eq!(
            fs::read(target.join(if cfg!(windows) { "node.exe" } else { "node" })).unwrap(),
            b"test runtime"
        );
        let mut unsafe_manifest = m.clone();
        unsafe_manifest
            .files
            .insert("../escape".into(), hash(b"escape"));
        assert!(install_runtime(&source, &target, &unsafe_manifest).is_err());
        assert!(!dir.join("escape").exists());
        assert_eq!(
            fs::read_to_string(target.join("bin/onethu.mjs")).unwrap(),
            "new package"
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn bridge_pins_loopback_and_validates_rpc_ids() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 8192];
            let n = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..n]);
            assert!(request.starts_with("POST /cli/v1 HTTP/1.1"));
            assert!(request
                .to_lowercase()
                .contains(&format!("authorization: bearer {}", "a".repeat(64))));
            let body = r#"{"jsonrpc":"2.0","id":0,"result":{"running":true}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let result = rpc(
            &Access {
                port,
                token: "a".repeat(64),
                pid: 1,
            },
            "desktop.status",
            Value::Null,
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(result.unwrap_err(), "CLI_DAEMON_INVALID_RESPONSE");
        server.join().unwrap();
    }
}
