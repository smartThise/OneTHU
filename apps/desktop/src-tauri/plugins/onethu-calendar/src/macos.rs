//! macOS 系统日历：EventKit（EKEventStore）。
//!
//! - 权限：优先 requestFullAccessToEventsWithCompletion:（macOS 14+），
//!   老系统回退 requestAccessToEntityType:completion:（废弃但可用）。
//! - 专属日历：EKSourceType::Local 下找/建 `OneTHU 日程`（不写入 iCloud/CalDAV，
//!   避免与用户已添加的清华 CalDAV 账户重复同步）。
//! - 幂等：fetch 窗口内该日历全部事件 → removeEvent(commit=false) → 逐条
//!   saveEvent(commit=false) → 一次 commit()（大批量只落一次盘）。

use std::sync::mpsc;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::AnyThread;
use objc2_foundation::{NSDate, NSString};
use objc2_event_kit::{
    EKAlarm, EKCalendar, EKEntityType, EKEvent, EKEventStore, EKSpan, EKSourceType,
};

use crate::{SyncPayload, SyncResult, CALENDAR_TITLE};

/// 等待权限回调的时长（首次弹 TCC 框，给足时间）
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(180);

fn nsdate(ms: i64) -> Retained<NSDate> {
    NSDate::initWithTimeIntervalSince1970(NSDate::alloc(), (ms as f64) / 1000.0)
}

fn nsstr(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

/// 请求系统日历权限；首次弹 TCC 授权框
pub fn request_permission() -> Result<bool, String> {
    let store = unsafe { EKEventStore::new() };

    let (tx, rx) = mpsc::channel::<bool>();
    let block = block2::RcBlock::new(
        move |granted: Bool, _err: *mut objc2_foundation::NSError| {
            let _ = tx.send(granted.as_bool());
        },
    );
    // 完成块可能在任意队列被调；等待结果（命令跑在线程池，阻塞无碍）
    unsafe {
        let ptr = &*block as *const _ as *mut _;
        // macOS 14+ 走新 API，旧系统回退废弃 API（功能等价）
        let has_new: bool = objc2::msg_send![
            &store,
            respondsToSelector: objc2::sel!(requestFullAccessToEventsWithCompletion:)
        ];
        if has_new {
            store.requestFullAccessToEventsWithCompletion(ptr);
        } else {
            #[allow(deprecated)]
            store.requestAccessToEntityType_completion(EKEntityType::Event, ptr);
        }
    }
    rx.recv_timeout(PERMISSION_TIMEOUT)
        .map_err(|_| "等待系统日历授权超时".into())
}

/// 找到（或创建）专属日历。
///
/// 建日历的 source 候选链（learnX 实测结论：macOS 上本地源可能拒绝建日历
/// —— EKError 17 "That account does not allow calendars to be added or removed"，
/// 部分账户（如 Coremail CalDAV）也不允许）：
///   1) iCloud（CalDAV，随用户 Apple 设备同步）；
///   2) 本地 On My Mac；
///   3) 默认日历的源。
/// 逐个尝试，谁接受用谁；全部失败才报错。
fn find_or_create_calendar(store: &EKEventStore, title: &str) -> Result<Retained<EKCalendar>, String> {
    let title_ns = nsstr(title);

    // 已有：按标题找
    let cals = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
    for cal in cals.iter() {
        if unsafe { cal.title() }.to_string() == title {
            return Ok(cal);
        }
    }

    // 候选源排序：iCloud 优先，其次本地，再次默认日历的源
    let mut sources: Vec<Retained<objc2_event_kit::EKSource>> =
        unsafe { store.sources() }.into_iter().collect();
    sources.sort_by_key(|s| match unsafe { s.sourceType() } {
        EKSourceType::CalDAV if unsafe { s.title() }.to_string() == "iCloud" => 0,
        EKSourceType::Local => 1,
        EKSourceType::CalDAV => 3,
        _ => 4,
    });
    if let Some(def) = unsafe { store.defaultCalendarForNewEvents() }.and_then(|c| unsafe { c.source() }) {
        sources.push(def);
    }

    let mut last_err = String::new();
    for source in &sources {
        let cal = unsafe { EKCalendar::calendarForEntityType_eventStore(EKEntityType::Event, store) };
        unsafe {
            cal.setSource(Some(source));
            cal.setTitle(&title_ns);
        }
        match unsafe { store.saveCalendar_commit_error(&cal, true) } {
            Ok(()) => {
                log::info!(
                    "[onethu-calendar] 已在源「{}」创建系统日历「{title}」",
                    unsafe { source.title() }.to_string()
                );
                return Ok(cal);
            }
            Err(e) => {
                last_err = format!("{e:?}");
                log::warn!("[onethu-calendar] 源「{}」拒绝建日历：{e:?}", unsafe { source.title() }.to_string());
            }
        }
    }
    Err(format!(
        "创建日历失败（已尝试 {} 个账户源，均拒绝）：{last_err}。可在系统日历 App 里手动新建名为「{title}」的日历后重试。",
        sources.len()
    ))
}

/// 幂等同步：窗口清旧 + 全量重写 + 单次 commit
pub fn sync(payload: SyncPayload) -> Result<SyncResult, String> {
    let store = unsafe { EKEventStore::new() };

    if !request_permission()? {
        return Err("没有系统日历权限（请在 系统设置→隐私与安全性→日历 里允许 OneTHU）".into());
    }

    let cal = find_or_create_calendar(&store, &payload.calendar_title)?;

    // 清窗口旧事件（fetch 限四年窗口，同步窗口远小于此）
    let start = nsdate(payload.window_start_ms);
    let end = nsdate(payload.window_end_ms);
    let predicate =
        unsafe { store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None) };
    let existing = unsafe { store.eventsMatchingPredicate(&predicate) };
    let mut removed: u32 = 0;
    for ev in existing.iter() {
        let ours = unsafe { ev.calendar() }
            .map(|c| Retained::as_ptr(&c) == Retained::as_ptr(&cal))
            .unwrap_or(false);
        if ours {
            unsafe {
                store
                    .removeEvent_span_commit_error(&ev, EKSpan::ThisEvent, false)
                    .map_err(|e| format!("清理旧事件失败：{e:?}"))?;
            }
            removed += 1;
        }
    }

    // 全量写入（不逐条 commit，最后一次落盘）
    let mut added: u32 = 0;
    for ev in &payload.events {
        let event = unsafe { EKEvent::eventWithEventStore(&store) };
        unsafe {
            event.setTitle(Some(&nsstr(&ev.title)));
            event.setStartDate(Some(&nsdate(ev.start_ms)));
            event.setEndDate(Some(&nsdate(ev.end_ms)));
            event.setAllDay(ev.all_day);
            event.setCalendar(Some(&cal));
            if let Some(loc) = &ev.location {
                event.setLocation(Some(&nsstr(loc)));
            }
            if let Some(note) = &ev.notes {
                event.setNotes(Some(&nsstr(note)));
            }
            if let Some(min) = ev.alarm_minutes {
                let alarm = EKAlarm::alarmWithRelativeOffset(-(min as f64) * 60.0);
                event.addAlarm(&alarm);
            }
            store
                .saveEvent_span_commit_error(&event, EKSpan::ThisEvent, false)
                .map_err(|e| format!("写入事件失败：{e:?}"))?;
        }
        added += 1;
    }

    unsafe { store.commit() }.map_err(|e| format!("提交系统日历变更失败：{e:?}"))?;

    Ok(SyncResult { added, removed })
}

/// 移除专属日历（连同事件）
pub fn remove_calendar() -> Result<(), String> {
    let store = unsafe { EKEventStore::new() };
    if !request_permission()? {
        return Err("没有系统日历权限".into());
    }
    let cals = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
    let mut removed = 0;
    for cal in cals.iter() {
        if unsafe { cal.title() }.to_string() == CALENDAR_TITLE {
            unsafe {
                store
                    .removeCalendar_commit_error(&cal, true)
                    .map_err(|e| format!("移除日历失败：{e:?}"))?;
            }
            removed += 1;
        }
    }
    log::info!("[onethu-calendar] 已移除 {removed} 个系统日历");
    Ok(())
}
