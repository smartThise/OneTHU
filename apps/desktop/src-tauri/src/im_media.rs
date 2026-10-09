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
