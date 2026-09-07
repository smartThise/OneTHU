//! OneTHU Harness 内嵌宿主（移动端形态）：Rust 骨干核心（onethu-harness-core）
//! 直接编进 App 进程，不经 sidecar 进程——Android 无任意路径二进制执行权限。
//!
//! - `Host`（onethu.call 数据面 + 打断标志）：经 Tauri 事件桥转发 webview 门面执行，
//!   权限门禁与 sidecar/js 插件完全同一套（webview 侧 bindRustApi）；
//! - `Emit`（progress/log 通知）：app.emit("plugin-event") 直达 UI，事件契约与
//!   sidecar 泵（plugins.rs）逐字段一致；
//! - 会话/设置存储仍落 webview localStorage（storage.* 走同一桥）。
//!
//! 线程模型：agent 线程串行处理 run 请求（chat 一轮跑完才接下一发）；
//! 桥线程专等 webview 回执；打断是 AtomicBool 快路径（stdio 读线程同款语义）。

use onethu_harness_core::{activate_commands, dispatch, Emit, Host};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 门面回执等待上限：webview 门面 http_request 自带 45s 超时，storage/session
/// 毫秒级；600s 是「webview 整个没了」级别的兜底。
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(15);

type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

/// 桥共享态：自增 id + 回执表
struct BridgeState {
    next_id: AtomicU64,
    pending: PendingMap,
}

/// agent → 桥的一次 onethu.call
struct CallReq {
    ns: String,
    method: String,
    args: Value,
    reply: mpsc::Sender<Result<Value, String>>,
}

/// 内嵌 agent 的宿主句柄（Host 实现：数据面走桥，打断是本进程原子量）
struct AgentCtx {
    call_tx: mpsc::Sender<CallReq>,
    interrupt: Arc<AtomicBool>,
}

impl Host for AgentCtx {
    fn call(&mut self, ns: &str, method: &str, args: Value) -> Result<Value, String> {
        let (tx, rx) = mpsc::channel();
        self.call_tx
            .send(CallReq { ns: ns.to_string(), method: method.to_string(), args, reply: tx })
            .map_err(|_| "内嵌桥已关闭（插件已停止）".to_string())?;
        rx.recv_timeout(BRIDGE_TIMEOUT)
            .map_err(|_| "门面应答通道关闭（桥线程退出？）".to_string())?
    }

    fn interrupted(&self) -> bool {
        self.interrupt.load(Ordering::SeqCst)
    }

    fn reset_interrupt(&self) {
        self.interrupt.store(false, Ordering::SeqCst);
    }
}

/// 通知面：独立小对象——dispatch(h, emit) 两参借用互不冲突
struct AgentEmit {
    app: AppHandle,
    plugin_id: String,
}

impl Emit for AgentEmit {
    fn notify(&self, method: &str, params: Value) {
        let _ = self.app.emit(
            "plugin-event",
            json!({ "pluginId": self.plugin_id, "method": method, "params": params }),
        );
    }
}

enum AgentMsg {
    Run { method: String, params: Value, reply: mpsc::Sender<Result<Value, String>> },
    Dispose,
}

struct HarnessLive {
    tx: mpsc::Sender<AgentMsg>,
    interrupt: Arc<AtomicBool>,
    bridge: Arc<BridgeState>,
    /// 控制命令快速路用：调用线程以独立 AgentCtx 直发桥（不经 agent 串行队列）
    call_tx: mpsc::Sender<CallReq>,
}

/// 全部在跑的内嵌 harness 实例
static BRIDGE_Q: std::sync::Mutex<Vec<(String, u64, Value)>> = std::sync::Mutex::new(Vec::new());
static BRIDGE_CV: std::sync::Condvar = std::sync::Condvar::new();

/// JS 侧长轮询：挂起直到该插件有待处理调用（最多 25s），一次取走整批
#[tauri::command]
pub fn harness_bridge_take(plugin_id: String) -> Vec<Value> {
    let mut q = BRIDGE_Q.lock().unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    while !q.iter().any(|(p, _, _)| p == &plugin_id) {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() { break; }
        let (g, _) = BRIDGE_CV.wait_timeout(q, left).unwrap();
        q = g;
    }
    let mut out = Vec::new();
    q.retain(|(p, _, payload)| {
        if p == &plugin_id { out.push(payload.clone()); false } else { true }
    });
    out
}

#[derive(Default)]
pub struct HarnessHost {
    live: Mutex<HashMap<String, Arc<HarnessLive>>>,
}

/// 启动内嵌 agent：起 agent 线程 + 门面桥线程，返回 activate 应答（commands 清单）。
#[tauri::command]
pub fn harness_start(
    app: AppHandle,
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
) -> Result<Value, String> {
    // 幂等：已存活先摘（旧线程随通道关闭自行退场）
    harness_stop_inner(&state, &plugin_id);

    let interrupt = Arc::new(AtomicBool::new(false));
    let bridge = Arc::new(BridgeState {
        next_id: AtomicU64::new(1),
        pending: Arc::new(Mutex::new(HashMap::new())),
    });

    // 门面桥线程：onethu.call → "plugin-rpc" 事件 → webview 执行 → harness_rpc_reply 回写
    let (call_tx, call_rx) = mpsc::channel::<CallReq>();
    {
        let app = app.clone();
        let pid = plugin_id.clone();
        let b = bridge.clone();
        std::thread::spawn(move || {
            while let Ok(req) = call_rx.recv() {
                let id = b.next_id.fetch_add(1, Ordering::Relaxed);
                let (rtx, rrx) = mpsc::channel::<Result<Value, String>>();
                if let Ok(mut m) = b.pending.lock() {
                    m.insert(id, rtx);
                }
                // 长轮询批量泵：入全局队列 + 唤醒 take，替代每次调用一次事件往返
                if let Ok(mut q) = BRIDGE_Q.lock() {
                    q.push((pid.clone(), id, json!({
                        "pluginId": pid, "id": id, "method": "onethu.call",
                        "params": { "ns": req.ns, "method": req.method, "args": req.args }
                    })));
                }
                BRIDGE_CV.notify_all();
                let res = rrx
                    .recv_timeout(BRIDGE_TIMEOUT)
                    .unwrap_or_else(|_| Err("webview 门面应答超时（600s）".into()));
                if let Ok(mut m) = b.pending.lock() {
                    m.remove(&id);
                }
                let _ = req.reply.send(res);
            }
        });
    }

    // agent 线程：串行 Run；Dispose 收尾退出
    let (msg_tx, msg_rx) = mpsc::channel::<AgentMsg>();
    {
        let app = app.clone();
        let pid = plugin_id.clone();
        let flag = interrupt.clone();
        let tx = call_tx.clone();
        std::thread::spawn(move || {
            let emit = AgentEmit { app, plugin_id: pid };
            let mut ctx = AgentCtx { call_tx: tx, interrupt: flag };
            eprintln!("[harness:embedded] agent 线程就绪");
            while let Ok(msg) = msg_rx.recv() {
                match msg {
                    AgentMsg::Run { method, params, reply } => match method.as_str() {
                        "run" => {
                            ctx.reset_interrupt();
                            let command =
                                params.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let input =
                                params.get("input").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let out = dispatch(&mut ctx, &emit, &command, &input);
                            let _ = reply.send(Ok(out));
                        }
                        "activate" => {
                            let _ = reply.send(Ok(activate_commands()));
                        }
                        other => {
                            let _ = reply.send(Err(format!("内嵌 harness 未知方法：{other}")));
                        }
                    },
                    AgentMsg::Dispose => break,
                }
            }
            eprintln!("[harness:embedded] agent 线程退出");
        });
    }

    state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .insert(
            plugin_id.clone(),
            Arc::new(HarnessLive { tx: msg_tx, interrupt, bridge, call_tx: call_tx.clone() }),
        );
    let _ = app.emit(
        "plugin-event",
        json!({ "pluginId": plugin_id, "method": "spawned", "params": { "mode": "embedded" } }),
    );
    Ok(activate_commands())
}

/// 调用内嵌 agent（activate/run/dispose 同一通道；同步命令——长跑 chat 独占
/// 专属线程，不占异步运行时）。超时与 sidecar 的 plugin_call 同款默认 600s。
#[tauri::command]
pub fn harness_call(
    app: AppHandle,
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
    method: String,
    params: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let live = state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("内嵌插件未运行：{plugin_id}"))?;
    // 控制命令快速路：chat 之外的 run 直接在调用线程分发——不被在跑的长任务卡住，
    // 否则新会话/历史/导入导出在 chat 进行中形同死键（与 sidecar 旁路线程同语义）。
    // 绝不 reset_interrupt：会清掉在跑 chat 的打断标志。
    if method == "run" {
        let command = params.get("command").and_then(|v| v.as_str()).unwrap_or("");
        if command != "chat" && !command.is_empty() {
            let command = command.to_string();
            let input = params.get("input").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut ctx = AgentCtx { call_tx: live.call_tx.clone(), interrupt: live.interrupt.clone() };
            let emit = AgentEmit { app, plugin_id: plugin_id.clone() };
            return Ok(dispatch(&mut ctx, &emit, &command, &input));
        }
    }
    let (tx, rx) = mpsc::channel::<Result<Value, String>>();
    live.tx
        .send(AgentMsg::Run { method: method.clone(), params, reply: tx })
        .map_err(|_| "内嵌 agent 已退出".to_string())?;
    match rx.recv_timeout(Duration::from_millis(timeout_ms.unwrap_or(600_000))) {
        Ok(res) => res,
        Err(_) => Err(format!("内嵌 harness 调用超时（{method}）")),
    }
}

/// 宿主通知：interrupt 置快路径标志（llm 流逐块检查，毫秒级生效）
#[tauri::command]
pub fn harness_notify(
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
    method: String,
    params: Value,
) -> Result<(), String> {
    let _ = params;
    let live = state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("内嵌插件未运行：{plugin_id}"))?;
    if method == "interrupt" {
        live.interrupt.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// webview 门面执行完 onethu.call 后回写结果（桥线程据此唤醒 agent）
#[tauri::command]
pub fn harness_rpc_reply(
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
    id: u64,
    ok: bool,
    result: Value,
) -> Result<(), String> {
    let live = state
        .live
        .lock()
        .map_err(|_| "状态锁中毒".to_string())?
        .get(&plugin_id)
        .cloned()
        .ok_or(format!("内嵌插件未运行：{plugin_id}"))?;
    if let Some(tx) = live.bridge.pending.lock().ok().and_then(|mut m| m.remove(&id)) {
        let outcome = if ok {
            Ok(result)
        } else {
            Err(match result {
                Value::String(s) => s,
                other => other.to_string(),
            })
        };
        let _ = tx.send(outcome);
    }
    Ok(())
}

/// 停止：摘表 + 置打断（在跑的一轮尽快收）+ 发 Dispose（agent 线程回完当前消息即退）
/// 并补发 exit 事件——与 sidecar 泵（plugins.rs stdout 关闭）事件契约一致，
/// 对话面板据此强制解锁（打断死人开关之外的确定性收尾）。
#[tauri::command]
pub fn harness_stop(
    app: AppHandle,
    state: tauri::State<'_, HarnessHost>,
    plugin_id: String,
) -> Result<(), String> {
    if harness_stop_inner(&state, &plugin_id) {
        let _ = app.emit(
            "plugin-event",
            json!({ "pluginId": plugin_id, "method": "exit", "params": { "mode": "embedded" } }),
        );
    }
    Ok(())
}

fn harness_stop_inner(state: &tauri::State<'_, HarnessHost>, plugin_id: &str) -> bool {
    state
        .live
        .lock()
        .ok()
        .and_then(|mut m| m.remove(plugin_id))
        .map(|live| {
            live.interrupt.store(true, Ordering::SeqCst);
            let _ = live.tx.send(AgentMsg::Dispose);
        })
        .is_some()
}
