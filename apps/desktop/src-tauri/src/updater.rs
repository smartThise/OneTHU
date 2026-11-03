//! 应用更新——下载执行层（2026-10-12）。
//!
//! 分工：**清单获取、源选择、版本比较都在前端**（`lib/updater.ts`：主源 GitHub Releases 的
//! latest.json，备用/校内源清华云盘官方镜像分享链接，自动切换、不让用户挑）；本文件只管
//! 原生必须做的三件事：**把 URL 流式下载到本地 + 报进度 + 拉起系统安装页**。
//!
//! ## 红线
//! - **下载与安装必须由用户触发**：本文件不发起任何自主请求，只在被前端调用时干活；
//! - **绝不静默安装**：`updater_open_installer` 复核下载后只把系统安装器拉到前台；
//!   桌面走系统 opener，安卓走 FileProvider → ACTION_VIEW。
//! - **绝不删用户数据**：只写 `<cache_dir>/updates/`，失败/取消只删自己的 `.part`。
//!
//! ## 为什么落 cache_dir 而不是 app_data_dir（2026-10-11 实测要求）
//! 安卓安装要经宿主 FileProvider 把本地文件转成 `content://`，而宿主的
//! `res/xml/file_paths.xml` **只覆盖 `<cache-path path="."/>`** —— 落 app_data_dir
//! （`/data/data/<pkg>/files`）会让 `getUriForFile` 抛 IllegalArgumentException：
//! 安装包"下载成功但装不上"。故固定落 `cache_dir()/updates/`。
//!
//! 下载使用 reqwest Response::chunk（无需 stream feature）。2026-10-28 起支持多线程分段：
//! `update_download.rs` 先探测 Range/206/content-length，服务器不支持时自动回落单流；
//! 分片并发写临时文件后合并，取消/超限/哈希/原子 rename/CompletedDownloads 校验全部保留。
//! 每次下载独立取消票；只允许一个在途请求；错误、取消或未来被丢弃均清理自己的暂存目录。
//! SHA-256 只证明与清单一致，不等同发行者签名。本模块不实现前端资源热更新。

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
#[path = "update_download.rs"]
mod download;

pub const UPDATER_EVENT: &str = "onethu-updater://progress";
static DOWNLOADS: download::DownloadGate = download::DownloadGate::new();
static COMPLETED: download::CompletedDownloads = download::CompletedDownloads::new();

#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    url: String,
    file_name: String,
    expect_size: Option<u64>,
    expect_sha256: Option<String>,
    threads: Option<u32>,
) -> Result<serde_json::Value, String> {
    let permit = DOWNLOADS.begin()?;
    let dir = app
        .path()
        .cache_dir()
        .map_err(|e| format!("无法定位缓存目录：{e}"))?
        .join("updates");
    // 前端传 1..=16；缺省 8，越界在原生侧再夹紧一次，不会因为脏参数失败。
    let result = download::download(&dir, &url, &file_name, expect_size, expect_sha256.as_deref(), threads, &permit,
        |phase, received, total, path| {
            let percent = if total > 0 { (received as f64 * 100.0 / total as f64).min(100.0) } else { -1.0 };
            let _ = app.emit(UPDATER_EVENT, json!({ "phase": phase, "received": received, "total": total, "percent": percent, "path": path.to_string_lossy() }));
        }).await;
    if result.as_ref().is_err_and(|e| e.contains("已取消")) {
        let _ = app.emit(
            UPDATER_EVENT,
            json!({ "phase": "cancelled", "received": 0, "total": 0, "percent": -1 }),
        );
    }
    let result = result?;
    COMPLETED.remember(&result)?;
    let download_dir = result.path.parent().unwrap_or(&dir);
    Ok(
        json!({ "path": result.path.to_string_lossy(), "dir": download_dir.to_string_lossy(), "size": result.size, "sha256": result.sha256, "verified": result.verified }),
    )
}

#[tauri::command]
pub async fn updater_cancel_download() -> Result<(), String> {
    DOWNLOADS.cancel();
    Ok(())
}

/// 拉起系统安装页。**只拉起，不静默安装**：
/// - 安卓：经 onethu-mobile 插件的 `installApk`（FileProvider → `content://` → ACTION_VIEW
///   + application/vnd.android.package-archive），之后由 ROM 自己的安装确认页接手；
/// - 桌面：同样先复核本次已完成下载与文件哈希，再使用系统 opener。
/// 所有平台均不执行静默安装，不修改应用数据。
#[tauri::command]
pub async fn updater_open_installer(app: AppHandle, path: String) -> Result<(), String> {
    let root = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    let path = tauri::async_runtime::spawn_blocking(move || {
        COMPLETED.validate(&root, std::path::Path::new(&path))
    })
    .await
    .map_err(|_| "安装包检查任务失败")??;
    #[cfg(target_os = "android")]
    {
        if path
            .extension()
            .is_none_or(|ext| !ext.to_string_lossy().eq_ignore_ascii_case("apk"))
        {
            return Err("更新文件不是 APK".into());
        }
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        let _: serde_json::Value = handle
            .run_mobile_plugin("installApk", json!({ "path": path }))
            .map_err(|e| format!("拉起系统安装页失败：{e}（请确认已允许「安装未知应用」）"))?;
        Ok(())
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_opener::OpenerExt;
        let ext = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        let permitted = if cfg!(target_os = "macos") {
            ext == "dmg"
        } else if cfg!(target_os = "windows") {
            ["exe", "msi", "msix"].contains(&ext.as_str())
        } else {
            ["appimage", "deb", "rpm"].contains(&ext.as_str())
        };
        if !permitted {
            return Err("更新包格式与当前系统不匹配".into());
        }
        app.opener()
            .open_path(path.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|e| format!("拉起系统安装器失败：{e}"))
    }
    #[cfg(all(mobile, not(target_os = "android")))]
    {
        let _ = path;
        Err("当前平台不支持安装包升级，请使用系统应用商店".into())
    }
}
