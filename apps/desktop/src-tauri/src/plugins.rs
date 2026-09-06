//! Rust 骨干插件宿主（sidecar 进程 + JSON-RPC over stdio）
//!
//! 课程作业 R1：插件的核心业务逻辑（agent 主控循环、LLM API 调用编排、
//! 工具循环、token 统计）必须用 Rust 写。宿主把这类插件作为独立进程拉起：
//!   host → plugin（stdin） ：activate / run / dispose 请求、interrupt 通知
//!   plugin → host（stdout）：onethu.call 请求（经事件转发 webview 门面，权限集中门禁）、
//!                            progress / log 通知、host 请求的应答
//! stderr 逐行作为 log 事件转发（eprintln! 调试直通 UI）。
//!
//! 协议见 docs/OneTHU-插件与接口指南.md「Rust 骨干插件」。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// 一个在跑的插件进程：IO 句柄 + host 侧调用应答表
struct ProcIo {
    child: Mutex<Option<Child>>,
    /// tokio Mutex：stdin 写入跨 await（async-aware，Send 无虞）
    stdin: tokio::sync::Mutex<tokio::process::ChildStdin>,
    pending: PendingMap,
}

/// 全部在跑的 Rust 插件进程
#[derive(Default)]
pub struct PluginHost {
    procs: Mutex<HashMap<String, Arc<ProcIo>>>,
    next_id: AtomicU64,
}

#[tauri::command]
pub async fn plugin_spawn(
    app: AppHandle,
    state: tauri::State<'_, PluginHost>,
    plugin_id: String,
    bin_path: String,
    args: Option<Vec<String>>,
) -> Result<(), String> {
    let path = PathBuf::from(&bin_path);
    if !path.is_file() {
        return Err(format!("插件二进制不存在：{bin_path}"));
    }
    plugin_kill_inner(&state, &plugin_id).await;

    let mut child = Command::new(&path)
        .args(args.unwrap_or_default())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("插件进程启动失败：{e}"))?;
    let mut stdin = child.stdin.take().ok_or("无法取得插件 stdin")?;
    let stdout = child.stdout.take().ok_or("无法取得插件 stdout")?;
    let stderr = child.stderr.take().ok_or("无法取得插件 stderr")?;

    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
    let proc = Arc::new(ProcIo {
        child: Mutex::new(Some(child)),
        stdin: tokio::sync::Mutex::new(stdin),
        pending: pending.clone(),
    });
    state
        .procs
        .lock()
        .map_err(|_| "宿主状态锁中毒")?
        .insert(plugin_id.clone(), proc);

    // stderr → log 事件（Rust eprintln! 直达 UI）
    {
        let app = app.clone();
        let pid = plugin_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "plugin-event",
                    json!({"pluginId": pid, "method": "log", "params": {"line": line}}),
                );
            }
        });
    }

    // stdout：JSON-RPC 分发
    {
        let app = app.clone();
        let pid = plugin_id.clone();
        let host = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        // 非 JSON 行当日志（原型期 println! 直通）
                        let _ = app.emit(
                            "plugin-event",
                            json!({"pluginId": pid, "method": "log", "params": {"line": line}}),
                        );
                        continue;
                    }
                };
                let id = msg.get("id").cloned();
                let method = msg.get("method").and_then(|m| m.as_str()).map(String::from);
                if method.is_none() {
                    // host 发起调用的应答
                    if let Some(tx) = id.as_ref().and_then(|i| i.as_u64()).and_then(|i| {
                        host.state::<PluginHost>().procs.lock().ok().and_then(|m| m.get(&pid).cloned()).and_then(|p| {
                            p.pending.lock().ok().and_then(|mut map| map.remove(&i))
                        })
                    }) {
                        let outcome = if let Some(e) = msg.get("error") {
                            Err(e.to_string())
                        } else {
                            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = tx.send(outcome);
                    }
                    continue;
                }
                let method = method.unwrap();
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                if id.is_some() {
                    // 插件 → host 请求（onethu.call 等）：转 webview 门面执行后回写
                    let _ = app.emit(
                        "plugin-rpc",
                        json!({"pluginId": pid, "id": id, "method": method, "params": params}),
                    );
                } else {
                    // 通知（progress/log/history 等）→ 直转 UI
                    let _ = app.emit("plugin-event", json!({"pluginId": pid, "method": method, "params": params}));
                }
            }
            // stdout 关闭 = 进程退出：摘表 + 通知 UI
            host.state::<PluginHost>().procs.lock().ok().and_then(|mut m| m.remove(&pid));
            let _ = app.emit("plugin-event", json!({"pluginId": pid, "method": "exit", "params": {}}));
        });
    }

    let _ = app.emit(
        "plugin-event",
        json!({"pluginId": plugin_id, "method": "spawned", "params": {"bin": bin_path}}),
    );
    Ok(())
}

async fn write_line(proc: &Arc<ProcIo>, line: &Value) -> Result<(), String> {
    let mut s = serde_json::to_string(line).map_err(|e| e.to_string())?;
    s.push('\n');
    let mut stdin = proc.stdin.lock().await;
    stdin
        .write_all(s.as_bytes())
        .await
        .map_err(|e| format!("插件 stdin 写入失败：{e}"))
}

#[tauri::command]
pub async fn plugin_call(
    state: tauri::State<'_, PluginHost>,
    plugin_id: String,
    method: String,
    params: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let proc = state
        .procs
        .lock()
        .map_err(|_| "宿主状态锁中毒")?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("插件进程未运行：{plugin_id}"))?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    proc.pending
        .lock()
        .map_err(|_| "应答表锁中毒")?
        .insert(id, tx);
    write_line(
        &proc,
        &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
    )
    .await?;
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(600_000));
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(res)) => res,
        Ok(Err(_)) => Err("插件应答通道关闭（进程退出？）".into()),
        Err(_) => {
            proc.pending.lock().ok().and_then(|mut m| m.remove(&id));
            Err(format!("插件调用超时（{method}）"))
        }
    }
}

#[tauri::command]
pub async fn plugin_notify(
    state: tauri::State<'_, PluginHost>,
    plugin_id: String,
    method: String,
    params: Value,
) -> Result<(), String> {
    let proc = state
        .procs
        .lock()
        .map_err(|_| "宿主状态锁中毒")?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("插件进程未运行：{plugin_id}"))?;
    write_line(&proc, &json!({"jsonrpc": "2.0", "method": method, "params": params})).await
}

/// webview 门面执行完 onethu.call 后回写结果给插件
#[tauri::command]
pub async fn plugin_rpc_reply(
    state: tauri::State<'_, PluginHost>,
    plugin_id: String,
    id: Value,
    ok: bool,
    result: Value,
) -> Result<(), String> {
    let proc = state
        .procs
        .lock()
        .map_err(|_| "宿主状态锁中毒")?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("插件进程未运行：{plugin_id}"))?;
    if ok {
        write_line(&proc, &json!({"jsonrpc": "2.0", "id": id, "result": result})).await
    } else {
        write_line(&proc, &json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": result}})).await
    }
}

async fn plugin_kill_inner(state: &tauri::State<'_, PluginHost>, plugin_id: &str) {
    let taken = state
        .procs
        .lock()
        .ok()
        .and_then(|mut m| m.remove(plugin_id))
        .and_then(|proc| proc.child.lock().ok().and_then(|mut c| c.take()));
    if let Some(mut child) = taken {
        let _ = child.kill().await;
    }
}

#[tauri::command]
pub async fn plugin_kill(state: tauri::State<'_, PluginHost>, plugin_id: String) -> Result<(), String> {
    plugin_kill_inner(&state, &plugin_id).await;
    Ok(())
}
