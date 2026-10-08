//! Windows 系统通知：WinRT toast（含 AddToSchedule 定时投递）。
//!
//! 与 macOS 的差别（都写在这里，免得下次重新踩）：
//!   · **未打包应用必须先登记 AUMID**：`HKCU\Software\Classes\AppUserModelId\<AUMID>`
//!     写一个 DisplayName，否则 CreateToastNotifierWithId 拿不到可用通知器。这里在
//!     每次排程前幂等登记（写注册表成本可忽略，换来换机/新用户零配置）。
//!   · 没有「运行时授权」这一步：Windows 通知开关在系统设置里，应用无权请求，
//!     故 `status()` 只回报可用性（能拿到通知器即视为可用）。
//!   · 定时投递走 ScheduledToastNotification + AddToSchedule（系统持久化，
//!     应用未运行也会送达；配额 4096 条，见 MS Learn，远高于我们的计划上限 56 条）。
//!   · **点击深链未接**：WinRT 的点击回调要求注册 COM 激活器
//!     （INotificationActivationCallback + ToastActivatorCLSID），本轮不做；
//!     当前点击只把通知消掉。落点仍写进 toast 的 launch 属性，接上激活器即可用。

use windows::core::{HSTRING, PCWSTR};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::DateTime;
use windows::UI::Notifications::{
    ScheduledToastNotification, ToastNotification, ToastNotificationManager,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
    REG_OPTION_NON_VOLATILE, REG_SZ,
};

/// 应用标识：与 tauri.conf 的 identifier 一致，系统设置里显示的就是它
const AUMID: &str = "app.onethu.desktop";
const AUMID_KEY: &str = r"Software\Classes\AppUserModelId\app.onethu.desktop";
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// WinRT DateTime：自 1601-01-01 UTC 起的 100 纳秒数（换算在 notify.rs，跨平台可测）
fn dt_from_ms(ms: i64) -> DateTime {
    DateTime {
        UniversalTime: crate::notify::dt_from_unix_ms(ms),
    }
}

/// 命令可能跑在 Tauri 的线程池上，每线程都需初始化 COM；
/// 已初始化（含 STA）时 CoInitializeEx 返回 RPC_E_CHANGED_MODE，不影响后续 WinRT 调用。
fn ensure_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

/// 幂等登记 AUMID（DisplayName = 通知上显示的应用名）
fn ensure_aumid() -> Result<(), String> {
    let mut key = HKEY::default();
    let sub = wide(AUMID_KEY);
    let rc = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(sub.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut key,
            None,
        )
    };
    if rc.0 != 0 {
        return Err(format!("登记 AUMID 失败（错误码 {}）", rc.0));
    }
    let name = wide("DisplayName");
    let value = wide("OneTHU");
    // REG_SZ 的字节序列：UTF-16 含结尾 NUL
    let bytes: &[u8] =
        unsafe { std::slice::from_raw_parts(value.as_ptr() as *const u8, value.len() * 2) };
    let rc2 = unsafe { RegSetValueExW(key, PCWSTR(name.as_ptr()), None, REG_SZ, Some(bytes)) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if rc2.0 != 0 {
        return Err(format!("写入 DisplayName 失败（错误码 {}）", rc2.0));
    }
    Ok(())
}

fn err_msg(e: windows::core::Error) -> String {
    let m = e.message().to_string();
    if m.is_empty() { format!("WinRT 错误 {:#x}", e.code().0 as u32) } else { m }
}

fn notifier() -> Result<windows::UI::Notifications::ToastNotifier, String> {
    ensure_com();
    ensure_aumid()?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))
        .map_err(|e| format!("获取通知器失败：{}", err_msg(e)))
}

/// Windows 没有应用侧授权请求：能拿到通知器即视为可用
pub fn status(_request: bool) -> Result<bool, String> {
    notifier().map(|_| true)
}

pub fn add(id: &str, at_ms: i64, title: &str, body: &str, target: &str) -> Result<(), String> {
    if at_ms <= now_ms() {
        return Err("in-past".into());
    }
    let doc = XmlDocument::new().map_err(|e| err_msg(e))?;
    doc.LoadXml(&HSTRING::from(crate::notify::toast_xml(title, body, target)))
        .map_err(|e| format!("toast 载荷非法：{}", err_msg(e)))?;
    let notif = ScheduledToastNotification::CreateScheduledToastNotification(&doc, dt_from_ms(at_ms))
        .map_err(|e| format!("创建定时通知失败：{}", err_msg(e)))?;
    // Id 即稳定 id：撤销与对账都靠它（系统按 Id 去重）
    let _ = notif.SetId(&HSTRING::from(id));
    notifier()?
        .AddToSchedule(&notif)
        .map_err(|e| format!("排入系统调度失败：{}", err_msg(e)))
}

pub fn pending_ids() -> Result<Vec<String>, String> {
    let n = notifier()?;
    let list = n
        .GetScheduledToastNotifications()
        .map_err(|e| format!("读取待投递通知失败：{}", err_msg(e)))?;
    let size = list.Size().map_err(|e| err_msg(e))?;
    let mut out = Vec::with_capacity(size as usize);
    for i in 0..size {
        if let Ok(item) = list.GetAt(i) {
            if let Ok(id) = item.Id() {
                out.push(id.to_string());
            }
        }
    }
    Ok(out)
}

pub fn cancel(ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    let Ok(n) = notifier() else { return };
    let Ok(list) = n.GetScheduledToastNotifications() else {
        return;
    };
    let Ok(size) = list.Size() else { return };
    let want: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    for i in 0..size {
        let Ok(item) = list.GetAt(i) else { continue };
        let Ok(id) = item.Id() else { continue };
        if want.contains(id.to_string().as_str()) {
            let _ = n.RemoveFromSchedule(&item);
        }
    }
}

pub fn test() -> Result<(), String> {
    let n = notifier()?;
    let doc = XmlDocument::new().map_err(|e| err_msg(e))?;
    doc.LoadXml(&HSTRING::from(crate::notify::toast_xml(
        "OneTHU 提醒测试",
        "看到这条说明 Windows 通知渠道已就绪。",
        "settings",
    )))
    .map_err(|e| err_msg(e))?;
    let notif = ToastNotification::CreateToastNotification(&doc).map_err(|e| err_msg(e))?;
    n.Show(&notif).map_err(|e| format!("展示通知失败：{}", err_msg(e)))
}
