//! macOS 系统通知：UNUserNotificationCenter（objc2 绑定）。
//!
//! 为什么用它而不是自建定时器：请求交给系统守护进程持久化，**App 未运行时也会送达**
//! ——这正是「关掉应用还能收到 DDL 提醒」的唯一实现路径。
//!
//! 两个已知边界：
//!   · 待投递上限 64 条（系统硬限制）。计划上限 56 条由 JS 侧 `notifyPlan.maxItems`
//!     保证，这里如实回报投递失败，不静默丢弃。
//!   · 通知点击会走 delegate：排程时把落点写进通知的 userInfo，点击时由
//!     `NotifiDelegate` 取出存下，App 回前台时经 `notify_take_target` 取走并导航。
//!
//! 未打包进程（无 .app 外壳、无 bundle id）调用通知中心会拿到 nil 甚至崩，
//! 故入口先查 bundle id 并回报 `not-bundled`——dev-launch.sh 走 .app wrapper，
//! 正常开发路径不受影响。

use std::ptr::NonNull;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::{mpsc, LazyLock, Mutex};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread};
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSettings,
    UNTimeIntervalNotificationTrigger, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

/// 点击通知后要落的页面（由 delegate 取出，App 回前台时取走并清空）。
static LAUNCH_TARGET: Mutex<String> = Mutex::new(String::new());
/// 通知 id → 落点：点击回调只拿得到 identifier，故排程时在这里记一份。
/// （比往 userInfo 塞 NSDictionary 简单得多——那要绕 objc2 的泛型约束，
///  而 identifier 本来就随通知往返系统，是天然的键。）
///
/// **落盘**：用户可能是「点通知把应用冷启动」的，那时内存表是空的——不落盘就查不到落点。
/// 文件放 `~/Library/Application Support/<bundle-id>/onethu-notify-targets.json`。
static TARGETS: LazyLock<Mutex<std::collections::HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(load_targets()));

fn targets_file() -> Option<std::path::PathBuf> {
    let bundle = unsafe { NSBundle::mainBundle() };
    let id = unsafe { bundle.bundleIdentifier() }?.to_string();
    let home = std::env::var_os("HOME")?;
    Some(
        std::path::PathBuf::from(home)
            .join("Library/Application Support")
            .join(id)
            .join("onethu-notify-targets.json"),
    )
}

/// 落点表 JSON → 映射。坏内容一律回落空表：这个文件只是「点击后跳到哪」的线索，
/// 读不出来顶多降级成「把应用带到前台」，绝不该让通知链路因此报错。
fn parse_targets(raw: &str) -> std::collections::HashMap<String, String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn load_targets() -> std::collections::HashMap<String, String> {
    let Some(path) = targets_file() else {
        return Default::default();
    };
    std::fs::read_to_string(path)
        .map(|raw| parse_targets(&raw))
        .unwrap_or_default()
}

fn save_targets(map: &std::collections::HashMap<String, String>) {
    let Some(path) = targets_file() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(raw) = serde_json::to_string(map) {
        let _ = std::fs::write(path, raw);
    }
}

/// 启动时尽早装 delegate：用户可能正是「点通知把应用冷启动」的那条路径，
/// 晚装一步，这次点击的落点就丢了。
pub fn init() {
    if let Ok(center) = center() {
        ensure_delegate(&center);
        // 顺带把落点表读进来（惰性静态在此刻初始化，冷启动路径才能反查到 id）
        if let Ok(m) = TARGETS.lock() {
            let _ = m.len();
        }
    }
}
/// 通知中心的 delegate 是**弱引用**，必须自己持有；故意泄漏一个对象换「进程内唯一且永不释放」。
static DELEGATE: AtomicPtr<NotifyDelegate> = AtomicPtr::new(std::ptr::null_mut());

struct NotifyDelegateIvars;

define_class!(
    // SAFETY: 类只实现了通知中心的可选回调，不持有任何 Rust 所有权数据
    #[unsafe(super(NSObject))]
    #[name = "OneTHUNotifyDelegate"]
    #[ivars = NotifyDelegateIvars]
    struct NotifyDelegate;

    unsafe impl NSObjectProtocol for NotifyDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotifyDelegate {
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            // 用 identifier 反查落点；查不到就是「只把应用带到前台」
            let id = response.notification().request().identifier().to_string();
            let target = TARGETS
                .lock()
                .ok()
                .and_then(|m| m.get(&id).cloned())
                .unwrap_or_default();
            if !target.is_empty() {
                if let Ok(mut slot) = LAUNCH_TARGET.lock() {
                    *slot = target;
                }
            }
            completion_handler.call(());
        }
    }
);

impl NotifyDelegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(NotifyDelegateIvars);
        unsafe { msg_send![super(this), init] }
    }
}

/// 装一次 delegate（通知中心弱引用它，故这里泄漏一个实例常驻）
fn ensure_delegate(center: &UNUserNotificationCenter) {
    if !DELEGATE.load(Ordering::Acquire).is_null() {
        return;
    }
    let leaked = Retained::into_raw(NotifyDelegate::new());
    DELEGATE.store(leaked, Ordering::Release);
    let delegate: &ProtocolObject<dyn UNUserNotificationCenterDelegate> =
        ProtocolObject::from_ref(unsafe { &*leaked });
    center.setDelegate(Some(delegate));
}

/// 取走点击落点（取走即清）
pub fn take_target() -> String {
    LAUNCH_TARGET
        .lock()
        .map(|mut slot| std::mem::take(&mut *slot))
        .unwrap_or_default()
}

/// 授权弹窗等待上限（首次 TCC 框需要用户操作）
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(120);
/// 单次通知中心调用的等待上限
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn center() -> Result<Retained<UNUserNotificationCenter>, String> {
    let main_bundle = unsafe { NSBundle::mainBundle() };
    if unsafe { main_bundle.bundleIdentifier() }.is_none() {
        return Err("not-bundled".into());
    }
    Ok(unsafe { UNUserNotificationCenter::currentNotificationCenter() })
}

/// 查询授权状态；`request = true` 时先发起授权请求（首次会弹系统框）。
pub fn status(request: bool) -> Result<bool, String> {
    let center = center()?;
    ensure_delegate(&center);

    if request {
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        let options = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        center.requestAuthorizationWithOptions_completionHandler(options, &block);
        // 用户没点（或系统未回调）也要能继续：超时后按当前状态判断
        let _ = rx.recv_timeout(PERMISSION_TIMEOUT);
    }

    let (tx, rx) = mpsc::channel::<isize>();
    let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        // SAFETY: 回调期间 settings 由系统保证有效
        let status = unsafe { settings.as_ref().authorizationStatus() };
        let _ = tx.send(status.0);
    });
    center.getNotificationSettingsWithCompletionHandler(&block);
    let code = rx
        .recv_timeout(CALL_TIMEOUT)
        .map_err(|_| "查询通知授权状态超时".to_string())?;
    Ok(code == UNAuthorizationStatus::Authorized.0 || code == UNAuthorizationStatus::Provisional.0)   // NSInteger = isize
}

/// 排一条定时通知；`at_ms` 为绝对时刻（本地时区语义由调用方保证）。
pub fn add(id: &str, at_ms: i64, title: &str, body: &str, target: &str) -> Result<(), String> {
    let center = center()?;
    ensure_delegate(&center);
    let secs = (at_ms - now_ms()) as f64 / 1000.0;
    if secs <= 0.5 {
        return Err("in-past".into());
    }

    let content = unsafe { UNMutableNotificationContent::new() };
    unsafe {
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
    }
    // 记下落点（identifier 随通知往返系统，点击回调据此反查）；落盘以覆盖冷启动点击
    if !target.is_empty() {
        if let Ok(mut m) = TARGETS.lock() {
            m.insert(id.to_string(), target.to_string());
            save_targets(&m);
        }
    }
    // 相对触发：本应用在任何数据变化与启动时都会重排（见 state/notifyScheduler.ts），
    // 故「相对当前时刻的秒数」等价于按绝对时刻投递，且不必构造 NSDateComponents。
    let trigger = unsafe { UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(secs, false) };
    let request = unsafe {
        UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(id),
            &content,
            Some(&trigger),
        )
    };

    let (tx, rx) = mpsc::channel::<Option<String>>();
    let block = RcBlock::new(move |err: *mut NSError| {
        let msg = if err.is_null() {
            None
        } else {
            // SAFETY: 回调期间 error 由系统保证有效
            Some(unsafe { (*err).localizedDescription() }.to_string())
        };
        let _ = tx.send(msg);
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&block));
    match rx.recv_timeout(CALL_TIMEOUT) {
        Ok(None) => Ok(()),
        Ok(Some(msg)) => Err(msg),
        Err(_) => Err("投递请求超时".into()),
    }
}

/// 立即投递一条通知（事件驱动，如校园卡余额预警）。
///
/// 通知中心只有「定时触发」一条路，故按 1.5 秒后的相对时刻投递：用户感知即立刻，
/// 且不必为此引入第二套投递机制（与 `test()` 同一做法）。
pub fn post(id: &str, title: &str, body: &str, target: &str) -> Result<(), String> {
    add(id, now_ms() + 1500, title, body, target)
}

/// 撤回**已展示**的通知。
///
/// `cancel` 撤的是待投递（removePending…），用户已经看到的那条属于「已投递」，
/// 两条通道在系统侧就是不同的 API，撤回余额预警要用这一个。
pub fn remove_delivered(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let center = center()?;
    if let Ok(mut m) = TARGETS.lock() {
        for id in ids {
            m.remove(id);
        }
        save_targets(&m);
    }
    let arr: Vec<Retained<NSString>> = ids.iter().map(|s| NSString::from_str(s)).collect();
    let ns = NSArray::from_retained_slice(&arr);
    unsafe { center.removeDeliveredNotificationsWithIdentifiers(&ns) };
    Ok(())
}

/// 撤销待投递通知（按 id 覆盖/撤销是系统通知层唯一的去重手段）
pub fn cancel(ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    if let Ok(mut m) = TARGETS.lock() {
        for id in ids {
            m.remove(id);
        }
        save_targets(&m);
    }
    let Ok(center) = center() else { return };
    let arr: Vec<Retained<NSString>> = ids.iter().map(|s| NSString::from_str(s)).collect();
    let ns = NSArray::from_retained_slice(&arr);
    unsafe { center.removePendingNotificationRequestsWithIdentifiers(&ns) };
}

/// 系统侧当前待投递的 id 列表（与 JS 侧指纹表对账用）
pub fn pending_ids() -> Result<Vec<String>, String> {
    let center = center()?;
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    let block = RcBlock::new(move |arr: NonNull<NSArray<UNNotificationRequest>>| {
        let list = unsafe { arr.as_ref() };
        let mut out = Vec::new();
        for i in 0..list.len() {
            let req = unsafe { list.objectAtIndex(i) };
            out.push(req.identifier().to_string());
        }
        let _ = tx.send(out);
    });
    center.getPendingNotificationRequestsWithCompletionHandler(&block);
    rx.recv_timeout(CALL_TIMEOUT)
        .map_err(|_| "查询待投递通知超时".to_string())
}

/// 立即投递一条测试通知（设置页「试一下」）
pub fn test() -> Result<(), String> {
    let id = format!("onethu-test-{}", now_ms());
    post(&id, "OneTHU 提醒测试", "看到这条说明 macOS 通知渠道已就绪。", "settings")
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_targets_tolerates_bad_content() {
        assert!(parse_targets("").is_empty());
        assert!(parse_targets("{ 不是 JSON").is_empty());
        assert!(parse_targets("[1,2,3]").is_empty());   // 类型不对同样是空表
    }

    #[test]
    fn parse_targets_reads_mapping() {
        let m = parse_targets(r#"{"ddl:h1:120":"learn","class:x:15":"schedule"}"#);
        assert_eq!(m.get("ddl:h1:120").map(String::as_str), Some("learn"));
        assert_eq!(m.get("class:x:15").map(String::as_str), Some("schedule"));
        assert_eq!(m.len(), 2);
    }

    #[test]
    fn take_target_is_empty_before_any_click() {
        // 没点过任何通知时不该凭空给出落点（否则应用会莫名跳页）
        assert_eq!(take_target(), "");
    }
}
