//! OneTHU 桌面壳 —— 网络层走 Rust（reqwest），前端零 CORS 限制。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tauri::Manager;

#[derive(Deserialize)]
struct HttpInput {
    url: String,
    #[serde(default = "default_method")]
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    /// 二进制请求体（base64）：FormData multipart 含文件时前端走此通道，
    /// 避免 UTF-8 字符串通道损坏字节流。
    #[serde(default)]
    body_b64: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".into()
}

#[derive(Serialize)]
struct HttpOutput {
    status: u16,
    status_text: String,
    /// 除 Set-Cookie 外的响应头（小写键）
    headers: HashMap<String, String>,
    /// Set-Cookie 单独回传（多值，顺序保留）
    set_cookies: Vec<String>,
    /// 最终 URL（跟随内部无重定向，此处即请求 URL）
    url: String,
    body: String,
}

/// 单次 HTTP 请求：不跟随重定向（由前端带着最新 Cookie 逐跳处理），
/// 显式透传请求头（含 Cookie —— 浏览器 fetch 的禁改头，这里无此限制）。
#[tauri::command]
fn log_debug(line: String) -> Result<(), String> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/onethu-debug.log")
        .map_err(|e| e.to_string())?;
    let _ = writeln!(f, "{}", line);
    Ok(())
}

/* ---------------- 本机状态文件（appData/state 下的 JSON 文件） ----------------
 * WKWebView 的 localStorage 会被系统驱逐/清空（会话状态时有时无的根源），
 * 会话快照与「记住密码」一律镜像到应用数据目录的普通文件，启动时优先
 * localStorage、缺失则从文件回灌。 */

fn state_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?
        .join("state");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建状态目录: {e}"))?;
    Ok(dir)
}

/// 文件名白名单化，防路径穿越
fn safe_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[tauri::command]
fn state_write(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    // 原子写：临时文件 + rename，强退/断电不留半截 JSON
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn state_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn state_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 带会话 Cookie 下载文件到 ~/Downloads（learn 直连；登录失效返回的 HTML 会被识别拒绝）
#[tauri::command]
async fn download_file(url: String, cookies: String, filename: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Cookie", cookies)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.starts_with(b"<!DOCTYPE") || bytes.starts_with(b"<html") {
        return Err("会话已失效，需要重新登录".into());
    }
    let home = std::env::var("HOME").map_err(|_| "无法定位主目录")?;
    let dir = std::path::Path::new(&home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe_name: String = filename
        .chars()
        .map(|c| if c == '/' || c == ':' { '_' } else { c })
        .collect();
    let path = dir.join(&safe_name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct BinaryOut {
    /// 响应 Content-Type（去掉参数，如 image/png）
    mime: String,
    /// 字节流 base64
    data: String,
}

/// 带会话 Cookie 抓取二进制资源（learn 正文图片等），base64 回传给前端转 dataURL。
/// webview 的 <img> 不携带应用会话 Cookie，直挂 learn 地址只会得到登录页/401。
#[tauri::command]
async fn fetch_binary(url: String, cookies: String) -> Result<BinaryOut, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Cookie", cookies)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.starts_with(b"<!DOCTYPE") || bytes.starts_with(b"<html") {
        return Err("会话已失效，需要重新登录".into());
    }
    use base64::Engine as _;
    Ok(BinaryOut {
        mime: if mime.is_empty() { "application/octet-stream".into() } else { mime },
        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

#[tauri::command]
async fn http_request(input: HttpInput) -> Result<HttpOutput, String> {
    let method: reqwest::Method = input
        .method
        .to_uppercase()
        .parse()
        .map_err(|e| format!("非法 HTTP 方法: {e}"))?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(input.timeout_ms.unwrap_or(20000)))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method, &input.url);
    for (k, v) in &input.headers {
        // 跳过宿主自动管理的头，避免重复/冲突
        let lower = k.to_lowercase();
        if matches!(lower.as_str(), "host" | "content-length") {
            continue;
        }
        req = req.header(k, v);
    }
    let body_bytes: Option<Vec<u8>> = if let Some(b64) = &input.body_b64 {
        use base64::Engine as _;
        Some(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("请求体 base64 解码失败: {e}"))?,
        )
    } else {
        input.body.clone().map(|s| s.into_bytes())
    };
    if let Some(b) = body_bytes {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| format!("网络错误: {e}"))?;
    let status = resp.status();
    let mut headers = HashMap::new();
    let mut set_cookies = Vec::new();
    for (name, value) in resp.headers().iter() {
        let v = value.to_str().unwrap_or("").to_string();
        if name.as_str().eq_ignore_ascii_case("set-cookie") {
            set_cookies.push(v);
        } else {
            headers.insert(name.as_str().to_lowercase(), v);
        }
    }
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;

    Ok(HttpOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        set_cookies,
        url: input.url,
        body,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::LogicalPosition;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_position(LogicalPosition::new(80.0, 60.0));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_debug,http_request,download_file,fetch_binary,state_read,state_write,state_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
