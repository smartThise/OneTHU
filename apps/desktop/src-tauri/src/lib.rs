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
    /// 二进制响应体（UTF-8 非法时走此通道，body 为空字符串）——验证码图/发票 PDF
    /// 等二进制资源经字符串通道会被 lossy 解码损坏（0x89→U+FFFD 实证）
    body_b64: Option<String>,
}

/// 单次 HTTP 请求：不跟随重定向（由前端带着最新 Cookie 逐跳处理），
/// 显式透传请求头（含 Cookie —— 浏览器 fetch 的禁改头，这里无此限制）。
#[tauri::command]
fn log_debug(line: String) -> Result<(), String> {
    use std::io::Write;
    const LOG: &str = "/tmp/onethu-debug.log";
    // 体积闸门：超 16MB 轮转为 .old（防 HTML dump 类循环刷盘——曾灌到 1GB）
    if let Ok(meta) = std::fs::metadata(LOG) {
        if meta.len() > 16 * 1024 * 1024 {
            let _ = std::fs::rename(LOG, "/tmp/onethu-debug.log.old");
        }
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(LOG)
        .map_err(|e| e.to_string())?;
    let _ = writeln!(f, "{}", line);
    Ok(())
}

/* ---------------- 外链系统浏览器 ----------------
 * WebView 内 window.open / <a target=_blank> 均无效，必须交给系统默认浏览器。
 * 主通道是官方 opener 插件；open_external 是免 ACL 的自写兜底（插件异常时前端降级调用）。 */

/// 用系统默认程序打开 URL（平台分派：open / start / xdg-open）
#[cfg(target_os = "macos")]
fn spawn_system_open(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("调用系统 open 失败: {e}"))
}

#[cfg(target_os = "windows")]
fn spawn_system_open(url: &str) -> Result<(), String> {
    // start 的第一个引号参数是窗口标题，必须占位空串，否则 URL 被吞
    use std::os::windows::process::CommandExt; // creation_flags 仅 Windows 提供
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW，不闪控制台黑框
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("调用系统 start 失败: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_system_open(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("调用 xdg-open 失败: {e}"))
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "windows",
    all(unix, not(target_os = "macos"))
)))]
fn spawn_system_open(_url: &str) -> Result<(), String> {
    Err("当前平台不支持外部打开".into())
}

/// 兜底外链打开：Rust 侧再校验一次 scheme，仅放行 http/https
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("拒绝打开非 http(s) 链接: {url}"));
    }
    spawn_system_open(&url)
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

/// Content-Disposition 文件名解析：filename*=UTF-8''…（RFC 5987）优先，其次 filename=…
/// （learn 下载端点会回真名；mobile 未用此头但取 URL 真名等价，落盘名以服务器为准）。
fn parse_cd_filename(cd: &str) -> Option<String> {
    for part in cd.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("filename*=") {
            let mut seg = rest.splitn(3, '\'');
            let _charset = seg.next().unwrap_or("utf-8");
            let _lang = seg.next().unwrap_or("");
            if let Some(raw) = seg.next() {
                if let Some(decoded) = percent_decode(raw) {
                    if !decoded.is_empty() {
                        return Some(decoded);
                    }
                }
            }
        }
    }
    for part in cd.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("filename=") {
            let v = rest.trim().trim_matches('"');
            if !v.is_empty() {
                return Some(percent_decode(v).unwrap_or_else(|| v.to_string()));
            }
        }
    }
    None
}

/// 百分号解码（%XX → 字节；非法序列原样保留）
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok()?;
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

/// 带会话 Cookie 下载文件到 ~/Downloads（learn 直连；登录失效/空文件识别拒绝）。
/// 落盘名：响应 Content-Disposition 真名优先，其次调用方传入名（title.fileType）。
#[tauri::command]
async fn download_file(url: String, cookies: String, filename: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        // 全部目标域均为 *.tsinghua.edu.cn，直连即可：强制绕过系统代理（reqwest 0.12
        // 默认读 Windows/ macOS 系统代理，全局模式梯子会把清华流量送出境触发风控）。
        // 仅救系统代理场景；TUN 网络层接管无解（参考 PR #2，user-A100）。
        .no_proxy()
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
    let content_disposition = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("下载失败：文件内容为空（mobile 同款 bytesWritten==0 校验）".into());
    }
    // 登录失效/会话重定向中转页：状态码 200 但内容是 HTML 跳转页
    // （mobile fs.downloadFile：bytesWritten<100 且含 location.href → 失败）
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    let looks_html = head.starts_with("<!DOCTYPE") || head.starts_with("<!doctype") || head.starts_with("<html");
    let login_redirect = bytes.len() < 4096 && head.contains("location.href");
    if looks_html || login_redirect {
        return Err("会话已失效，需要重新登录".into());
    }
    // 落盘名：Content-Disposition 真名优先（服务器知道真实文件名），
    // 其次调用方名；服务端真名通常自带扩展名，不重复追加
    let name = content_disposition
        .as_deref()
        .and_then(parse_cd_filename)
        .filter(|n| !n.trim().is_empty())
        .unwrap_or(filename);
    let home = std::env::var("HOME").map_err(|_| "无法定位主目录")?;
    let dir = std::path::Path::new(&home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe_name: String = name
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
        .no_proxy() // 同 download_file：清华域直连，绕系统代理（参考 PR #2）
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
    if bytes.is_empty() {
        return Err("预览失败：文件内容为空".into());
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    let looks_html = head.starts_with("<!DOCTYPE") || head.starts_with("<!doctype") || head.starts_with("<html");
    let login_redirect = bytes.len() < 4096 && head.contains("location.href");
    if looks_html || login_redirect {
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
        // 主网络通道：全部目标域均为 *.tsinghua.edu.cn（webvpn/id/learn/info/card…），
        // 直连即可。reqwest 0.12 默认读 Windows/macOS 系统代理——全局模式梯子会把
        // 清华流量送出境：id 风控慢响应（转圈）、验证码与会话出口 IP 不一致（对码
        // 判错）、响应被代理拦截（点重发反而直接进入，#1 实录）。
        // ⚠️ 只救系统代理场景：TUN 模式在网络层接管，应用层无解（参考 PR #2）。
        .no_proxy()
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
    let body_bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {e}"))?;
    // 分流规则：文本类（text/*、html/json/xml）按 Content-Type charset 解码为字符串
    // （reqwest text() 原语义，gb2312 教务页依赖此通道）；其余（图片/PDF/流）且非合法
    // UTF-8 时走 base64 字节通道——字符串通道会把 0x89 等 lossy 成 U+FFFD 损坏二进制。
    let ctype = headers.get("content-type").cloned().unwrap_or_default();
    let looks_text = ctype.starts_with("text/")
        || ctype.contains("html")
        || ctype.contains("json")
        || ctype.contains("xml");
    let (body, body_b64) = if looks_text {
        // reqwest text() 原语义：按 Content-Type charset 解码（gb2312 教务页依赖），
        // 无 charset 或未知标签时回退 UTF-8 lossy
        let charset = ctype
            .split(';')
            .rev()
            .find_map(|part| {
                let part = part.trim();
                part.strip_prefix("charset=").map(|c| c.trim_matches('"').trim().to_string())
            });
        let decoded = match charset.as_deref().and_then(|c| encoding_rs::Encoding::for_label(c.as_bytes())) {
            Some(enc) => enc.decode(&body_bytes).0.into_owned(),
            None => String::from_utf8_lossy(&body_bytes).into_owned(),
        };
        (decoded, None)
    } else {
        match std::str::from_utf8(&body_bytes) {
            Ok(text) => (text.to_string(), None),
            Err(_) => {
                use base64::Engine as _;
                (String::new(), Some(base64::engine::general_purpose::STANDARD.encode(&body_bytes)))
            }
        }
    };

    Ok(HttpOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        set_cookies,
        url: input.url,
        body,
        body_b64,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
#[tauri::command]
fn open_eid_window(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<String, String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::WebviewUrl;
    let label = "eid";
    if app.get_webview_window(label).is_some() {
        return Ok("exists".into());
    }
    // 初始化脚本：登录表单存在时自动填账号密码；无图形验证码时自动提交。
    // sessionStorage 守卫防循环（登录后跳转的页面不再自动提交）。
    let script = format!(
        r#"(function() {{
  try {{
    if (window.__ONETHU_EID_DONE) return;
    function fill() {{
      var u = document.getElementById("username");
      var p = document.getElementById("password");
      if (!u || !p) return;
      window.__ONETHU_EID_DONE = true;
      function setv(el, v) {{
        var d = Object.getOwnPropertyDescriptor(el.__proto__, "value");
        d && d.set ? d.set.call(el, v) : (el.value = v);
        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
      }}
      setv(u, {u:?});
      setv(p, {p:?});
      var cap = document.getElementById("i_code");
      var capBox = cap && cap.offsetParent !== null;
      if (!capBox) {{
        setTimeout(function() {{
          var b = document.querySelector("button[onclick*='submitForm']");
          b && b.click();
        }}, 400);
      }}
    }}
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
    else fill();
    setTimeout(fill, 1200);
  }} catch (e) {{}}
}})();"#,
        u = username,
        p = password,
    );
    let win = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External("https://id.tsinghua.edu.cn/f/login".parse().unwrap()),
    )
    .title("清华电子身份 · 账户设置")
    .inner_size(430.0, 640.0)
    .initialization_script(&script)
    .build()
    .map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok("opened".into())
}


#[cfg(desktop)]
#[tauri::command]
fn open_sports_window(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::WebviewUrl;
    let label = "venueauth";
    if let Some(old) = app.get_webview_window(label) {
        let _ = old.close();
    }
    // 初始化脚本：轮询 localStorage.headers 里的 JWT（体育系统 SPA 登录成功后写入），
    // 拿到后写 document.title 标记（远程页面无 IPC 权限，title 是最稳的回传通道）。
    let script = r#"(function() {
  if (window.__ONETHU_VPOLL) return;
  window.__ONETHU_VPOLL = true;
  function poll() {
    try {
      var h = window.localStorage.getItem("headers");
      if (h) {
        var t = JSON.parse(h).token;
        if (t && t.length > 40) {
          document.title = "ONETHU_VTOKEN::" + t;
        }
      }
    } catch (e) {}
    setTimeout(poll, 500);
  }
  poll();
})();"#;
    let win = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External("https://www.sports.tsinghua.edu.cn/venue/index.html".parse().unwrap()),
    )
    .title("清华体育系统 · 登录授权")
    .inner_size(520.0, 720.0)
    .initialization_script(script)
    .build()
    .map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    // 轮询窗口标题，发现 token 标记 → emit "sports-token" → 关窗（最长 10 分钟）
    std::thread::spawn(move || {
        for _ in 0..600 {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let Some(w) = app.get_webview_window(label) else {
                return; // 用户已关窗
            };
            let title = w.title().unwrap_or_default();
            if let Some(token) = title.strip_prefix("ONETHU_VTOKEN::") {
                let token = token.to_string();
                let _ = w.close();
                use tauri::Emitter;
                let _ = app.emit("sports-token", token);
                return;
            }
        }
    });
    Ok("opened".into())
}

#[cfg(mobile)]
#[tauri::command]
fn open_eid_window(_app: tauri::AppHandle, _username: String, _password: String) -> Result<String, String> {
    // 移动端无多窗口：前端捕获本错误后改用 opener 跳系统浏览器
    Err("移动端请在系统浏览器打开电子身份".into())
}

/* 体育官方预约已改为主窗口 tab 内 iframe（URL ?token= 携带 JWT，官方 SPA
 * 开机即认的 SSO 载体），不再需要独立弹窗命令——独立窗注入 localStorage.headers
 * 对官方 SPA 无效（它开机只读 URL 参数），已删除。 */

/* ---------------- 体育官方页本地反代（venueview://） ----------------
 * 官方站响应带 x-frame-options: SAMEORIGIN，iframe 直嵌 https 会被拦成白屏
 * （实测）。本协议做透明管道：venueview://localhost/<path><query> →
 * https://www.sports.tsinghua.edu.cn<path><query>，原样转交官方页自己发出的
 * 全部请求（预约点击仍是用户在官方页面上手动完成），响应剥掉 XFO/CSP 等
 * 阻止内嵌的头。仅限该一个主机，不作任意代理原语。第 12 条红线不变。 */
const VENUE_ORIGIN: &str = "https://www.sports.tsinghua.edu.cn";

/// venueview 反代留痕（与 log_debug 同文件，便于一次点击全链路取证）
fn venue_log(msg: &str) {
    use std::io::Write;
    const LOG: &str = "/tmp/onethu-debug.log";
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(LOG) {
        let _ = writeln!(f, "{} | [VENUEVIEW] {}", chrono_now(), msg);
    }
}

/// 场馆内嵌页 SSO token（前端开 iframe 前推给 Rust；反代对每个 HTML 文档
/// 注入——自定义协议源的 localStorage 不可靠（实测写入不保活），改为每个
/// 文档开机前都重写登录态，页面无论怎么自跳转都有登录态）。
pub type VenueSsoState = std::sync::Mutex<Option<String>>;

#[tauri::command]
fn venue_sso_set(
    state: tauri::State<'_, VenueSsoState>,
    token: String,
) -> Result<(), String> {
    *state.lock().map_err(|e| e.to_string())? = Some(token);
    Ok(())
}

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
        .to_string()
}

async fn venue_proxy_fetch(
    sso: Option<String>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::header::CONTENT_TYPE;
    let upstream_err = |msg: String| {
        tauri::http::Response::builder()
            .status(502)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(msg.into_bytes())
            .unwrap_or_else(|_| tauri::http::Response::new(b"venue proxy error".to_vec()))
    };
    let pq = request
        .uri()
        .path_and_query()
        .map(|x| x.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    venue_log(&format!("REQ {} {}", request.method(), pq));
    // 页面请求 query 里的 ?token=<JWT>：官方 SPA 开机从 localStorage["token"]
    // 读登录态（getParams→storage.getItem；?token= 本身并不被启动逻辑解析）。
    // 注入源优先取 Rust 状态（venue_sso_set，前端开 iframe 前推送），兼容 query。
    let sso_token: Option<String> = sso.or_else(|| {
        request.uri().query().and_then(|q| {
            q.split('&').find_map(|kv| {
                let (k, v) = kv.split_once('=')?;
                (k == "token" && v.len() > 20).then(|| v.to_string())
            })
        })
    });
    let url = format!("{VENUE_ORIGIN}{pq}");
    let method = request.method().clone();
    let client = match reqwest::Client::builder()
        // 主网络通道同 http_request：清华域直连，禁系统代理（#1 风控实录）
        .no_proxy()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => return upstream_err(format!("proxy client: {e}")),
    };
    let mut req = client
        .request(method, &url)
        .header("origin", VENUE_ORIGIN)
        .header("referer", format!("{VENUE_ORIGIN}/venue/index.html"));
    for (k, v) in request.headers() {
        let lower = k.as_str().to_lowercase();
        if matches!(
            lower.as_str(),
            "content-type" | "accept" | "accept-language" | "cookie" | "user-agent"
        ) {
            if let Ok(vs) = v.to_str() {
                req = req.header(k.clone(), vs);
            }
        }
    }
    let body = request.into_body();
    if !body.is_empty() {
        req = req.body(body);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            venue_log(&format!("ERR upstream {e} {pq}"));
            return upstream_err(format!("upstream: {e}"));
        }
    };
    let status = resp.status();
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "application/octet-stream".into());
    match resp.bytes().await {
        Ok(b) => {
            let mut body = b.to_vec();
            // HTML 文档 + 带 SSO token：在 <head> 后注入 localStorage 预置脚本
            // （严格镜像官方 SET_TOKEN 的存储格式：token 存 JSON 字符串、
            // headers 存「字符串化的 JSON 对象」再整体 JSON 字符串化）
            let mut injected = false;
            if ct.starts_with("text/html") {
                // 剥离页面内 CSP meta（若官方模板自带，会拦掉我们的内联预置脚本）
                if let Some(rel) = body.windows(9).position(|w| w.eq_ignore_ascii_case(b"http-equiv")) {
                    let start = body[..rel].iter().rposition(|&b| b == b'<').unwrap_or(0);
                    let end = body[rel..]
                        .iter()
                        .position(|&b| b == b'>')
                        .map(|p| rel + p + 1)
                        .unwrap_or(body.len());
                    let tag = String::from_utf8_lossy(&body[start..end]).to_lowercase();
                    if tag.contains("content-security-policy") {
                        body.copy_within(end.., start);
                        body.truncate(body.len() - (end - start));
                        venue_log("STRIP csp meta");
                    }
                }
                if let Some(jwt) = &sso_token {
                    // 预置登录态 + 探针：写完自读，回执走 /venue/index.html?__probe=…
                    let script = format!(
                        r#"<script>(function(){{var t="{jwt}";var ok=0,err="";try{{localStorage.setItem("token",JSON.stringify(t));localStorage.setItem("headers",JSON.stringify(JSON.stringify({{token:t}})));ok=localStorage.getItem("token")===JSON.stringify(t)?1:0;}}catch(e){{err=String(e);}}try{{new Image().src="/venue/index.html?__probe=1&ok="+ok+"&err="+encodeURIComponent(err)+"&ts="+Date.now();}}catch(e){{}}}})();</script>"#
                    );
                    let bytes = script.as_bytes();
                    let head_pos = body
                        .windows(6)
                        .position(|w| w.eq_ignore_ascii_case(b"<head>"))
                        .map(|p| p + 6)
                        .unwrap_or(0);
                    let mut out = Vec::with_capacity(body.len() + bytes.len());
                    out.extend_from_slice(&body[..head_pos]);
                    out.extend_from_slice(bytes);
                    out.extend_from_slice(&body[head_pos..]);
                    body = out;
                    injected = true;
                }
            }
            venue_log(&format!(
                "RSP {} {} ct={} len={} inject={} tok={}",
                status,
                pq,
                ct,
                body.len(),
                injected,
                sso_token.is_some()
            ));
            tauri::http::Response::builder()
                .status(status)
                .header(CONTENT_TYPE, ct)
                .header("access-control-allow-origin", "*")
                .body(body)
                .unwrap_or_else(|_| tauri::http::Response::new(b"venue proxy error".to_vec()))
        }
        Err(e) => upstream_err(format!("upstream body: {e}")),
    }
}

#[cfg(mobile)]
#[tauri::command]
fn open_sports_window(_: tauri::AppHandle) -> Result<String, String> {
    Err("场馆登录多窗口仅桌面端可用".into())
}

tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(std::sync::Mutex::new(None::<String>) as VenueSsoState)
        .register_asynchronous_uri_scheme_protocol("venueview", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let sso = app
                    .state::<VenueSsoState>()
                    .lock()
                    .ok()
                    .and_then(|g| g.clone());
                responder.respond(venue_proxy_fetch(sso, request).await);
            });
        })
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
            log_debug,http_request,download_file,fetch_binary,state_read,state_write,state_delete,
            open_external,open_eid_window,open_sports_window,venue_sso_set])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
