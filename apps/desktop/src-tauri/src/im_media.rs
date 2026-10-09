//! IM 媒体落地：下载（可带鉴权头）→ 可选微信 CDN 解密（AES-128-ECB + PKCS7）
//! → 写临时文件并返回绝对路径（交给 seafile 上传命令）。
//!
//! 微信 CDN 媒体是加密的（见 Tencent/openclaw-weixin cdn/pic-decrypt.ts）：
//! aes_key 有两种编码——base64(16 原始字节) 或 base64(32 位 hex 字符串)；
//! 算法 AES-128-ECB + PKCS7。WebCrypto 无 ECB，故解密放本地 Rust。
use aes::cipher::{BlockDecrypt, KeyInit, generic_array::GenericArray};
use base64::Engine as _;

/// 文件名安全化（防路径注入：只留基名 + 替换非法字符）
fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let t = cleaned.trim().trim_matches('.').to_string();
    if t.is_empty() { "attachment.bin".into() } else { t }
}

/// 微信 CDN 解密：aes_key_b64 两种编码都支持
fn decrypt_wechat_cdn(data: Vec<u8>, key_b64: &str) -> Result<Vec<u8>, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(key_b64.trim())
        .map_err(|e| format!("aes_key base64 解码失败：{e}"))?;
    let key: Vec<u8> = if decoded.len() == 16 {
        decoded
    } else if decoded.len() == 32 && decoded.iter().all(|b| b.is_ascii_hexdigit()) {
        let s = String::from_utf8(decoded).map_err(|_| "aes_key hex 非法".to_string())?;
        (0..16)
            .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| e.to_string()))
            .collect::<Result<Vec<u8>, String>>()?
    } else {
        return Err(format!("aes_key 形态不支持（解码后 {} 字节）", decoded.len()));
    };
    if data.len() % 16 != 0 {
        return Err(format!("密文长度 {} 非 16 倍数（可能不是加密媒体）", data.len()));
    }
    let cipher = aes::Aes128::new(GenericArray::from_slice(&key));
    let mut buf = data;
    for chunk in buf.chunks_mut(16) {
        cipher.decrypt_block(GenericArray::from_mut_slice(chunk));
    }
    // PKCS7 unpad
    let pad = *buf.last().unwrap_or(&0) as usize;
    if pad == 0 || pad > 16 || pad > buf.len() {
        return Err(format!("PKCS7 填充非法（pad={pad}）"));
    }
    buf.truncate(buf.len() - pad);
    Ok(buf)
}

/// 下载（可带鉴权头）→ 可选解密 → 写临时文件，返回路径。
/// url：直链（微信 CDN full_url 或 cdn/download?encrypted_query_param=）；
/// headers：飞书资源下载所需的 Authorization 等；
/// aes_key_b64：微信加密媒体的 aes_key（不传=明文直存）。
#[tauri::command]
pub async fn im_fetch_media(
    url: String,
    headers: Option<Vec<(String, String)>>,
    aes_key_b64: Option<String>,
    file_name: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{e}"))?;
    let mut rb = client.get(&url);
    if let Some(hs) = headers {
        for (k, v) in hs {
            rb = rb.header(k, v);
        }
    }
    let resp = rb.send().await.map_err(|e| format!("下载失败：{e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("下载 HTTP {status}：{}", body.chars().take(160).collect::<String>()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读响应失败：{e}"))?.to_vec();
    let data = match aes_key_b64.as_deref() {
        Some(k) if !k.trim().is_empty() => decrypt_wechat_cdn(bytes, k)?,
        _ => bytes,
    };
    let dir = std::env::temp_dir().join("onethu-im-files");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建临时目录失败：{e}"))?;
    let path = dir.join(safe_name(&file_name));
    std::fs::write(&path, &data).map_err(|e| format!("写临时文件失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// 读文本类文件（预览/喂模型用；非文本/超大/读取失败返回 None，绝不猜测）。
/// clean=true 时做 HTML 净化（去 script/style/标签、解码常见实体、压缩空白）——
/// 否则 HTML 预览全是标签垃圾（用户实测反馈）。
#[tauri::command]
pub fn im_peek_text(path: String, max_len: Option<usize>, clean: Option<bool>) -> Option<String> {
    let limit = max_len.unwrap_or(400).min(60_000);
    let meta = std::fs::metadata(&path).ok()?;
    if meta.len() > 8 * 1024 * 1024 {
        return None; // >8MB 不读
    }
    let bytes = std::fs::read(&path).ok()?;
    let text = std::str::from_utf8(&bytes).ok()?;
    // 文本判定：控制字符占比低
    let ctrl = text.chars().filter(|c| c.is_control() && *c != '\n' && *c != '\r' && *c != '\t').count();
    if ctrl * 100 > text.chars().count().max(1) * 2 {
        return None;
    }
    let source = if clean.unwrap_or(false) { strip_html(text) } else { text.to_string() };
    let head: String = source.chars().take(limit).collect();
    Some(head.replace('\r', ""))
}

/// 轻量 HTML 净化：抽 <title>、去掉 script/style 块、去标签、解码常见实体、压空白
fn strip_html(html: &str) -> String {
    let mut out = String::new();
    // title 优先放最前（“这个文件是什么”通常就在 title 里）
    if let Some(t) = extract_between(html, "<title", "</title>") {
        let t = t.splitn(2, '>').nth(1).unwrap_or("").trim();
        if !t.is_empty() {
            out.push_str(&format!("【标题】{t}\n"));
        }
    }
    let lower = html.to_lowercase();
    let mut rest = String::with_capacity(html.len() / 2);
    let mut i = 0usize;
    let bytes = html.as_bytes();
    let _ = &lower;
    let mut skip_until: Option<&str> = None;
    while i < bytes.len() {
        if let Some(tag) = skip_until {
            if let Some(pos) = lower[i..].find(tag) {
                i += pos + tag.len();
                skip_until = None;
                continue;
            }
            break;
        }
        let c = bytes[i] as char;
        if c == '<' {
            // 跳过 <script>/<style> 整块
            for (open, close) in [("<script", "</script>"), ("<style", "</style>")] {
                if lower[i..].starts_with(open) {
                    skip_until = Some(close);
                    break;
                }
            }
            if skip_until.is_none() {
                // 普通标签：跳到 '>'
                if let Some(end) = html[i..].find('>') {
                    i += end + 1;
                    rest.push(' ');
                    continue;
                }
                break;
            }
            continue;
        }
        rest.push(html[i..].chars().next().unwrap_or(' '));
        i += rest.chars().last().map(|ch| ch.len_utf8()).unwrap_or(1);
    }
    let decoded = decode_entities(&rest);
    let collapsed: String = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if !collapsed.is_empty() {
        out.push_str(&collapsed);
    }
    out
}

fn extract_between<'a>(h: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let lo = h.to_lowercase();
    let s = lo.find(open)?;
    let e = lo[s..].find(close)? + s + close.len();
    Some(&h[s..e])
}

fn decode_entities(s: &str) -> String {
    let mut out = s
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&mdash;", "—")
        .replace("&hellip;", "…");
    // 数字实体 &#123; / &#x1F600;
    let mut result = String::with_capacity(out.len());
    let mut chars = out.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '&' {
            if let Some(rest) = out.get(i + 1..) {
                if let Some(end) = rest.find(';').filter(|e| *e <= 8) {
                    let body = &rest[..end];
                    let code = if let Some(hex) = body.strip_prefix("#x").or_else(|| body.strip_prefix("#X")) {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        body.strip_prefix('#').and_then(|d| d.parse::<u32>().ok())
                    };
                    if let Some(cp) = code.and_then(char::from_u32) {
                        result.push(cp);
                        for _ in 0..(end + 1) {
                            chars.next();
                        }
                        continue;
                    }
                }
            }
        }
        result.push(c);
    }
    out = result;
    out
}

/// 文件大小（字节；读取失败返回 None）
#[tauri::command]
pub fn im_stat_file(path: String) -> Option<u64> {
    std::fs::metadata(path).ok().map(|m| m.len())
}
