//! 生成移动端胶水与 allow-* 权限文件（tauri-plugin 标准构建）
fn main() {
    // register_listener 是 Plugin 基类（Kotlin）的保留命令，不在 Rust invoke_handler 里，
    // 但前端 addPluginListener 要经 ACL 才能注册——照 core:app 的做法把它列进命令表，
    // 生成 allow-register-listener（b40 的 system-night-mode 事件靠它）。
    let commands = &["mobile_supported", "mobile_exit", "system_night_mode", "register_listener"];
    let result = tauri_plugin::Builder::new(commands)
        .android_path("android")
        .try_build();
    if !(cfg!(docsrs) && std::env::var("TARGET").map(|t| t.contains("android")).unwrap_or(false)) {
        result.unwrap();
    }
}
