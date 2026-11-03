//! Bounded, cancellable installer transport. A hash is integrity, not publisher authentication.
//!
//! ## 多线程分段下载（2026-10-28）
//! 1. 先发一个 `Range: bytes=0-0` 探测请求：
//!    - **206 + Content-Range** → 服务器支持分段，读总大小后按线程数切段并发下载；
//!    - **200 + Accept-Ranges 缺失/忽略 Range** → 服务器不支持分段，**自动回落单流**，
//!      并直接复用这次探测响应（不额外再请求）；
//!    - 206 但 Content-Range 缺总大小 / 段数算出来只有 1 → 也回落单流（重新发一次整包 GET）。
//! 2. 每个分片写自己的临时文件（`download.part.<n>`），全部到齐后**按序合并**成
//!    `download.part` 并同时算 SHA-256；大小、哈希、原子 rename、CompletedDownloads 校验
//!    全部沿用单流路径的红线，取消/超限/失败只清理本次暂存目录。
//! 3. `threads == 1` 时完全不发探测请求，保持旧单流行为。
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    io::{Read, Write},
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    task::Poll,
    time::Duration,
};

pub const MAX_DOWNLOAD: u64 = 1024 * 1024 * 1024;
pub const DEFAULT_THREADS: u32 = 8;
pub const MAX_THREADS: u32 = 16;
/// 分片小于这个体积时并发的收益抵不过探测/合并开销，直接单流。
const MIN_SEGMENT: u64 = 64 * 1024;
static NEXT_DOWNLOAD: AtomicU64 = AtomicU64::new(0);

/// 线程数归一化：None → 默认 8；越界夹到 1..=16（前端与原生两侧都做，越界不会出错）。
pub fn normalize_threads(threads: Option<u32>) -> usize {
    threads
        .map(|value| value.clamp(1, MAX_THREADS))
        .unwrap_or(DEFAULT_THREADS) as usize
}

#[derive(Default)]
pub struct DownloadGate(Mutex<Option<Arc<AtomicBool>>>);
pub struct DownloadPermit<'a> {
    gate: &'a DownloadGate,
    cancel: Arc<AtomicBool>,
}
impl DownloadGate {
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }
    pub fn begin(&self) -> Result<DownloadPermit<'_>, String> {
        let mut active = self.0.lock().map_err(|_| "下载状态不可用")?;
        if active.is_some() {
            return Err("已有更新包正在下载，请等待完成或取消后重试".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some(cancel.clone());
        Ok(DownloadPermit { gate: self, cancel })
    }
    pub fn cancel(&self) {
        if let Ok(active) = self.0.lock() {
            if let Some(token) = active.as_ref() {
                token.store(true, Ordering::SeqCst);
            }
        }
    }
}
impl Drop for DownloadPermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.gate.0.lock() {
            if active
                .as_ref()
                .is_some_and(|token| Arc::ptr_eq(token, &self.cancel))
            {
                *active = None;
            }
        }
    }
}
impl DownloadPermit<'_> {
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            Err("已取消下载".into())
        } else {
            Ok(())
        }
    }
    async fn wait<T>(&self, future: impl Future<Output = T>) -> Result<T, String> {
        self.check()?;
        tokio::pin!(future);
        loop {
            tokio::select! {
                biased;
                _ = tokio::time::sleep(Duration::from_millis(25)) => self.check()?,
                result = &mut future => { self.check()?; return Ok(result); }
            }
        }
    }
}

struct Staging {
    dir: PathBuf,
    keep: bool,
}
impl Drop for Staging {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}
pub struct Downloaded {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
    pub verified: bool,
}
/// Only a file this process actually finished downloading can reach the installer.
/// Keeps a bounded set; restarting the app requires downloading again.
pub struct CompletedDownloads(Mutex<Vec<(PathBuf, u64, String)>>);
impl CompletedDownloads {
    pub const fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }
    pub fn remember(&self, item: &Downloaded) -> Result<(), String> {
        let path = item.path.canonicalize().map_err(|_| "更新包已不可读")?;
        let mut entries = self.0.lock().map_err(|_| "更新记录不可用")?;
        entries.retain(|(old, _, _)| old != &path);
        entries.push((path, item.size, item.sha256.clone()));
        if entries.len() > 16 {
            entries.remove(0);
        }
        Ok(())
    }
    pub fn validate(&self, root: &Path, path: &Path) -> Result<PathBuf, String> {
        let path = installer_path(root, path)?;
        let (size, expected) = self
            .0
            .lock()
            .map_err(|_| "更新记录不可用")?
            .iter()
            .find(|(saved, _, _)| saved == &path)
            .map(|(_, size, hash)| (*size, hash.clone()))
            .ok_or("请先完成更新包下载，再打开安装器")?;
        let mut file = std::fs::File::open(&path).map_err(|_| "安装包无法读取，请重新下载")?;
        if file.metadata().map_err(|_| "安装包无法读取")?.len() != size {
            return Err("安装包下载后已改变，请重新下载".into());
        }
        let mut hasher = Sha256::new();
        let mut buffer = [0; 64 * 1024];
        loop {
            let n = file
                .read(&mut buffer)
                .map_err(|_| "安装包复核失败，请重新下载")?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        if format!("{:x}", hasher.finalize()) != expected {
            return Err("安装包下载后已改变，请重新下载".into());
        }
        Ok(path)
    }
}

fn safe_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || name.len() > 180
        || name.trim() != name
        || name.ends_with('.')
        || name == "."
        || name == ".."
        || name.eq_ignore_ascii_case("download.part")
        || name.starts_with("download.part.")
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
    {
        return Err("安装包文件名非法".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        return Err("安装包文件名为系统保留名称".into());
    }
    Ok(name)
}
fn expected_hash(hash: Option<&str>) -> Result<Option<String>, String> {
    hash.map(|value| {
        let value = value.trim();
        if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("更新清单 SHA-256 格式非法".into());
        }
        Ok(value.to_ascii_lowercase())
    })
    .transpose()
}
fn allowed_url(url: &url::Url, test_http: bool) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && (url.scheme() == "https"
            || (test_http && url.scheme() == "http" && url.host_str() == Some("127.0.0.1")))
}
fn client(test_http: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(25))
        .timeout(Duration::from_secs(300))
        .no_gzip()
        .no_brotli()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 8 {
                attempt.error("更新源跳转过多")
            } else if !allowed_url(attempt.url(), test_http) {
                attempt.error("更新包跳转必须使用 HTTPS 且不含凭据")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "无法初始化更新下载连接".into())
}

/// `Content-Range: bytes <start>-<end>/<total|*>` → (start, end, total?)；格式不符返回 None。
fn parse_content_range(
    value: Option<&reqwest::header::HeaderValue>,
) -> Option<(u64, u64, Option<u64>)> {
    let text = value?.to_str().ok()?.trim();
    let rest = text.strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = end.trim().parse().ok()?;
    if end < start {
        return None;
    }
    let total = if total.trim() == "*" {
        None
    } else {
        Some(total.trim().parse().ok()?)
    };
    Some((start, end, total))
}

async fn fetch(
    client: &reqwest::Client,
    address: &url::Url,
    range: Option<(u64, u64)>,
    permit: &DownloadPermit<'_>,
) -> Result<reqwest::Response, String> {
    let mut request = client
        .get(address.clone())
        .header("Accept-Encoding", "identity");
    if let Some((start, end)) = range {
        request = request.header("Range", format!("bytes={start}-{end}"));
    }
    permit
        .wait(request.send())
        .await?
        .map_err(|e| format!("连接更新源失败：{}", e.without_url()))
}

fn raw_encoding(response: &reqwest::Response) -> Result<(), String> {
    if response
        .headers()
        .get("content-encoding")
        .is_some_and(|value| value != "identity")
    {
        return Err("更新源返回了非原始安装包编码，已拒绝".into());
    }
    Ok(())
}

/// 单流：把整包响应流式写进 `download.part` 并算哈希，返回 (字节数, sha256)。
async fn stream_single(
    response: reqwest::Response,
    part_path: &Path,
    expected_size: Option<u64>,
    permit: &DownloadPermit<'_>,
    progress: &(impl Fn(&str, u64, u64, &Path) + Sync),
    final_path: &Path,
) -> Result<(u64, String), String> {
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!("更新源拒绝完整下载：HTTP {}", response.status()));
    }
    raw_encoding(&response)?;
    let length = response.content_length();
    if length.is_some_and(|n| n > MAX_DOWNLOAD) {
        return Err("更新包超过 1 GiB 限制".into());
    }
    if let (Some(expected), Some(actual)) = (expected_size, length) {
        if expected != actual {
            return Err(format!(
                "更新包大小不符：清单 {expected} 字节，响应 {actual} 字节"
            ));
        }
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(part_path)
        .map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let total = expected_size.or(length).unwrap_or(0);
    progress("download", received, total, final_path);
    let mut body = response;
    while let Some(chunk) = permit
        .wait(body.chunk())
        .await?
        .map_err(|e| format!("下载中断：{}", e.without_url()))?
    {
        received = received
            .checked_add(chunk.len() as u64)
            .ok_or("下载大小溢出")?;
        if received > expected_size.unwrap_or(MAX_DOWNLOAD).min(MAX_DOWNLOAD) {
            return Err("更新包超过预期大小，已丢弃".into());
        }
        file.write_all(&chunk)
            .map_err(|e| format!("写入更新包失败：{e}"))?;
        hasher.update(&chunk);
        progress("download", received, total, final_path);
    }
    permit.check()?;
    if received == 0 || expected_size.or(length).is_some_and(|n| n != received) {
        return Err("更新包为空或下载不完整，已丢弃".into());
    }
    file.flush()
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("更新包落盘失败：{e}"))?;
    drop(file);
    permit.check()?;
    Ok((received, format!("{:x}", hasher.finalize())))
}

/// 单个分片：Range GET → 校验 206/Content-Range/长度 → 写自己的临时文件。
#[allow(clippy::too_many_arguments)]
async fn download_segment(
    client: &reqwest::Client,
    address: &url::Url,
    start: u64,
    end: u64,
    path: &Path,
    total: u64,
    received: &AtomicU64,
    permit: &DownloadPermit<'_>,
    progress: &(impl Fn(&str, u64, u64, &Path) + Sync),
    final_path: &Path,
) -> Result<(), String> {
    let response = fetch(client, address, Some((start, end)), permit).await?;
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("更新源拒绝分段下载：HTTP {}", response.status()));
    }
    raw_encoding(&response)?;
    let expected_len = end - start + 1;
    if let Some(length) = response.content_length() {
        if length != expected_len {
            return Err("更新源分段长度不符，已丢弃".into());
        }
    }
    match parse_content_range(response.headers().get("content-range")) {
        Some((actual_start, actual_end, Some(actual_total)))
            if actual_start == start && actual_end == end && actual_total == total => {}
        Some(_) => return Err("更新源分段范围不符，已丢弃".into()),
        None => return Err("更新源缺少分段范围信息，已丢弃".into()),
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("创建分片临时文件失败：{e}"))?;
    let mut body = response;
    let mut written = 0u64;
    while let Some(chunk) = permit
        .wait(body.chunk())
        .await?
        .map_err(|e| format!("分段下载中断：{}", e.without_url()))?
    {
        written = written
            .checked_add(chunk.len() as u64)
            .ok_or("下载大小溢出")?;
        if written > expected_len {
            return Err("更新源分段超出预期大小，已丢弃".into());
        }
        file.write_all(&chunk)
            .map_err(|e| format!("写入更新包失败：{e}"))?;
        let done = received.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64;
        progress("download", done.min(total), total, final_path);
    }
    file.flush()
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("更新包落盘失败：{e}"))?;
    if written != expected_len {
        return Err("更新包分段不完整，已丢弃".into());
    }
    Ok(())
}

/// 同时在当前任务里轮询多个 future，全部完成后按原顺序返回。
/// （不 spawn：分片 future 借用 permit / 进度回调，且 ≤16 个，顺序轮询足够。）
async fn join_all<T>(mut futures: Vec<Pin<Box<dyn Future<Output = T> + Send + '_>>>) -> Vec<T> {
    let mut slots: Vec<Option<T>> = (0..futures.len()).map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut waiting = false;
        for (index, future) in futures.iter_mut().enumerate() {
            if slots[index].is_some() {
                continue;
            }
            match future.as_mut().poll(cx) {
                Poll::Ready(value) => slots[index] = Some(value),
                Poll::Pending => waiting = true,
            }
        }
        if waiting {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    })
    .await;
    slots
        .into_iter()
        .map(|slot| slot.expect("joined future"))
        .collect()
}

/// 按顺序合并分片 → `download.part`，同时算整包 SHA-256；成功后删掉分片。
fn merge_segments(
    shards: &[PathBuf],
    part_path: &Path,
    expected_total: u64,
    permit: &DownloadPermit<'_>,
) -> Result<String, String> {
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(part_path)
        .map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut merged = 0u64;
    for shard in shards {
        permit.check()?;
        let mut input =
            std::fs::File::open(shard).map_err(|e| format!("读取更新包分片失败：{e}"))?;
        loop {
            let n = input
                .read(&mut buffer)
                .map_err(|e| format!("读取更新包分片失败：{e}"))?;
            if n == 0 {
                break;
            }
            merged = merged.checked_add(n as u64).ok_or("下载大小溢出")?;
            if merged > expected_total {
                return Err("更新包分段合并后超出预期大小，已丢弃".into());
            }
            hasher.update(&buffer[..n]);
            output
                .write_all(&buffer[..n])
                .map_err(|e| format!("写入更新包失败：{e}"))?;
        }
        let _ = std::fs::remove_file(shard);
    }
    permit.check()?;
    if merged != expected_total {
        return Err("更新包分段合并后大小不符，已丢弃".into());
    }
    output
        .flush()
        .and_then(|_| output.sync_all())
        .map_err(|e| format!("更新包落盘失败：{e}"))?;
    drop(output);
    Ok(format!("{:x}", hasher.finalize()))
}

/// 提交：校验哈希后把 `download.part` 原子 rename 成最终文件，并保留暂存目录。
fn commit(
    staging: &mut Staging,
    part_path: &Path,
    final_path: &Path,
    received: u64,
    digest: String,
    expected_hash: Option<&String>,
) -> Result<Downloaded, String> {
    if expected_hash.is_some_and(|expected| expected != &digest) {
        return Err("更新包 SHA-256 校验不通过，已丢弃".into());
    }
    std::fs::rename(part_path, final_path).map_err(|e| format!("更新包提交失败：{e}"))?;
    staging.keep = true;
    Ok(Downloaded {
        path: final_path.to_path_buf(),
        size: received,
        sha256: digest,
        verified: expected_hash.is_some(),
    })
}

/// The loopback switch is private to offline unit tests; production always passes false.
#[allow(clippy::too_many_arguments)]
pub async fn download(
    root: &Path,
    url: &str,
    name: &str,
    size: Option<u64>,
    hash: Option<&str>,
    threads: Option<u32>,
    permit: &DownloadPermit<'_>,
    progress: impl Fn(&str, u64, u64, &Path) + Send + Sync,
) -> Result<Downloaded, String> {
    // 下载完成后统一补一帧 done：分段与单流都只在内部报 download 进度，
    // UI 的完成态依赖这一帧（旧单流路径在 rename 后直接 progress("done")）。
    let downloaded = download_inner(
        root, url, name, size, hash, permit, &progress, false, threads,
    )
    .await?;
    progress("done", downloaded.size, downloaded.size, &downloaded.path);
    Ok(downloaded)
}

#[allow(clippy::too_many_arguments)]
async fn download_inner(
    root: &Path,
    url: &str,
    name: &str,
    size: Option<u64>,
    hash: Option<&str>,
    permit: &DownloadPermit<'_>,
    progress: impl Fn(&str, u64, u64, &Path) + Send + Sync,
    test_http: bool,
    threads: Option<u32>,
) -> Result<Downloaded, String> {
    let name = safe_name(name)?;
    let hash = expected_hash(hash)?;
    if size.is_some_and(|n| n == 0 || n > MAX_DOWNLOAD) {
        return Err("更新包大小超出允许范围（1 GiB）".into());
    }
    let address = url::Url::parse(url).map_err(|_| "更新包地址非法")?;
    if !allowed_url(&address, test_http) {
        return Err("更新包地址必须使用 HTTPS 且不含凭据".into());
    }
    permit.check()?;
    std::fs::create_dir_all(root).map_err(|e| format!("创建更新目录失败：{e}"))?;
    let nonce = NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "系统时间错误")?
        .as_nanos();
    let dir = root.join(format!("{}-{stamp}-{nonce}", std::process::id()));
    std::fs::create_dir(&dir).map_err(|e| format!("创建下载临时目录失败：{e}"))?;
    let mut staging = Staging { dir, keep: false };
    let final_path = staging.dir.join(name);
    let part_path = staging.dir.join("download.part");
    let threads = normalize_threads(threads);
    progress("probe", 0, size.unwrap_or(0), &final_path);
    let client = client(test_http)?;

    // ① 单线程：不探测，直接整包 GET（保持旧行为，也少一次请求）。
    if threads <= 1 {
        let response = fetch(&client, &address, None, permit).await?;
        let (received, digest) =
            stream_single(response, &part_path, size, permit, &progress, &final_path).await?;
        return commit(
            &mut staging,
            &part_path,
            &final_path,
            received,
            digest,
            hash.as_ref(),
        );
    }

    // ② 多线程：先探测服务器是否真的支持 Range。
    let probe = fetch(&client, &address, Some((0, 0)), permit).await?;
    let probe_status = probe.status();
    if probe_status == reqwest::StatusCode::OK {
        // 服务器忽略 Range、直接回了整包：复用这次响应走单流。
        let (received, digest) =
            stream_single(probe, &part_path, size, permit, &progress, &final_path).await?;
        return commit(
            &mut staging,
            &part_path,
            &final_path,
            received,
            digest,
            hash.as_ref(),
        );
    }
    if probe_status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("更新源拒绝完整下载：HTTP {probe_status}"));
    }
    let total = match parse_content_range(probe.headers().get("content-range")) {
        Some((0, _, Some(total))) if total > 0 => total,
        _ => {
            // 206 但给不出总大小：无法切段，回落单流（重新请求整包）。
            drop(probe);
            let response = fetch(&client, &address, None, permit).await?;
            let (received, digest) =
                stream_single(response, &part_path, size, permit, &progress, &final_path).await?;
            return commit(
                &mut staging,
                &part_path,
                &final_path,
                received,
                digest,
                hash.as_ref(),
            );
        }
    };
    if total > MAX_DOWNLOAD {
        return Err("更新包超过 1 GiB 限制".into());
    }
    if let Some(expected) = size {
        if expected != total {
            return Err(format!(
                "更新包大小不符：清单 {expected} 字节，响应 {total} 字节"
            ));
        }
    }
    drop(probe);
    // 包太小或线程数超过可用分片数时，分片数按 64 KiB 一段收紧；只有 1 段就回落单流。
    let by_size = (total / MIN_SEGMENT).max(1);
    let segments = ((threads as u64).min(by_size)).max(1) as usize;
    if segments <= 1 {
        let response = fetch(&client, &address, None, permit).await?;
        let (received, digest) =
            stream_single(response, &part_path, size, permit, &progress, &final_path).await?;
        return commit(
            &mut staging,
            &part_path,
            &final_path,
            received,
            digest,
            hash.as_ref(),
        );
    }

    // ③ 分段并发：每个分片写自己的临时文件，进度按累计字节上报。
    let received = AtomicU64::new(0);
    let segment_count = segments as u64;
    // 显式取共享引用再 move 进 future：async move 只会复制这些 &T，不会把 client/address 搬走。
    let client_ref = &client;
    let address_ref = &address;
    let received_ref = &received;
    let progress_ref = &progress;
    let final_ref = &final_path;
    let mut futures: Vec<Pin<Box<dyn Future<Output = Result<PathBuf, String>> + Send + '_>>> =
        Vec::with_capacity(segments);
    for index in 0..segments {
        let start = total * index as u64 / segment_count;
        let end = total * (index as u64 + 1) / segment_count - 1;
        let shard = staging.dir.join(format!("download.part.{index}"));
        futures.push(Box::pin(async move {
            download_segment(
                client_ref,
                address_ref,
                start,
                end,
                &shard,
                total,
                received_ref,
                permit,
                progress_ref,
                final_ref,
            )
            .await?;
            Ok(shard)
        }));
    }
    let joined = join_all(futures).await;
    let mut shards: Vec<PathBuf> = Vec::with_capacity(segments);
    for result in joined {
        shards.push(result?);
    }
    permit.check()?;
    let digest = merge_segments(&shards, &part_path, total, permit)?;
    let received = received.load(Ordering::Relaxed);
    if received != total {
        return Err("更新包下载不完整，已丢弃".into());
    }
    progress("download", total, total, &final_path);
    commit(
        &mut staging,
        &part_path,
        &final_path,
        received,
        digest,
        hash.as_ref(),
    )
}

pub fn installer_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "更新目录不存在，请重新下载")?;
    let resolved = path
        .canonicalize()
        .map_err(|_| "安装包不存在，请重新下载")?;
    if !resolved.starts_with(&root)
        || !resolved.is_file()
        || resolved.file_name().is_none_or(|name| {
            name == "download.part" || name.to_string_lossy().starts_with("download.part.")
        })
    {
        return Err("仅能打开已完成下载的更新安装包".into());
    }
    Ok(resolved)
}

#[cfg(test)]
#[path = "update_download_tests.rs"]
mod tests;
