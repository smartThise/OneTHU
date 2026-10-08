//! MadModel 校外回环中继（2026-10-08）：OH 侧车（ureq，无 cookie 仓）在校外时把 LLM
//! 流量指向 `127.0.0.1:<port>/v1`，本模块把它转成「webvpn 包装域 + 原生 cookie 仓」。
//!
//! 为什么必须在应用进程里做：wengine 会话需要**完整 cookie 集**
//! （`refresh` / `heartbeat` / `wengine_vpn_ticket` / `show_*`），其活体只存在于
//! `NATIVE_JAR_ARC`——TS jar 里 `refresh=0`、票值也不同；把单张票注入 ureq 实测必被
//! 弹回登录页。复用 `NATIVE_CLIENT` 还顺带拿到与 webview 完全一致的 UA
//! （wengine 票绑定 UA 指纹）。
//!
//! 协议：极简 HTTP/1.1——每连接一次请求，响应以 chunked 流式回传（保住 OH 的流式输出）。
//! 只面向本机 OH：监听 127.0.0.1 随机端口，不做鉴权（本机回环，能力等价于应用自身）。

use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Mutex;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

static PORT: AtomicU16 = AtomicU16::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);
static UPSTREAM: Mutex<String> = Mutex::new(String::new());
static TASK: Mutex<Option<tauri::async_runtime::JoinHandle<()>>> = Mutex::new(None);

/// 启动中继（幂等）：已运行时只更新上游基址并返回既有端口。
#[tauri::command]
pub async fn madmodel_relay_start(upstream_base: String) -> Result<u16, String> {
    if RUNNING.load(Ordering::SeqCst) {
        *UPSTREAM.lock().unwrap() = upstream_base.clone();
        let p = PORT.load(Ordering::SeqCst);
        if p != 0 {
            return Ok(p);
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("中继监听失败：{e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *UPSTREAM.lock().unwrap() = upstream_base;
    PORT.store(port, Ordering::SeqCst);
    RUNNING.store(true, Ordering::SeqCst);
    let handle = tauri::async_runtime::spawn(async move {
        // 500ms 轮询停止标志，而不是等外部 abort 杀任务：停止时**不打断在途流**——
        // 宿主切回直连的那一刻，侧车可能正在流式对话，硬 abort 会让对端只看到
        // 「EOF 无任何输出」（2026-10-08 实测踩中）。
        loop {
            if !RUNNING.load(Ordering::SeqCst) {
                break;
            }
            match tokio::time::timeout(std::time::Duration::from_millis(500), listener.accept()).await {
                Ok(Ok((stream, _))) => {
                    tauri::async_runtime::spawn(async move {
                        let _ = serve(stream).await;
                    });
                }
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
    });
    *TASK.lock().unwrap() = Some(handle);
    Ok(port)
}

/// 停止中继（切回直连时调用）：只置停止标志。accept 循环在 500ms 内自行退出并关闭
/// 监听；已在转发中的连接（正在流式输出的那次对话）继续跑完，不被掐断。
#[tauri::command]
pub fn madmodel_relay_stop() -> Result<(), String> {
    RUNNING.store(false, Ordering::SeqCst);
    let _ = TASK.lock().unwrap().take();
    PORT.store(0, Ordering::SeqCst);
    Ok(())
}

async fn reply_error(stream: &mut tokio::net::TcpStream, status: u16, msg: &str) -> std::io::Result<()> {
    let body = format!("{{\"error\":{{\"message\":{}}}}}", json_string(msg));
    let head = format!(
        "HTTP/1.1 {status} Relay Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.flush().await
}

/// 极简 JSON 字符串转义（只用于错误回包，无第三方依赖）。
fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// 单连接：解析请求 → 经共享原生客户端转发 → chunked 流式回传。
async fn serve(mut stream: tokio::net::TcpStream) -> std::io::Result<()> {
    // ① 读请求头（1 字节粒度到 CRLFCRLF；上限 32KB 防呆）
    let mut head: Vec<u8> = Vec::with_capacity(2048);
    let mut byte = [0u8; 1];
    while head.len() < 32_768 {
        let n = stream.read(&mut byte).await?;
        if n == 0 {
            return Ok(());
        }
        head.push(byte[0]);
        if head.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let head_str = String::from_utf8_lossy(&head).to_string();
    let mut lines = head_str.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method_raw = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let mut content_length = 0usize;
    let mut authorization = String::new();
    let mut content_type = "application/json".to_string();
    for l in lines {
        let Some((k, v)) = l.split_once(':') else { continue };
        match k.trim().to_ascii_lowercase().as_str() {
            "content-length" => content_length = v.trim().parse().unwrap_or(0),
            "authorization" => authorization = v.trim().to_string(),
            "content-type" => content_type = v.trim().to_string(),
            _ => {}
        }
    }
    // ② 读请求体
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        stream.read_exact(&mut body).await?;
    }
    // ③ 组装上游 URL：宿主传 webvpnWrap(madmodel + "/v1")，侧车请求 /v1/chat/completions
    let upstream_base = UPSTREAM.lock().unwrap().clone();
    if upstream_base.is_empty() {
        return reply_error(&mut stream, 503, "中继未配置上游基址").await;
    }
    let suffix = path.strip_prefix("/v1").unwrap_or(path.as_str());
    let url = format!("{upstream_base}{suffix}");
    let method: reqwest::Method = method_raw.parse().unwrap_or(reqwest::Method::POST);
    let client = crate::NATIVE_CLIENT.read().unwrap().clone();
    let mut req = client
        .request(method, &url)
        .header("Content-Type", content_type);
    if !authorization.is_empty() {
        req = req.header("Authorization", authorization);
    }
    let mut resp = match req.body(body).send().await {
        Ok(r) => r,
        Err(e) => return reply_error(&mut stream, 502, &format!("中继转发失败：{e}")).await,
    };
    // ④ 上游体检：被弹回登录页（3xx / HTML 壳）给出明确错误，而不是把空壳透传给侧车
    // ——2026-10-08 校外实录：中继只透状态码、丢掉 Location，侧车看到空响应体，
    // 最终表现为「模型无任何输出」。
    let status = resp.status();
    let ctype = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    if status.is_redirection() || ctype.contains("text/html") {
        crate::debug_log_line(&format!(
            "[RELAY] 上游被弹回登录页：status={} ctype={} url={url}",
            status.as_u16(),
            ctype
        ));
        return reply_error(
            &mut stream,
            502,
            "webvpn 会话已失效：中继上游被弹回登录页（请重新登录清华账号后重试）",
        )
        .await;
    }
    crate::debug_log_line(&format!(
        "[RELAY] 转发 {} {} → {} {}",
        method_raw,
        path,
        status.as_u16(),
        ctype
    ));
    // ⑤ chunked 流式回传（保住 OH 的逐块渲染）
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or("OK"),
        ctype
    );
    stream.write_all(head.as_bytes()).await?;
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return reply_error(&mut stream, 502, &format!("中继读取中断：{e}")).await,
        };
        if chunk.is_empty() {
            continue;
        }
        stream.write_all(format!("{:x}\r\n", chunk.len()).as_bytes()).await?;
    stream.write_all(&chunk).await?;
        stream.write_all(b"\r\n").await?;
    }
    stream.write_all(b"0\r\n\r\n").await?;
    stream.flush().await
}

