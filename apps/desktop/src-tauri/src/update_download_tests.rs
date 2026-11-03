use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{atomic::AtomicUsize, Arc, Mutex},
    thread,
};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "onethu-updater-test-{}-{}",
            std::process::id(),
            NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 顺序处理 `connections` 个连接；请求头原样交给 handler。非阻塞 accept + 截止时间，
/// 即使客户端提前取消也不会把测试线程永久卡住。
fn serve_n<F>(connections: usize, handler: F) -> (String, thread::JoinHandle<()>)
where
    F: Fn(&str, &mut TcpStream) + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/package", listener.local_addr().unwrap());
    let handler = Arc::new(handler);
    let task = thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut handled = 0;
        while handled < connections && std::time::Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]).to_string();
                    handler(&request, &mut stream);
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                    handled += 1;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(2));
                }
                Err(_) => break,
            }
        }
    });
    (url, task)
}

fn request_range(head: &str) -> Option<(u64, u64)> {
    head.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if !name.trim().eq_ignore_ascii_case("range") {
            return None;
        }
        let value = value.trim().strip_prefix("bytes=")?;
        let (start, end) = value.split_once('-')?;
        Some((start.parse().ok()?, end.parse().ok()?))
    })
}

fn write_response(stream: &mut TcpStream, extra_headers: &[(&str, String)], body: &[u8]) {
    let mut head = String::from("HTTP/1.1 206 Partial Content\r\n");
    for (name, value) in extra_headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("Connection: close\r\n\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(body);
    let _ = stream.write_all(&out);
}

fn write_ok(stream: &mut TcpStream, body: &[u8]) {
    let mut out = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    let _ = stream.write_all(&out);
}

/// 真实 Range 服务器：请求带 Range → 206 + Content-Range + 该段字节；不带 → 200 整包。
fn range_server(body: Vec<u8>, connections: usize) -> (String, thread::JoinHandle<()>) {
    let body = Arc::new(body);
    serve_n(connections, move |request, stream| {
        match request_range(request) {
            Some((start, end)) => {
                let total = body.len() as u64;
                let start = start.min(total.saturating_sub(1));
                let end = end.min(total.saturating_sub(1));
                let slice = &body[start as usize..=end as usize];
                write_response(
                    stream,
                    &[
                        ("Content-Length", slice.len().to_string()),
                        ("Content-Range", format!("bytes {start}-{end}/{total}")),
                    ],
                    slice,
                );
            }
            None => write_ok(stream, &body),
        }
    })
}

async fn run(
    url: &str,
    root: &Path,
    size: Option<u64>,
    hash: Option<&str>,
    threads: Option<u32>,
) -> Result<Downloaded, String> {
    let gate = DownloadGate::new();
    let permit = gate.begin()?;
    download_inner(
        root,
        url,
        "OneTHU.apk",
        size,
        hash,
        &permit,
        |_, _, _, _| {},
        true,
        threads,
    )
    .await
}
fn empty(root: &Path) {
    assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
}
async fn join(task: thread::JoinHandle<()>) {
    tokio::task::spawn_blocking(move || task.join().unwrap())
        .await
        .unwrap();
}

#[test]
fn thread_count_is_normalized_to_supported_range() {
    assert_eq!(normalize_threads(None), 8);
    assert_eq!(normalize_threads(Some(0)), 1);
    assert_eq!(normalize_threads(Some(1)), 1);
    assert_eq!(normalize_threads(Some(6)), 6);
    assert_eq!(normalize_threads(Some(16)), 16);
    assert_eq!(normalize_threads(Some(64)), 16);
}

#[test]
fn parses_content_range_for_probing() {
    let header = |value: &'static str| reqwest::header::HeaderValue::from_static(value);
    assert_eq!(
        parse_content_range(Some(&header("bytes 0-0/1234"))),
        Some((0, 0, Some(1234)))
    );
    assert_eq!(
        parse_content_range(Some(&header("bytes 10-19/*"))),
        Some((10, 19, None))
    );
    assert_eq!(
        parse_content_range(Some(&header("bytes 10-19/20"))),
        Some((10, 19, Some(20)))
    );
    assert_eq!(parse_content_range(Some(&header("bytes 20-10/20"))), None);
    assert_eq!(parse_content_range(Some(&header("pages 0-1/2"))), None);
    assert_eq!(parse_content_range(Some(&header("bytes nope"))), None);
    assert_eq!(parse_content_range(None), None);
}

#[test]
fn input_validation() {
    for name in [
        "../x.apk",
        "..",
        "/tmp/a.apk",
        "a\\b.apk",
        "CON.exe",
        " a.apk",
        "a.apk.",
        "a\0.apk",
        "download.part",
        "download.part.3",
    ] {
        assert!(safe_name(name).is_err(), "{name}");
    }
    for hash in ["", "abcd", &"g".repeat(64)] {
        assert!(expected_hash(Some(hash)).is_err());
    }
    assert!(allowed_url(
        &url::Url::parse("https://github.com/a").unwrap(),
        false
    ));
    assert!(!allowed_url(
        &url::Url::parse("http://127.0.0.1/a").unwrap(),
        false
    ));
    assert!(!allowed_url(
        &url::Url::parse("https://user:pass@github.com/a").unwrap(),
        false
    ));
}
#[test]
fn cancel_gate_never_resets_active_ticket() {
    let gate = DownloadGate::new();
    let one = gate.begin().unwrap();
    gate.cancel();
    assert!(gate.begin().is_err());
    assert!(one.check().is_err());
    drop(one);
    let next = gate.begin().unwrap();
    assert!(next.check().is_ok());
}
#[tokio::test]
async fn streams_and_hashes_to_unique_atomic_file() {
    let temp = Temp::new();
    std::fs::write(temp.0.join("old.apk"), b"old").unwrap();
    let (url, task) = serve_n(1, |request, stream| {
        assert!(
            request_range(request).is_none(),
            "threads=1 must not probe with Range"
        );
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nabc")
            .unwrap();
        thread::sleep(Duration::from_millis(60));
        stream.write_all(b"def").unwrap();
    });
    let gate = DownloadGate::new();
    let permit = gate.begin().unwrap();
    let progress = Mutex::new(Vec::new());
    let sha = format!("{:x}", Sha256::digest(b"abcdef"));
    let result = download_inner(
        &temp.0,
        &url,
        "OneTHU.apk",
        Some(6),
        Some(&sha),
        &permit,
        |phase, n, _, _| {
            if phase == "download" {
                progress.lock().unwrap().push(n);
            }
        },
        true,
        Some(1),
    )
    .await
    .unwrap();
    join(task).await;
    assert_eq!(std::fs::read(&result.path).unwrap(), b"abcdef");
    assert!(result.verified);
    assert_eq!(result.size, 6);
    assert!(progress.lock().unwrap().contains(&3));
    assert_eq!(std::fs::read(temp.0.join("old.apk")).unwrap(), b"old");
    assert!(installer_path(&temp.0, &result.path).is_ok());
    assert!(!result.path.parent().unwrap().join("download.part").exists());
}
#[tokio::test]
async fn rejects_tamper_truncation_status_and_limit_without_leftovers() {
    for response in [
        b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nbad".as_slice(),
        b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nbad",
        b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\n\r\nbad",
        b"HTTP/1.1 200 OK\r\nContent-Length: 1073741825\r\n\r\n",
    ] {
        let temp = Temp::new();
        let raw = response.to_vec();
        let (url, task) = serve_n(1, move |_request, stream| {
            stream.write_all(&raw).unwrap();
        });
        assert!(run(&url, &temp.0, None, Some(&"0".repeat(64)), Some(1))
            .await
            .is_err());
        join(task).await;
        empty(&temp.0);
    }
}
#[tokio::test]
async fn cancel_headers_and_body_drops_real_socket_and_cleans_staging() {
    for body_started in [false, true] {
        let temp = Temp::new();
        let (tx, rx) = tokio::sync::oneshot::channel();
        let tx = Mutex::new(Some(tx));
        let (url, task) = serve_n(1, move |_request, stream| {
            if body_started {
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 99\r\n\r\na")
                    .unwrap();
            }
            if let Some(sender) = tx.lock().unwrap().take() {
                let _ = sender.send(());
            }
            let mut b = [0];
            assert_eq!(
                stream.read(&mut b).unwrap(),
                0,
                "cancellation must close the real connection"
            );
        });
        let gate = DownloadGate::new();
        let permit = gate.begin().unwrap();
        let (result, ()) = tokio::join!(
            download_inner(
                &temp.0,
                &url,
                "x.apk",
                None,
                None,
                &permit,
                |_, _, _, _| {},
                true,
                Some(1)
            ),
            async {
                rx.await.unwrap();
                tokio::time::sleep(Duration::from_millis(30)).await;
                gate.cancel();
            }
        );
        assert!(result.err().unwrap().contains("已取消"));
        join(task).await;
        empty(&temp.0);
    }
}
#[tokio::test]
async fn dropped_future_removes_partial_download() {
    let temp = Temp::new();
    let (url, task) = serve_n(1, |_request, stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\na")
            .unwrap();
        let mut b = [0];
        assert_eq!(stream.read(&mut b).unwrap(), 0);
    });
    let gate = DownloadGate::new();
    let permit = gate.begin().unwrap();
    assert!(tokio::time::timeout(
        Duration::from_millis(100),
        download_inner(
            &temp.0,
            &url,
            "x.apk",
            None,
            None,
            &permit,
            |_, _, _, _| {},
            true,
            Some(1)
        )
    )
    .await
    .is_err());
    join(task).await;
    empty(&temp.0);
}
#[tokio::test]
async fn missing_hash_never_claims_signature_or_verification() {
    let temp = Temp::new();
    let (url, task) = serve_n(1, |_request, stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc")
            .unwrap();
    });
    let result = run(&url, &temp.0, Some(3), None, Some(1)).await.unwrap();
    join(task).await;
    assert!(!result.verified);
    assert!(installer_path(&temp.0, Path::new("/etc/hosts")).is_err());
}
#[tokio::test]
async fn installer_requires_completed_record_and_unchanged_bytes() {
    let temp = Temp::new();
    let registry = CompletedDownloads::new();
    let loose = temp.0.join("loose.apk");
    std::fs::write(&loose, b"abc").unwrap();
    assert!(registry.validate(&temp.0, &loose).is_err());
    let (url, task) = serve_n(1, |_request, stream| {
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc")
            .unwrap();
    });
    let result = run(&url, &temp.0, Some(3), None, Some(1)).await.unwrap();
    join(task).await;
    registry.remember(&result).unwrap();
    assert!(registry.validate(&temp.0, &result.path).is_ok());
    std::fs::write(&result.path, b"xyz").unwrap();
    assert!(registry
        .validate(&temp.0, &result.path)
        .unwrap_err()
        .contains("已改变"));
    std::fs::write(&result.path, b"longer").unwrap();
    assert!(registry.validate(&temp.0, &result.path).is_err());
    assert!(CompletedDownloads::new().validate(&temp.0, &loose).is_err());
}
#[tokio::test]
async fn disk_error_retains_previous_package() {
    let temp = Temp::new();
    let root = temp.0.join("not-a-directory");
    std::fs::write(&root, b"old package").unwrap();
    assert!(
        run("http://127.0.0.1:1/no-call", &root, None, None, Some(1))
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(root).unwrap(), b"old package");
}
#[tokio::test]
async fn missing_size_chunked_body_is_bounded_and_validated() {
    let temp = Temp::new();
    let (url, task) = serve_n(1, |_request, stream| {
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n",
            )
            .unwrap();
    });
    let result = run(&url, &temp.0, None, None, Some(1)).await.unwrap();
    join(task).await;
    assert_eq!(result.size, 3);
    assert_eq!(std::fs::read(result.path).unwrap(), b"abc");
}

/* ═══════════ 多线程分段（2026-10-28） ═══════════ */

fn fixture_bytes(len: usize) -> Vec<u8> {
    (0..len).map(|index| (index % 251) as u8).collect()
}

#[tokio::test]
async fn segmented_download_probes_ranges_merges_shards_and_verifies_hash() {
    let temp = Temp::new();
    let body = fixture_bytes(300 * 1024);
    let total = body.len() as u64;
    let sha = format!("{:x}", Sha256::digest(&body));
    // threads=4 → 300 KiB / 64 KiB = 4 段 → 1 次探测 + 4 段。
    let (url, task) = range_server(body.clone(), 5);
    let progress = Mutex::new(Vec::new());
    let gate = DownloadGate::new();
    let permit = gate.begin().unwrap();
    let result = download_inner(
        &temp.0,
        &url,
        "OneTHU.apk",
        Some(total),
        Some(&sha),
        &permit,
        |phase, received, total_seen, _| {
            if phase == "download" {
                progress.lock().unwrap().push((received, total_seen));
            }
        },
        true,
        Some(4),
    )
    .await
    .unwrap();
    join(task).await;
    assert_eq!(std::fs::read(&result.path).unwrap(), body);
    assert_eq!(result.size, total);
    assert!(result.verified);
    let entries: Vec<String> = std::fs::read_dir(result.path.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        entries,
        vec!["OneTHU.apk".to_string()],
        "shards/part must be cleaned: {entries:?}"
    );
    assert!(progress
        .lock()
        .unwrap()
        .iter()
        .any(|(received, total_seen)| received == total_seen && *received == total));
}

#[tokio::test]
async fn probe_falls_back_to_single_stream_when_server_ignores_range() {
    let temp = Temp::new();
    let body = fixture_bytes(200 * 1024);
    let sha = format!("{:x}", Sha256::digest(&body));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = requests.clone();
    let payload = body.clone();
    let (url, task) = serve_n(1, move |request, stream| {
        seen.lock().unwrap().push(request.to_ascii_lowercase());
        write_ok(stream, &payload);
    });
    let result = run(&url, &temp.0, Some(body.len() as u64), Some(&sha), Some(8))
        .await
        .unwrap();
    join(task).await;
    assert_eq!(std::fs::read(&result.path).unwrap(), body);
    let seen = requests.lock().unwrap();
    assert_eq!(
        seen.len(),
        1,
        "probe response must be reused for the fallback"
    );
    assert!(seen[0].contains("range: bytes=0-0"));
}

#[tokio::test]
async fn partial_content_without_total_falls_back_to_single_stream() {
    let temp = Temp::new();
    let body = fixture_bytes(200 * 1024);
    let sha = format!("{:x}", Sha256::digest(&body));
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let payload = body.clone();
    let (url, task) = serve_n(2, move |request, stream| {
        seen.fetch_add(1, Ordering::SeqCst);
        if request_range(request).is_some() {
            write_response(
                stream,
                &[
                    ("Content-Length", "1".to_string()),
                    ("Content-Range", "bytes 0-0/*".to_string()),
                ],
                &payload[..1],
            );
        } else {
            write_ok(stream, &payload);
        }
    });
    let result = run(&url, &temp.0, None, Some(&sha), Some(16))
        .await
        .unwrap();
    join(task).await;
    assert_eq!(std::fs::read(&result.path).unwrap(), body);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn segmented_download_honours_cancel_and_cleans_staging() {
    let temp = Temp::new();
    let total = 300 * 1024u64;
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let started = Mutex::new(Some(started_tx));
    let (url, task) = serve_n(5, move |request, stream| {
        match request_range(request) {
            // 探测：正常回 206（0-0/总大小）。
            Some((0, 0)) => write_response(
                stream,
                &[
                    ("Content-Length", "1".to_string()),
                    ("Content-Range", format!("bytes 0-0/{total}")),
                ],
                b"x",
            ),
            // 分片：发头 + 1 字节后挂住，等取消把连接关掉。
            Some((start, end)) => {
                write_response(
                    stream,
                    &[
                        ("Content-Length", (end - start + 1).to_string()),
                        ("Content-Range", format!("bytes {start}-{end}/{total}")),
                    ],
                    b"x",
                );
                if let Some(sender) = started.lock().unwrap().take() {
                    let _ = sender.send(());
                }
                let mut buffer = [0u8; 64];
                let _ = stream.read(&mut buffer);
            }
            None => write_ok(stream, &[]),
        }
    });
    let gate = DownloadGate::new();
    let permit = gate.begin().unwrap();
    let (result, ()) = tokio::join!(
        download_inner(
            &temp.0,
            &url,
            "x.apk",
            None,
            None,
            &permit,
            |_, _, _, _| {},
            true,
            Some(4)
        ),
        async {
            let _ = started_rx.await;
            tokio::time::sleep(Duration::from_millis(40)).await;
            gate.cancel();
        }
    );
    assert!(result.err().unwrap().contains("已取消"));
    join(task).await;
    empty(&temp.0);
}
