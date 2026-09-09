fn main() {
    // 寻迹：高德 Web 服务 key 编译期注入（先于 tauri_build，产物进 OUT_DIR）。
    // 优先级：环境变量 TRACE_AMAP_KEY > src-tauri/.env（gitignore，见 .env.example）。
    // 都没有 → 占位值（app 显示「未配置」横幅，不打接口）。
    println!("cargo:rerun-if-env-changed=TRACE_AMAP_KEY");
    println!("cargo:rerun-if-changed=.env");
    emit_trace_key_rs(&trace_key_from_env());

    // 寻迹：macOS 原生定位桥（tauri-plugin-geolocation 桌面端是返回 (0,0) 的 stub）
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        // rerun-if 一旦出现（上面 .env 那两行），cargo 只盯声明过的文件——
        // 原生桥源码必须逐一登记，否则改 .m 不触发重编（stale 二进制静默
        // 上线；speech.m 实测踩中：符号数不变、cargo 秒过）。
        println!("cargo:rerun-if-changed=native/location.m");
        println!("cargo:rerun-if-changed=native/speech.m");
        println!("cargo:rustc-link-framework=CoreLocation");
        println!("cargo:rustc-link-framework=Foundation");
        cc::Build::new()
            .file("native/location.m")
            .flag("-fobjc-arc")
            .compile("onethu_location");
        cc::Build::new()
            .file("native/speech.m")
            .flag("-fobjc-arc")
            .compile("onethu_speech");

        // 新 clang 对 @available 生成 ___isPlatformVersionAtLeast 调用（定义在
        // libclang_rt.osx.a）；rustc 链接走 -nodefaultlibs 不自动带 clang_rt——
        // CI macos-latest 新镜像实测 undefined symbol 链接失败。显式链入
        // （本地 Xcode 由 SDK 兜住未暴露；显式链重复定义无害：按需拉取成员）。
        if let Ok(out) = std::process::Command::new("clang")
            .arg("-print-resource-dir")
            .output()
        {
            if out.status.success() {
                let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
                println!("cargo:rustc-link-search=native={dir}/lib/darwin");
                println!("cargo:rustc-link-lib=clang_rt.osx");
            }
        }
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
