//! OneTHU Android 系统桥（App 内部经 run_mobile_plugin 直调，不走 JS IPC）。
//!
//! - saveDownload：应用沙盒文件 → 系统「下载」（API 29+ MediaStore；
//!   旧机型回退公共 Downloads 直写）。主 crate 的 seafile_download / download_file
//!   在 Android 上先写 cacheDir 再经此桥转存，前端拿到的即用户可见的系统下载。
//! - openIntent：intent:// 深链（地图导航直跳高德/腾讯/百度 App），
//!   Intent.parseUri + browser_fallback_url 网页兜底。
//!
//! 桌面端无此桥——主 crate 相关调用全部 cfg(target_os = "android") 隔离。

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

pub mod commands;

/// Android 插件句柄包装（newtype：app.state 按类型取，裸 PluginHandle 会与其他插件撞类型）
pub struct OnethuMobile<R: Runtime>(pub tauri::plugin::PluginHandle<R>);

impl<R: Runtime> Clone for OnethuMobile<R> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("onethu-mobile")
        .invoke_handler(tauri::generate_handler![
            commands::mobile_supported,
        ])
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            let _ = (&app, &api);
            // Android：注册 Kotlin 插件（app.onethu.mobile.OnethuMobilePlugin）
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("app.onethu.mobile", "OnethuMobilePlugin")?;
                app.manage(OnethuMobile(handle));
            }
            Ok(())
        })
        .build()
}
