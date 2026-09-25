//! 桌面端通知投递入口（macOS 已实现；Windows 待接）。
//!
//! 与 Android 的关系：Android 走 onethu-mobile 插件落到 AlarmManager，桌面走本模块。
//! 三端共用同一份「计划」（JS 侧 notifyPlan.ts）与同一套「对齐口径」
//! （JS 侧 notifyScheduler.ts：内容变或原生丢了就排、计划没有就撤、一致则不动），
//! 这里只负责把单条通知真正交给系统，并如实回报失败原因。
//!
//! 渠道概念是 Android 特有的（NotificationChannel）；macOS 没有等价物，
//! 故 `channel` 字段在桌面端被忽略，不影响 JS 侧共用一份载荷。

use serde_json::{json, Value};

/// 单条待排通知（JS 侧载荷的子集；channel 是 Android 特有概念，桌面端忽略）
struct Item {
    id: String,
    at: i64,
    title: String,
    body: String,
    /// 点击落点（Windows 写进 toast 的 launch 属性；macOS 暂未接深链）
    target: String,
}

fn parse_items(items_json: &str) -> Result<Vec<Item>, String> {
    let raw: Value = serde_json::from_str(items_json).map_err(|e| format!("载荷解析失败：{e}"))?;
    let arr = raw.as_array().ok_or_else(|| "载荷应为数组".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        let id = v.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let at = v.get("at").and_then(Value::as_i64).unwrap_or(0);
        if id.is_empty() || at <= 0 {
            continue;
        }
        out.push(Item {
            id,
            at,
            title: v.get("title").and_then(Value::as_str).unwrap_or("OneTHU").to_string(),
            body: v.get("body").and_then(Value::as_str).unwrap_or_default().to_string(),
            target: v.get("target").and_then(Value::as_str).unwrap_or_default().to_string(),
        });
    }
    Ok(out)
}

/// 1601-01-01 → 1970-01-01 的 100 纳秒数（WinRT DateTime 的纪元）
pub(crate) const EPOCH_DIFF_100NS: i64 = 116_444_736_000_000_000;

/// Unix 毫秒 → WinRT DateTime 的 100 纳秒计数。
/// 放在这里而不是 notify_windows 里：纯换算，任何平台都能单测（Windows 模块在 macOS 上编不进来）。
pub(crate) fn dt_from_unix_ms(ms: i64) -> i64 {
    ms.saturating_mul(10_000).saturating_add(EPOCH_DIFF_100NS)
}

/// toast XML 文本转义。标题/正文来自课名与作业名，出现 `&`、`<` 是常态
/// （如「数据结构 & 算法」），漏转义会让整条 toast 载荷非法、静默失败。
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// WinRT toast 载荷（ToastGeneric）：launch 承载点击落点
pub(crate) fn toast_xml(title: &str, body: &str, target: &str) -> String {
    format!(
        "<toast launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        xml_escape(target),
        xml_escape(title),
        xml_escape(body)
    )
}

fn parse_ids(ids_json: &str) -> Vec<String> {
    serde_json::from_str::<Value>(ids_json)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// 本机后端类型（前端据此决定是否启动调度链）
#[cfg(target_os = "macos")]
pub fn backend() -> String {
    "macos".into()
}

#[cfg(target_os = "windows")]
pub fn backend() -> String {
    "windows".into()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn backend() -> String {
    "none".into()
}

/// 打开系统通知设置页。macOS 与 Windows 都能用 URL scheme 直达，
/// 不引入额外依赖；失败如实回报（用户仍可自己去系统设置）。
#[cfg(target_os = "macos")]
pub fn open_settings(what: &str) -> Value {
    let url = match what {
        "exact-alarm" => "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
        _ => "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    };
    match std::process::Command::new("open").arg(url).status() {
        Ok(st) if st.success() => json!({ "ok": true }),
        Ok(st) => json!({ "ok": false, "reason": format!("open 退出码 {:?}", st.code()) }),
        Err(e) => json!({ "ok": false, "reason": e.to_string() }),
    }
}

#[cfg(target_os = "windows")]
pub fn open_settings(what: &str) -> Value {
    let target = match what {
        "exact-alarm" => "ms-settings:notifications",
        _ => "ms-settings:notifications",
    };
    // CREATE_NO_WINDOW：cmd.exe 是控制台程序，不压掉会闪一个黑框
    let st = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .creation_flags(0x0800_0000)
            .status()
    };
    match st {
        Ok(st) if st.success() => json!({ "ok": true }),
        Ok(st) => json!({ "ok": false, "reason": format!("cmd 退出码 {:?}", st.code()) }),
        Err(e) => json!({ "ok": false, "reason": e.to_string() }),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn open_settings(_what: &str) -> Value {
    json!({ "ok": false, "reason": "not-implemented-desktop" })
}

/* ── macOS ── */

#[cfg(target_os = "macos")]
pub fn permission(request: bool) -> Value {
    match crate::notify_macos::status(request) {
        Ok(granted) => json!({ "ok": true, "granted": granted, "exact": true, "platform": "macos" }),
        Err(e) => json!({ "ok": false, "granted": false, "exact": false, "reason": e }),
    }
}

#[cfg(target_os = "macos")]
pub fn schedule(items_json: &str) -> Value {
    let items = match parse_items(items_json) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "scheduled": 0, "reason": e }),
    };
    let mut scheduled = 0usize;
    let mut last_err: Option<String> = None;
    for it in &items {
        match crate::notify_macos::add(&it.id, it.at, &it.title, &it.body, &it.target) {
            Ok(()) => scheduled += 1,
            Err(e) => last_err = Some(e),
        }
    }
    let failed = items.len() - scheduled;
    json!({
        "ok": failed == 0,
        "scheduled": scheduled,
        "failed": failed,
        "exact": true,
        "reason": last_err.unwrap_or_default()
    })
}

#[cfg(target_os = "macos")]
pub fn cancel(ids_json: &str) -> Value {
    let ids = parse_ids(ids_json);
    let n = ids.len();
    crate::notify_macos::cancel(&ids);
    json!({ "ok": true, "cancelled": n })
}

#[cfg(target_os = "macos")]
pub fn pending() -> Value {
    match crate::notify_macos::pending_ids() {
        Ok(ids) => json!({ "ok": true, "ids": ids }),
        Err(e) => json!({ "ok": false, "ids": [], "reason": e }),
    }
}

#[cfg(target_os = "macos")]
pub fn test() -> Value {
    match crate::notify_macos::test() {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

/// 立即投递一条通知（事件驱动，如校园卡余额预警）。
///
/// macOS 的 UNUserNotificationCenter 只有「定时触发」一条路，故按 1.5 秒后的时刻投递：
/// 在用户感知里就是立刻，且不需要为此引入第二套投递机制（与 `test()` 同一做法）。
#[cfg(target_os = "macos")]
pub fn post(id: &str, title: &str, body: &str, _channel: &str, target: &str) -> Value {
    match crate::notify_macos::post(id, title, body, target) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

/// 撤回**已展示**的通知（待投递的那条由 `cancel` 管）
#[cfg(target_os = "macos")]
pub fn dismiss(ids_json: &str) -> Value {
    let ids = parse_ids(ids_json);
    let n = ids.len();
    match crate::notify_macos::remove_delivered(&ids) {
        Ok(()) => json!({ "ok": true, "dismissed": n }),
        Err(e) => json!({ "ok": false, "dismissed": 0, "reason": e }),
    }
}

/* ── Windows（WinRT toast + AddToSchedule） ── */

#[cfg(target_os = "windows")]
pub fn permission(request: bool) -> Value {
    match crate::notify_windows::status(request) {
        Ok(granted) => json!({ "ok": true, "granted": granted, "exact": true, "platform": "windows" }),
        Err(e) => json!({ "ok": false, "granted": false, "exact": false, "reason": e }),
    }
}

#[cfg(target_os = "windows")]
pub fn schedule(items_json: &str) -> Value {
    let items = match parse_items(items_json) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "scheduled": 0, "reason": e }),
    };
    let mut scheduled = 0usize;
    let mut last_err: Option<String> = None;
    for it in &items {
        match crate::notify_windows::add(&it.id, it.at, &it.title, &it.body, &it.target) {
            Ok(()) => scheduled += 1,
            Err(e) => last_err = Some(e),
        }
    }
    let failed = items.len() - scheduled;
    json!({
        "ok": failed == 0,
        "scheduled": scheduled,
        "failed": failed,
        "exact": true,
        "reason": last_err.unwrap_or_default()
    })
}

#[cfg(target_os = "windows")]
pub fn cancel(ids_json: &str) -> Value {
    let ids = parse_ids(ids_json);
    let n = ids.len();
    crate::notify_windows::cancel(&ids);
    json!({ "ok": true, "cancelled": n })
}



/* ── 启动初始化 ── */

/// macOS 需要在启动时尽早装 delegate（冷启动点击路径）；其余平台无事可做
#[cfg(target_os = "macos")]
pub fn init() {
    crate::notify_macos::init();
}

#[cfg(not(target_os = "macos"))]
pub fn init() {}

/* ── 点击落点取回 ── */

/// macOS：delegate 把点击的通知 id 反查成落点存下来，这里取走（取走即清）
#[cfg(target_os = "macos")]
pub fn take_target() -> Value {
    let target = crate::notify_macos::take_target();
    json!({ "ok": true, "target": target })
}

/// Windows：toast 的点击要注册 COM 激活器才能回传（见 notify_windows.rs 文件头），
/// 当前如实回报未接，前端据此只把应用带到前台。
#[cfg(target_os = "windows")]
pub fn take_target() -> Value {
    json!({ "ok": false, "target": "", "reason": "activation-not-wired" })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn take_target() -> Value {
    json!({ "ok": false, "target": "", "reason": "not-implemented-desktop" })
}

#[cfg(target_os = "windows")]
pub fn pending() -> Value {
    match crate::notify_windows::pending_ids() {
        Ok(ids) => json!({ "ok": true, "ids": ids }),
        Err(e) => json!({ "ok": false, "ids": [], "reason": e }),
    }
}

#[cfg(target_os = "windows")]
pub fn test() -> Value {
    match crate::notify_windows::test() {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

/// 立即投递一条通知（事件驱动，如校园卡余额预警）：WinRT 的 toast 直接 Show，
/// 不进 AddToSchedule（那是排程通道）。
#[cfg(target_os = "windows")]
pub fn post(id: &str, title: &str, body: &str, _channel: &str, target: &str) -> Value {
    match crate::notify_windows::post(id, title, body, target) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

/// 撤回**已展示**的通知（按 Tag 从通知历史里移除）
#[cfg(target_os = "windows")]
pub fn dismiss(ids_json: &str) -> Value {
    let ids = parse_ids(ids_json);
    let n = ids.len();
    match crate::notify_windows::dismiss(&ids) {
        Ok(()) => json!({ "ok": true, "dismissed": n }),
        Err(e) => json!({ "ok": false, "dismissed": 0, "reason": e }),
    }
}

/* ── 其他桌面平台（Linux 等）：无后端 ── */

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn permission(_request: bool) -> Value {
    json!({ "ok": false, "granted": false, "exact": false, "reason": "not-implemented-desktop" })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn schedule(_items_json: &str) -> Value {
    json!({ "ok": false, "scheduled": 0, "reason": "not-implemented-desktop" })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn cancel(_ids_json: &str) -> Value {
    json!({ "ok": false, "cancelled": 0, "reason": "not-implemented-desktop" })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn pending() -> Value {
    json!({ "ok": false, "ids": [], "reason": "not-implemented-desktop" })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn test() -> Value {
    json!({ "ok": false, "reason": "not-implemented-desktop" })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn post(_id: &str, _title: &str, _body: &str, _channel: &str, _target: &str) -> Value {
    json!({ "ok": false, "reason": "not-implemented-desktop" })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn dismiss(_ids_json: &str) -> Value {
    json!({ "ok": false, "dismissed": 0, "reason": "not-implemented-desktop" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn backend_is_known_value() {
        let b = backend();
        // 前端按这个值决定是否启动调度链，返回空串或未约定值会让 macOS 静默不工作
        assert!(matches!(b.as_str(), "macos" | "windows" | "none"), "未知后端：{b}");
    }

    #[test]
    fn parse_items_keeps_valid_and_drops_broken() {
        let payload = json!([
            { "id": "ddl:h1:120", "at": 1_760_000_000_000i64, "title": "DDL · 高数", "body": "第三章习题" },
            { "id": "", "at": 1_760_000_000_000i64 },                 // 缺 id
            { "id": "x", "at": 0 },                                    // 时刻非法
            { "at": 1_760_000_000_000i64 }                             // 缺 id
        ])
        .to_string();
        let items = parse_items(&payload).expect("载荷应可解析");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "ddl:h1:120");
        assert_eq!(items[0].title, "DDL · 高数");
    }

    #[test]
    fn parse_items_tolerates_missing_optional_fields() {
        let payload = json!([{ "id": "class:a", "at": 1_760_000_000_000i64 }]).to_string();
        let items = parse_items(&payload).expect("载荷应可解析");
        assert_eq!(items[0].title, "OneTHU");   // 缺标题时的兜底，不该是空串
        assert_eq!(items[0].body, "");
    }

    #[test]
    fn bad_payload_reports_reason_instead_of_panicking() {
        let v = schedule("{ 不是 JSON");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["scheduled"], json!(0));
        assert!(v["reason"].as_str().unwrap_or("").contains("解析失败"));
    }

    #[test]
    fn payload_must_be_array() {
        let v = schedule("{\"id\":\"a\"}");
        assert_eq!(v["ok"], json!(false));
        assert!(v["reason"].as_str().unwrap_or("").contains("数组"));
    }

    #[test]
    fn parse_ids_ignores_non_strings() {
        let ids = parse_ids("[\"a\", 1, null, \"b\"]");
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
        assert!(parse_ids("不是数组").is_empty());
    }

    #[test]
    fn xml_escape_covers_common_course_names() {
        let xml = toast_xml("DDL · 数据结构 & 算法", "第三章 <习题> 「A>B」", "learn");
        assert!(xml.contains("数据结构 &amp; 算法"));
        assert!(xml.contains("第三章 &lt;习题&gt;"));
        assert!(!xml.contains("<习题>"), "未转义会把载荷弄非法");
        assert!(xml.contains("launch=\"learn\""));
        assert!(xml.starts_with("<toast") && xml.ends_with("</toast>"));
    }

    #[test]
    fn unix_ms_to_winrt_datetime() {
        // 纪元差值的来历：1601-01-01 → 1970-01-01 共 11_644_473_600 秒，1 秒 = 10^7 个 100ns
        assert_eq!(EPOCH_DIFF_100NS, 11_644_473_600i64 * 10_000_000);
        // 1970-01-01T00:00:00Z 落在纪元差值上；1 秒 = 10^7 个单位
        assert_eq!(dt_from_unix_ms(0), EPOCH_DIFF_100NS);
        assert_eq!(dt_from_unix_ms(1000) - dt_from_unix_ms(0), 10_000_000);
        // 单调性 + 不溢出（2100 年附近的时刻仍为正）
        let a = dt_from_unix_ms(1_789_862_400_000);
        let b = dt_from_unix_ms(1_789_862_401_000);
        assert!(b > a && a > EPOCH_DIFF_100NS);
    }

    #[test]
    fn cancel_with_empty_ids_is_ok() {
        let v = cancel("[]");
        assert_eq!(v["ok"], json!(true));
        assert_eq!(v["cancelled"], json!(0));
    }
}
