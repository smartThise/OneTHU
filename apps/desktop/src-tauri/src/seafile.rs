//! 清华云盘（Seafile 定制版 @ cloud.tsinghua.edu.cn）—— Web API 直连。
//!
//! 实测（2026-09 无凭据探测）：清华实例保留全套 Seafile Web API，
//! 认证仅需 `Authorization: Token <token>` 头。token 由用户在
//! https://cloud.tsinghua.edu.cn/profile/#get-auth-token 页面生成（一次性）。
//! 参考：thufs（class-undefined/thufs，清华同学的云盘 CLI）。
//!
//! 会话策略：每条命令独立请求（无状态 token，无连接保持）；
//! token 由前端按调用传入（TS 侧 XOR 混淆落 seafile.cfg.json，同 caldav 模式）。

use chrono;
use serde::Serialize;
use serde_json::Value;

const BASE: &str = "https://cloud.tsinghua.edu.cn";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        // 清华域直连：绕系统代理（同 lib.rs download_file，全局模式梯子会触发风控）
        .no_proxy()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())
}

/// 统一错误：把 401/403 翻译成「token 失效」，其余透传状态码与响应体片段
async fn check(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        // share-links 403 可能是「目录设置了禁分享」——给出可判别信息而非一律说 token 坏
        if body.contains("does not exist") || body.contains("permission") {
            return Err(format!("HTTP {}：{}", status.as_u16(), body.chars().take(160).collect::<String>()));
        }
        return Err("token 无效或已过期，请重新在云盘设置里粘贴".into());
    }
    Err(format!("HTTP {}：{}", status.as_u16(), body.chars().take(160).collect::<String>()))
}

/* ═══════════════ 结构 ═══════════════ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileAccount {
    pub name: String,
    pub email: String,
    /// 已用字节
    pub usage: i64,
    /// 总配额字节
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileRepo {
    pub id: String,
    pub name: String,
    /// 秒级时间戳（缺省 0）
    pub mtime: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileEntry {
    pub name: String,
    /// "dir" | "file"
    pub kind: String,
    pub size: i64,
    /// 秒级时间戳
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileShare {
    pub link: String,
    pub token: String,
}

/* ═══════════════ 命令 ═══════════════ */

/// 校验 token：成功即返回账号信息（配置页「连接测试」也走它）
#[tauri::command]
pub async fn seafile_account(token: String) -> Result<SeafileAccount, String> {
    let v: Value = check(client()?.get(format!("{BASE}/api2/account/info/")).bearer_auth(token).send().await.map_err(|e| e.to_string())?)
        .await?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(SeafileAccount {
        name: v.get("name").and_then(|x| x.as_str()).unwrap_or("").into(),
        email: v.get("email").and_then(|x| x.as_str()).unwrap_or("").into(),
        usage: v.get("usage").and_then(|x| x.as_i64()).unwrap_or(0),
        total: v.get("total").and_then(|x| x.as_i64()).unwrap_or(0),
    })
}

/// 资料库列表（含共享给我的库）
#[tauri::command]
pub async fn seafile_repos(token: String) -> Result<Vec<SeafileRepo>, String> {
    let v: Vec<Value> = check(client()?.get(format!("{BASE}/api2/repos/")).bearer_auth(token).send().await.map_err(|e| e.to_string())?)
        .await?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    // seahub /api2/repos/ 是 mine+shared+group+public 四路平铺合并、服务端不去重
    //（源码 ReposView：repo_list 逐路 append）——同一库经群组+分享双通道进来会重复。
    // 保留首个出现（mine 通道在前 → rw 权优先）；virtual 子库（子目录分享出的虚拟库，
    // 表现为「重复的文件夹」）整条滤除。
    let mut seen = std::collections::HashSet::new();
    Ok(v.into_iter()
        .filter(|r| {
            if r.get("virtual").and_then(|x| x.as_bool()).unwrap_or(false) {
                return false;
            }
            let id = r.get("id").and_then(|x| x.as_str()).unwrap_or("");
            !id.is_empty() && seen.insert(id.to_string())
        })
        .map(|r| SeafileRepo {
            id: r.get("id").and_then(|x| x.as_str()).unwrap_or("").into(),
            name: r.get("name").and_then(|x| x.as_str()).unwrap_or("").into(),
            mtime: r.get("mtime").and_then(|x| x.as_i64()).unwrap_or(0),
            size: r.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
        })
        .collect())
}

/// 创建资料库（POST /api2/repos/，form: name；同名已存在时 Seafile 会新建重名库——
/// 调用方应先按名字查找，本命令只负责「没有就建」的建侧）。
#[tauri::command]
pub async fn seafile_create_repo(token: String, name: String) -> Result<SeafileRepo, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("资料库名不能为空".into());
    }
    let v: Value = check(
        client()?
            .post(format!("{BASE}/api2/repos/"))
            .bearer_auth(token)
            .form(&[("name", n)])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if id.is_empty() {
        return Err(format!("建库响应缺 id：{}", serde_json::to_string(&v).unwrap_or_default().chars().take(160).collect::<String>()));
    }
    Ok(SeafileRepo {
        id,
        name: v.get("name").and_then(|x| x.as_str()).unwrap_or(n).to_string(),
        mtime: v.get("mtime").and_then(|x| x.as_i64()).unwrap_or(0),
        size: v.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
    })
}

/// 目录浏览。path 形如 "/" 或 "/课件/第一周"
#[tauri::command]
pub async fn seafile_dir(token: String, repo_id: String, path: String) -> Result<Vec<SeafileEntry>, String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let v: Vec<Value> = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/dir/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    let mut out: Vec<SeafileEntry> = v
        .into_iter()
        .map(|e| SeafileEntry {
            name: e.get("name").and_then(|x| x.as_str()).unwrap_or("").into(),
            kind: {
                let t = e.get("type").and_then(|x| x.as_str()).unwrap_or("file");
                if t == "dir" { "dir".into() } else { "file".into() }
            },
            size: e.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
            mtime: e.get("mtime").and_then(|x| x.as_i64()).unwrap_or(0),
        })
        .collect();
    // 目录在前；同类内按 mtime 倒序（最新最上——对齐网页端「最近修改」预期：
    // 刚上传的文件必须出现在可视区顶部，86 条的库字典序会把它埋到 69 行）
    out.sort_by(|a, b| {
        let ka = a.kind != "dir";
        let kb = b.kind != "dir";
        ka.cmp(&kb).then_with(|| b.mtime.cmp(&a.mtime))
    });
    out.dedup_by(|a, b| a.name == b.name);
    Ok(out)
}

/// 下载到设置中的下载目录（Content-Disposition 真名优先；同 lib.rs download_file 约定）
#[tauri::command]
/// `R` 泛型：句柄只在 Android 分支用到（写缓存后经系统桥转存），桌面端实际不使用，
/// 泛型化让 live 测试可以传 mock 句柄而不必构造 Wry 运行时。
pub async fn seafile_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
    repo_id: String,
    path: String,
) -> Result<String, String> {
    let p = if path.starts_with('/') { path.clone() } else { format!("/{path}") };
    let resp = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/file/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str()), ("dl", "1")])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    let content_disposition = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("下载失败：文件内容为空".into());
    }
    let name = content_disposition
        .as_deref()
        .and_then(crate::parse_cd_filename)
        .filter(|n| !n.trim().is_empty())
        .or_else(|| path.rsplit('/').next().map(|s| s.to_string()))
        .unwrap_or_else(|| "seafile-file".into());
    let safe_name: String = name.chars().map(|c| if c == '/' || c == ':' { '_' } else { c }).collect();
    // Android：先落应用缓存，再经系统桥转存「系统下载」（MediaStore，用户可见）
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("无法定位缓存目录: {e}"))?
            .join("onethu-dl");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(&safe_name);
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        let r: serde_json::Value = handle
            .run_mobile_plugin(
                "saveDownload",
                serde_json::json!({ "path": tmp.to_string_lossy(), "name": safe_name }),
            )
            .map_err(|e| e.to_string())?;
        if r.get("name").is_some() {
            return Ok(format!("下载/{safe_name}"));
        }
        // 桥失败：缓存文件兜底（至少文件是完整的）
        return Ok(tmp.to_string_lossy().into_owned());
    }
    #[cfg(not(target_os = "android"))]
    {
        let dir = crate::downloads::directory(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(&safe_name);
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }
}

/// 上传本地文件到云盘（local_path 支持 ~ 前缀展开；replace=true 覆盖同名）
#[tauri::command]
pub async fn seafile_upload(
    token: String,
    repo_id: String,
    parent_dir: String,
    local_path: String,
    replace: bool,
) -> Result<i64, String> {
    let expanded = expand_home(&local_path)?;
    seafile_upload_inner(&token, &repo_id, &parent_dir, std::path::Path::new(&expanded), replace).await
}

async fn seafile_upload_inner(
    token: &str,
    repo_id: &str,
    parent_dir: &str,
    local_path: &std::path::Path,
    replace: bool,
) -> Result<i64, String> {
    let pd = if parent_dir.starts_with('/') { parent_dir.to_string() } else { format!("/{parent_dir}") };
    let data = std::fs::read(local_path).map_err(|e| format!("读本地文件失败：{e}"))?;
    let filename = local_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "upload.bin".into());
    // ① 取 upload-link（返回带引号的裸字符串，trim '"' —— thufs 同款）
    let link: String = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/upload-link/"))
            .bearer_auth(token)
            .query(&[("p", pd.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .text()
    .await
    .map_err(|e| e.to_string())?;
    let link = link.trim().trim_matches('"').to_string();
    if link.is_empty() {
        return Err("服务器未返回上传链接".into());
    }
    // ② multipart POST（?ret-json=1 拿结构化结果）
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("parent_dir", pd.clone())
        .text("replace", if replace { "1".to_string() } else { "0".to_string() });
    let v: Value = check(
        client()?
            .post(format!("{link}?ret-json=1"))
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    // ret-json=1 返回 [{name,id,size}]（size 缺省 -1 表示服务器未回填）
    Ok(v.as_array()
        .and_then(|a| a.first())
        .and_then(|f| f.get("size"))
        .and_then(|x| x.as_i64())
        .unwrap_or(-1))
}

/// 递归建目录（已存在则静默成功）
#[tauri::command]
pub async fn seafile_mkdir(token: String, repo_id: String, path: String) -> Result<(), String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    check(
        client()?
            .post(format!("{BASE}/api2/repos/{repo_id}/dir/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .form(&[("operation", "mkdir"), ("create_parents", "true")])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(())
}

/// 删除文件或目录（kind="file"|"dir"；目录整棵递归删——UI 层必须 alert 级确认）
#[tauri::command]
pub async fn seafile_delete(
    token: String,
    repo_id: String,
    path: String,
    kind: String,
) -> Result<(), String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let seg = if kind == "dir" { "dir" } else { "file" };
    check(
        client()?
            .delete(format!("{BASE}/api2/repos/{repo_id}/{seg}/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(())
}

/// 移动/重命名文件或目录（kind="file"|"dir"）：
/// dst_dir 为目标目录（绝对路径）；new_name 非空时同时改名（Seafile rename 语义）
#[tauri::command]
pub async fn seafile_move(
    token: String,
    repo_id: String,
    path: String,
    kind: String,
    dst_repo: String,
    dst_dir: String,
    new_name: String,
) -> Result<(), String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let seg = if kind == "dir" { "dir" } else { "file" };
    let dd = if dst_dir.starts_with('/') { dst_dir } else { format!("/{dst_dir}") };
    let mut form: Vec<(&str, String)> = vec![
        ("operation", "move".into()),
        ("dst_repo", dst_repo),
        ("dst_dir", dd),
    ];
    if !new_name.trim().is_empty() {
        form.push(("newname", new_name.trim().to_string()));
    }
    check(
        client()?
            .post(format!("{BASE}/api2/repos/{repo_id}/{seg}/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .form(&form)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(())
}

/// 生成分享链接（expire_days=0 表示永久；password 可空）
#[tauri::command]
pub async fn seafile_share(
    token: String,
    repo_id: String,
    path: String,
    expire_days: i64,
    password: String,
) -> Result<SeafileShare, String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let mut body = serde_json::json!({ "repo_id": repo_id, "path": p });
    if expire_days > 0 {
        body["expire_days"] = serde_json::json!(expire_days);
    }
    if !password.trim().is_empty() {
        body["password"] = serde_json::json!(password.trim());
    }
    let v: Value = check(
        client()?
            .post(format!("{BASE}/api/v2.1/share-links/"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    Ok(SeafileShare {
        link: v.get("link").and_then(|x| x.as_str()).unwrap_or("").into(),
        token: v.get("token").and_then(|x| x.as_str()).unwrap_or("").into(),
    })
}

/// 库内搜索（seahub 新版：必须带 repo_id；返回 data=[{path,size,mtime(ISO),type}]）
#[tauri::command]
pub async fn seafile_search(token: String, repo_id: String, query: String) -> Result<Vec<SeafileEntry>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let v: Value = check(
        client()?
            .get(format!("{BASE}/api2/search/"))
            .bearer_auth(token)
            .query(&[("repo_id", repo_id.as_str()), ("q", q)])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    // seahub master：{data: [...]}；旧版兼容 {results: [...]} / 裸数组
    let arr = v
        .as_array()
        .cloned()
        .or_else(|| v.get("data").and_then(|x| x.as_array()).cloned())
        .or_else(|| v.get("results").and_then(|x| x.as_array()).cloned())
        .unwrap_or_default();
    Ok(arr
        .into_iter()
        .map(|e| {
            let path = e.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let name = path.rsplit('/').next().unwrap_or("").to_string();
            // mtime：新版 ISO 字符串 → epoch 秒；旧版裸整数
            let mtime = e
                .get("mtime")
                .and_then(|x| x.as_i64())
                .or_else(|| {
                    e.get("mtime")
                        .and_then(|x| x.as_str())
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                        .map(|d: chrono::DateTime<chrono::FixedOffset>| d.timestamp())
                })
                .unwrap_or(0);
            SeafileEntry {
                name: if name.is_empty() { e.get("name").and_then(|x| x.as_str()).unwrap_or("").into() } else { name },
                kind: if e.get("type").and_then(|x| x.as_str()) == Some("folder")
                    || e.get("type").and_then(|x| x.as_str()) == Some("dir")
                    || e.get("is_dir").and_then(|x| x.as_bool()).unwrap_or(false)
                {
                    "dir".into()
                } else {
                    "file".into()
                },
                size: e.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
                mtime,
            }
        })
        .collect())
}

/// 系统文件选择器 → 直接上传（字节不过 JS）：多选，逐个传，返回「文件名: 结果」列表
#[tauri::command]
pub async fn seafile_pick_upload(
    app: tauri::AppHandle,
    token: String,
    repo_id: String,
    parent_dir: String,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<Vec<tauri_plugin_dialog::FilePath>>>();
    app.dialog().file().pick_files(move |paths| {
        let _ = tx.send(paths);
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(paths) = picked else {
        return Ok(Vec::new()); // 用户取消
    };
    let mut out = Vec::new();
    for p in paths {
        let real = match p.into_path() {
            Ok(r) => r,
            Err(e) => {
                out.push(format!("跳过（路径解析失败）：{e}"));
                continue;
            }
        };
        let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match seafile_upload_inner(&token, &repo_id, &parent_dir, &real, true).await {
            Ok(_) => out.push(format!("{name} ✓")),
            Err(e) => out.push(format!("{name} ✗ {e}")),
        }
    }
    Ok(out)
}

/* ═══════════════ 记忆/Files Hub 扩展原语（2026-10 memory-cloud 设计落地） ═══════════════
 *
 * 与既有命令的关系（docs/memory-cloud/01-memory-system.md §4 API 三档）：
 * - seafile_read_bytes     seafile_download 的「到内存」变体（base64 返回），带大小防线；
 * - seafile_update_file    update-link 覆写已存在文件（编辑原语；thufs 同实例验证）；
 * - seafile_uploaded_bytes / seafile_upload_resume  断点续传对
 *   （/file-uploaded-bytes/ + Content-Range 语义，thufs 同实例验证）。
 * 端点均属「thufs 已验证、seafile.rs 未封装」档——正式接入后跑 live 冒烟复核。 */

/// 读文件到内存（base64 返回）。记忆镜像/摘要解析用：不落盘、不弹下载目录。
/// max_bytes ≤0 时取默认 8MB——大课件整个拖进 WebView 会 OOM，这是防线。
#[tauri::command]
pub async fn seafile_read_bytes(
    token: String,
    repo_id: String,
    path: String,
    max_bytes: i64,
) -> Result<String, String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let limit = if max_bytes > 0 { max_bytes } else { 8 * 1024 * 1024 };
    let resp = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/file/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str()), ("dl", "1")])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    // 先看 Content-Length 提前拒绝（chunked 场景读后再验）
    if let Some(v) = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i64>().ok())
    {
        if v > limit {
            return Err(format!("文件过大（{v} 字节 > 上限 {limit}）：记忆镜像只收小文件，大文件请走 seafile_download"));
        }
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as i64 > limit {
        return Err(format!("文件过大（{} 字节 > 上限 {limit}）：记忆镜像只收小文件，大文件请走 seafile_download", bytes.len()));
    }
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// 覆写已存在文件（update-link 原语）：GET update-link（指向父目录）→
/// multipart(file, target_file=完整远端路径)。target_file 带 / 开头完整路径（thufs 同款）。
#[tauri::command]
pub async fn seafile_update_file(
    token: String,
    repo_id: String,
    file_path: String,
    local_path: String,
) -> Result<i64, String> {
    let p = if file_path.starts_with('/') { file_path } else { format!("/{file_path}") };
    let (parent, name) = match p.rsplit_once('/') {
        Some((dir, n)) if !n.is_empty() => (if dir.is_empty() { "/".to_string() } else { dir.to_string() }, n.to_string()),
        _ => return Err(format!("路径无文件名：{p}")),
    };
    let expanded = expand_home(&local_path)?;
    let data = std::fs::read(&expanded).map_err(|e| format!("读本地文件失败：{e}"))?;
    // ① 取 update-link（同 upload-link：带引号裸字符串）
    let link: String = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/update-link/"))
            .bearer_auth(&token)
            .query(&[("p", parent.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .text()
    .await
    .map_err(|e| e.to_string())?;
    let link = link.trim().trim_matches('"').to_string();
    if link.is_empty() {
        return Err("服务器未返回更新链接".into());
    }
    // ② multipart(file, target_file)——注意 target_file 是含目录的完整路径
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(name)
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("target_file", p.clone());
    let v: Value = check(
        client()?
            .post(&link)
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    Ok(v.as_array()
        .and_then(|a| a.first())
        .and_then(|f| f.get("size"))
        .and_then(|x| x.as_i64())
        .unwrap_or(-1))
}

/// 断点续传探测：服务器已收字节数（0=无断点。端点报错时如实上抛，由上层决定整传重试）。
#[tauri::command]
pub async fn seafile_uploaded_bytes(
    token: String,
    repo_id: String,
    parent_dir: String,
    file_name: String,
) -> Result<i64, String> {
    let pd = if parent_dir.starts_with('/') { parent_dir } else { format!("/{parent_dir}") };
    let v: Value = check(
        client()?
            .get(format!("{BASE}/api/v2.1/repos/{repo_id}/file-uploaded-bytes/"))
            .bearer_auth(token)
            .query(&[("parent_dir", pd.as_str()), ("file_name", file_name.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    Ok(v.get("uploadedBytes").and_then(|x| x.as_i64()).unwrap_or(0))
}

/// 断点续传上传：先探测已传字节，再从偏移续传（Content-Range）。
/// replace=true 时跳过续传直接整传（覆盖语义与续传互斥）。
/// TODO（Files Hub 大文件优化）：现整读后切片，>200MB 文件应换流式 Body。
#[tauri::command]
pub async fn seafile_upload_resume(
    token: String,
    repo_id: String,
    parent_dir: String,
    local_path: String,
    replace: bool,
) -> Result<i64, String> {
    let pd = if parent_dir.starts_with('/') { parent_dir } else { format!("/{parent_dir}") };
    let expanded = expand_home(&local_path)?;
    let total = std::fs::metadata(&expanded).map_err(|e| format!("读本地文件失败：{e}"))?.len();
    let filename = std::path::Path::new(&expanded)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "upload.bin".into());
    let start: u64 = if replace {
        0
    } else {
        seafile_uploaded_bytes(token.clone(), repo_id.clone(), pd.clone(), filename.clone())
            .await
            .unwrap_or(0)
            .clamp(0, total as i64) as u64
    };
    let data = std::fs::read(&expanded).map_err(|e| format!("读本地文件失败：{e}"))?;
    // ① upload-link（同 seafile_upload_inner）
    let link: String = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/upload-link/"))
            .bearer_auth(&token)
            .query(&[("p", pd.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .text()
    .await
    .map_err(|e| e.to_string())?;
    let link = link.trim().trim_matches('"').to_string();
    if link.is_empty() {
        return Err("服务器未返回上传链接".into());
    }
    // ② 从 start 偏移续传，带 Content-Range（thufs 验证的服务器语义）
    let part = reqwest::multipart::Part::bytes(data[start as usize..].to_vec())
        .file_name(filename.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("parent_dir", pd.clone())
        .text("replace", if replace { "1".to_string() } else { "0".to_string() });
    let mut req = client()?
        .post(format!("{link}?ret-json=1"))
        .bearer_auth(&token)
        .multipart(form);
    if start > 0 {
        req = req.header("Content-Range", format!("bytes {start}-{}/{total}", total.saturating_sub(1)));
    }
    let v: Value = check(req.send().await.map_err(|e| e.to_string())?)
        .await?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(v.as_array()
        .and_then(|a| a.first())
        .and_then(|f| f.get("size"))
        .and_then(|x| x.as_i64())
        .unwrap_or(-1))
}

/// 本地路径 ~ 前缀展开（seafile_upload 同款逻辑，抽出共用）
fn expand_home(local_path: &str) -> Result<String, String> {
    if let Some(rest) = local_path.strip_prefix("~") {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|_| "无法定位主目录")?;
        Ok(format!("{home}{rest}"))
    } else {
        Ok(local_path.to_string())
    }
}

/* ═══════════════ live 测试（真实实例，需 token）═══════════════
 *
 * TSINGHUA_SEAFILE_TOKEN 环境变量注入；`cargo test --lib live -- --ignored --nocapture`
 * 覆盖：账号 → 列库 → 列目录 → 递归建目录 → 上传 → 搜索 → 分享 → 下载校验。
 * 产物落在第一个库的 /onethu-autotest/ 下（留观察，不自动删）。
 */

#[cfg(test)]
mod tests {
    use super::*;

    fn token() -> String {
        std::env::var("TSINGHUA_SEAFILE_TOKEN").expect("需要 TSINGHUA_SEAFILE_TOKEN 环境变量（云盘 profile 页生成）")
    }

    #[tokio::test]
    #[ignore]
    async fn live_account_and_repos() {
        let acc = seafile_account(token()).await.expect("账号信息");
        println!("账号：{} <{}> 用量 {}/{}", acc.name, acc.email, acc.usage, acc.total);
        assert!(!acc.email.is_empty(), "email 非空");
        assert!(acc.total >= acc.usage, "配额自洽");
        let repos = seafile_repos(token()).await.expect("资料库列表");
        println!("共 {} 个库", repos.len());
        for r in repos.iter().take(5) {
            println!("  - {}（{}）mtime={} size={}", r.name, r.id, r.mtime, r.size);
        }
        assert!(!repos.is_empty(), "至少应有一个库（个人云盘）");
    }

    #[tokio::test]
    #[ignore]
    async fn live_dir_walk() {
        let repos = seafile_repos(token()).await.expect("列库");
        let repo = &repos[0];
        let entries = seafile_dir(token(), repo.id.clone(), "/".into()).await.expect("根目录");
        println!("库「{}」根目录 {} 项", repo.name, entries.len());
        for e in entries.iter().take(10) {
            println!("  [{}] {} ({}B, mtime={})", e.kind, e.name, e.size, e.mtime);
        }
        // 排序不变式：目录在前
        let dirs_first = entries
            .iter()
            .skip_while(|e| e.kind == "dir")
            .all(|e| e.kind != "dir");
        assert!(dirs_first, "目录应排在文件前");
    }

    #[tokio::test]
    #[ignore]
    async fn live_mkdir_upload_search_share() {
        let t = token();
        let repos = seafile_repos(t.clone()).await.expect("列库");
        let repo = &repos[0];
        let dir = "/onethu-autotest";
        seafile_mkdir(t.clone(), repo.id.clone(), dir.into()).await.expect("递归建目录");

        // 上传一个已知内容的小文件
        let tmp = std::env::temp_dir().join("onethu-seafile-up.txt");
        std::fs::write(&tmp, format!("OneTHU seafile live test @ {}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs())).unwrap();
        let size = seafile_upload(t.clone(), repo.id.clone(), dir.into(), tmp.to_string_lossy().into_owned(), true)
            .await
            .expect("上传");
        println!("上传完成 size={size}");
        assert!(size < 0 || size > 0, "size 应>0 或服务器未回填(-1)");

        // 目录里应能看到它
        let entries = seafile_dir(t.clone(), repo.id.clone(), dir.into()).await.expect("列 autotest 目录");
        assert!(entries.iter().any(|e| e.name == "onethu-seafile-up.txt"), "上传后应出现在目录里");

        // 搜索应能命中（索引可能延迟，轮询 5×2s）
        let mut found = false;
        for _ in 0..5 {
            let hits = seafile_search(t.clone(), repo.id.clone(), "onethu-seafile-up".into()).await.expect("搜索");
            if hits.iter().any(|e| e.name.contains("onethu-seafile-up")) {
                found = true;
                println!("搜索命中：{} 条", hits.len());
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        println!("搜索命中情况：{}", found);

        // 分享链接
        let share = seafile_share(t.clone(), repo.id.clone(), format!("{dir}/onethu-seafile-up.txt"), 7, String::new())
            .await
            .expect("分享");
        println!("分享链接（7 天）：{}", share.link);
        assert!(share.link.starts_with("https://"), "链接应为 https");

        // 下载回来校验内容
        // seafile_download 后来多了 AppHandle（Android 要写进应用沙盒）：ignored 的 live
        // 测试因此编不过，连累整个 lib 测试目标——这里补上 mock 句柄，测试本身不跑。
        let local = seafile_download(
            tauri::test::mock_app().handle().clone(),
            t.clone(),
            repo.id.clone(),
            format!("{dir}/onethu-seafile-up.txt"),
        )
            .await
            .expect("下载");
        let content = std::fs::read_to_string(&local).unwrap();
        assert!(content.starts_with("OneTHU seafile live test"), "下载内容应为上传原文");
        println!("下载回读校验通过：{local}");
    }
}
