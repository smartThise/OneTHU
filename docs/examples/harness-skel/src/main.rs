use serde_json::{json, Value};
use std::io::{BufRead, StdinLock, Write};

fn send(v: &Value) {
    let mut s = serde_json::to_string(v).unwrap();
    s.push('\n');
    let _ = std::io::stdout().write_all(s.as_bytes());
    let _ = std::io::stdout().flush();
}

/// 调一次宿主 API：**复用外层唯一的 stdin 锁**（std 锁不可重入，
/// 在循环里再 stdin().lock() 会死锁——此坑已实测）。
fn onethu(in_: &mut StdinLock, id: &mut u64, ns: &str, method: &str, args: Value) -> Result<Value, String> {
    *id += 1;
    let rid = *id;
    send(&json!({"jsonrpc":"2.0","id":rid,"method":"onethu.call","params":{"ns":ns,"method":method,"args":args}}));
    let mut line = String::new();
    in_.read_line(&mut line).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if let Some(err) = v.get("error") { return Err(err.to_string()); }
    Ok(v.get("result").cloned().unwrap_or(Value::Null))
}

fn main() {
    let mut next_id: u64 = 1000;
    let stdin = std::io::stdin();
    let mut handle = stdin.lock(); // 全程唯一锁
    let mut line = String::new();
    loop {
        line.clear();
        if handle.read_line(&mut line).unwrap_or(0) == 0 { break; }
        let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else { continue };
        let mid = msg.get("id").cloned();
        match msg.get("method").and_then(|m| m.as_str()) {
            Some("activate") => send(&json!({"jsonrpc":"2.0","id":mid,"result":{"commands":[
                {"id":"run","title":"执行任务","inputLabel":"指令","inputPlaceholder":"例：明天图书馆哪有空座"}]}})),
            Some("run") => {
                send(&json!({"jsonrpc":"2.0","method":"progress","params":{"text":"开始…","step":1,"total":2}}));
                let status = onethu(&mut handle, &mut next_id, "session", "status", json!([]));
                send(&json!({"jsonrpc":"2.0","id":mid,"result":format!("会话状态：{status:?}")}));
            }
            Some("dispose") => { if let Some(id) = mid { send(&json!({"jsonrpc":"2.0","id":id,"result":null})); } std::process::exit(0); }
            Some("interrupt") => {}
            _ => {}
        }
    }
}
