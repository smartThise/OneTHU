//! 生成移动端胶水与 allow-* 权限文件（tauri-plugin 标准构建）
fn main() {
    let commands = &["supported", "request_permission", "sync", "remove_calendar"];
    let result = tauri_plugin::Builder::new(commands)
        .android_path("android")
        .try_build();
    if !(cfg!(docsrs) && std::env::var("TARGET").map(|t| t.contains("android")).unwrap_or(false)) {
        result.unwrap();
    }
}
