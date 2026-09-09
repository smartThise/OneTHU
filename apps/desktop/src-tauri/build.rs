fn main() {
    // 寻迹：高德 Web 服务 key 编译期注入（先于 tauri_build，产物进 OUT_DIR）。
    // 优先级：环境变量 TRACE_AMAP_KEY > src-tauri/.env（gitignore，见 .env.example）。
    // 都没有 → 占位值（app 显示「未配置」横幅，不打接口）。
    println!("cargo:rerun-if-env-changed=TRACE_AMAP_KEY");
    println!("cargo:rerun-if-changed=.env");
    emit_trace_key_rs(&trace_key_from_env());

    // 寻迹：macOS 原生定位桥（tauri-plugin-geolocation 桌面端是返回 (0,0) 的 stub）
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-framework=CoreLocation");
        println!("cargo:rustc-link-framework=Foundation");
        cc::Build::new()
            .file("native/location.m")
            .flag("-fobjc-arc")
            .compile("onethu_location");
    }

    tauri_build::build()
}

fn is_amap_key(k: &str) -> bool {
    k.len() == 32 && k.chars().all(|c| c.is_ascii_hexdigit())
}

const PLACEHOLDER: &str = "0000000000000000000000000000dead";

fn trace_key_from_env() -> String {
    if let Ok(k) = std::env::var("TRACE_AMAP_KEY") {
        if is_amap_key(&k) {
            return k;
        }
    }
    // build script 的 cwd = 包根（src-tauri/），相对路径读 .env
    if let Ok(text) = std::fs::read_to_string(".env") {
        for line in text.lines() {
            let line = line.trim();
            if let Some(v) = line.strip_prefix("TRACE_AMAP_KEY=") {
                let v = v.trim().trim_matches('"').trim_matches('\'');
                if is_amap_key(v) {
                    return v.to_string();
                }
            }
        }
    }
    PLACEHOLDER.to_string()
}

/// key → OUT_DIR/trace_key.rs（每字符 XOR 0x5A 存 hex 分段；
/// 与 lib.rs trace_key() 的解码互逆。源码/仓库/JS bundle 零明文。）
fn emit_trace_key_rs(key: &str) {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR 未提供");
    let segs: Vec<String> = key.chars().map(|c| format!("{:02x}", (c as u8) ^ 0x5a)).collect();
    let body = format!(
        "// @generated：build.rs 从 TRACE_AMAP_KEY（env 或 .env）编译期生成，勿手改。\nconst TRACE_KEY_OBF: [&str; 32] = [{}];\n",
        segs.iter().map(|s| format!("\"{s}\",")).collect::<Vec<_>>().join(" ")
    );
    std::fs::write(format!("{out_dir}/trace_key.rs"), body).expect("写入 trace_key.rs 失败");
}
