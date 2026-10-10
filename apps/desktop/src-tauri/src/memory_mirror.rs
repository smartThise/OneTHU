//! OH 云端记忆的本地镜像：appData/onethu-memory-mirror/ 下的受限文件树。
//!
//! 设计（docs/memory-cloud/03-sync-conflict.md §3.1）：
//! - 镜像 = 与云盘 1:1 的 markdown 文件；云盘不可用/未配置时镜像是本地权威（MVP 形态）；
//! - 账本（.meta.json：path → size/mtime/sha1）也是镜像里的一枚普通文件，坏了就冷启动全量拉；
//! - 单命令 op 分发（write/read/delete/list/mkdir），全部相对路径、白名单校验；
//! - write 返回**绝对路径**——记忆引擎随后把它喂给 seafile_upload / seafile_update_file，
//!   文件字节全程不过 WebView（同 seafile_pick_upload 纪律）。

use serde_json::{json, Value};

/// 镜像根目录（懒创建）。桌面与 Android 同构（app_data_dir 各自落地）。
pub fn mirror_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("onethu-memory-mirror");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建记忆镜像目录：{e}"))?;
    Ok(dir)
}

/// 相对路径白名单：只接受 Normal 组件（拒 `..`、绝对路径、空路径）。
/// 允许 CJK/空格/点开头文件名（.meta.json 账本就在镜像根）。
fn safe_rel(rel: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = rel.trim().trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("记忆镜像路径为空".into());
    }
    let p = std::path::Path::new(trimmed);
    let mut out = std::path::PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(c) => out.push(c),
            _ => return Err(format!("记忆镜像路径含非法组件（禁止 .. 或盘符）：{rel}")),
        }
    }
    Ok(out)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorEntry {
    pub name: String,
    /// "dir" | "file"
    pub kind: String,
    pub size: i64,
    /// 秒级时间戳（变更检测粗筛用；判等靠内容 sha1，见 03 文档）
    pub mtime: i64,
}

/// 镜像 IO：op ∈ write|read|delete|list|mkdir。content 仅 write 用（utf-8 markdown）。
/// 返回：write → {path: 绝对路径}；read → {content}；list → {entries: [MirrorEntry]}；
/// delete/mkdir → {ok: true}。
#[tauri::command]
pub async fn memory_io<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    op: String,
    path: String,
    content: Option<String>,
) -> Result<Value, String> {
    let root = mirror_dir(&app)?;
    mirror_io_at(&root, &op, &path, content)
}

/// 与命令同逻辑、root 可注入（单测用 tempdir，绝不碰真实 appData）。
fn mirror_io_at(root: &std::path::Path, op: &str, path: &str, content: Option<String>) -> Result<Value, String> {
    // 目录类操作（list/mkdir/abspath）允许空路径或 "/"（= 根目录）——文件类仍拒绝
    let rel = safe_rel(path).or_else(|e| {
        let t = path.trim();
        if matches!(op, "list" | "mkdir" | "abspath") && (t.is_empty() || t == "/") {
            Ok(std::path::PathBuf::new())
        } else {
            Err(e)
        }
    })?;
    let abs = root.join(&rel);
    match op {
        "write" => {
            let Some(text) = content else {
                return Err("memory_io(write) 缺少 content".into());
            };
            if text.len() as i64 > 4 * 1024 * 1024 {
                return Err("单条记忆超过 4MB 上限（异常输入防线）".into());
            }
            if let Some(parent) = abs.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("建目录失败：{e}"))?;
            }
            // 原子写（同 state_write 纪律）：临时文件 + rename，强退不留半截 markdown
            let tmp = std::path::PathBuf::from(format!("{}.tmp", abs.display()));
            std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("写镜像失败：{e}"))?;
            std::fs::rename(&tmp, &abs).map_err(|e| format!("落盘镜像失败：{e}"))?;
            Ok(json!({ "path": abs.to_string_lossy() }))
        }
        "abspath" => Ok(json!({ "path": abs.to_string_lossy() })),
        "read" => match std::fs::read_to_string(&abs) {
            Ok(s) => Ok(json!({ "content": s })),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(format!("记忆文件不存在：{path}"))
            }
            Err(e) => Err(format!("读镜像失败：{e}")),
        },
        "delete" => {
            let removed: Result<(), String> = if abs.is_dir() {
                std::fs::remove_dir_all(&abs).map_err(|e| format!("删目录失败：{e}"))
            } else if abs.is_file() {
                std::fs::remove_file(&abs).map_err(|e| format!("删文件失败：{e}"))
            } else {
                Ok(()) // 不存在视为已删（幂等）
            };
            removed.map(|_| json!({ "ok": true }))
        }
        "list" => {
            let mut out: Vec<MirrorEntry> = Vec::new();
            let rd = std::fs::read_dir(&abs).map_err(|e| format!("列镜像目录失败：{e}"))?;
            for entry in rd.flatten() {
                let Ok(md) = entry.metadata() else { continue };
                let mtime = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                out.push(MirrorEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    kind: if md.is_dir() { "dir".into() } else { "file".into() },
                    size: if md.is_dir() { 0 } else { md.len() as i64 },
                    mtime,
                });
            }
            // 目录在前、同类 mtime 倒序（对齐 seafile_dir 的排序预期）
            out.sort_by(|a, b| {
                let ka = a.kind != "dir";
                let kb = b.kind != "dir";
                ka.cmp(&kb).then_with(|| b.mtime.cmp(&a.mtime))
            });
            Ok(json!({ "entries": out }))
        }
        "mkdir" => {
            std::fs::create_dir_all(&abs).map_err(|e| format!("建目录失败：{e}"))?;
            Ok(json!({ "ok": true }))
        }
        _ => Err(format!("memory_io 未知 op：{op}")),
    }
}

/* ═══════════════ 单测（tempdir，无网络无真实 appData） ═══════════════ */

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("onethu-mem-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn safe_rel_rejects_traversal() {
        assert!(safe_rel("../escape.md").is_err(), ".. 必须被拒");
        assert!(safe_rel("a/../../escape").is_err());
        assert!(safe_rel("   ").is_err(), "空路径被拒");
        assert!(safe_rel("courses/数据结构-2026秋.md").is_ok(), "CJK 文件名合法");
        assert!(safe_rel(".meta.json").is_ok(), "账本文件合法");
        // 绝对路径被剥成相对（防手滑传 /etc/passwd 之类）
        assert!(safe_rel("/etc/passwd").map(|p| p == std::path::Path::new("etc/passwd")).unwrap_or(false));
    }

    #[test]
    fn write_read_roundtrip_and_atomic() {
        let r = root();
        let out = mirror_io_at(&r, "write", "courses/数据结构.md", Some("---\ntitle: 数据结构\n---\n\n内容".into()))
            .expect("write");
        let abs = out.get("path").and_then(|v| v.as_str()).unwrap().to_string();
        assert!(abs.contains("onethu-mem-test"), "返回的是绝对路径：{abs}");
        assert!(!std::path::PathBuf::from(format!("{abs}.tmp")).exists(), "无 tmp 残留");

        let rd = mirror_io_at(&r, "read", "courses/数据结构.md", None).expect("read");
        let content = rd.get("content").and_then(|v| v.as_str()).unwrap();
        assert!(content.contains("数据结构"));

        // 覆写（write 同路径 = 覆盖）
        mirror_io_at(&r, "write", "courses/数据结构.md", Some("v2".into())).expect("rewrite");
        let rd = mirror_io_at(&r, "read", "courses/数据结构.md", None).expect("read");
        assert_eq!(rd.get("content").and_then(|v| v.as_str()), Some("v2"));
    }

    #[test]
    fn list_and_delete_idempotent() {
        let r = root();
        mirror_io_at(&r, "mkdir", "tasks", None).expect("mkdir");
        mirror_io_at(&r, "write", "tasks/a.md", Some("a".into())).expect("write");
        let ls = mirror_io_at(&r, "list", "tasks", None).expect("list");
        let entries = ls.get("entries").and_then(|v| v.as_array()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("name").and_then(|x| x.as_str()), Some("a.md"));

        mirror_io_at(&r, "delete", "tasks/a.md", None).expect("delete");
        // 幂等：再删不报错
        mirror_io_at(&r, "delete", "tasks/a.md", None).expect("delete again");
        assert!(mirror_io_at(&r, "read", "tasks/a.md", None).is_err(), "已删文件读不到");
    }

    #[test]
    fn size_guard() {
        let r = root();
        let big = "x".repeat(5 * 1024 * 1024);
        assert!(mirror_io_at(&r, "write", "big.md", Some(big)).is_err(), "超 4MB 上限被拒");
    }
}
