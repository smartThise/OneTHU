// OneTHU 系统日历插件（Android）
//
// 模型（学习 learnX，src/helpers/calendar.ts / expo-calendar 补丁）：
// - 专属本地账户日历「OneTHU 日程」（ACCOUNT_TYPE_LOCAL），不碰用户已有日历；
// - 幂等同步：清窗口旧事件 → 全量重写（applyBatch 分批）；
// - 课程/考试可带提前提醒（Reminders 表）；
// - 华为/鸿蒙兼容：日历投影不含 IS_PRIMARY（会 IllegalArgumentException），
//   cursor 读取一律用 getColumnIndex 容错（不用 getColumnIndexOrThrow）。

package app.onethu.calendar

import android.Manifest
import android.content.ContentProviderOperation
import android.content.ContentValues
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import androidx.core.content.ContextCompat
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private const val TAG = "OnethuCalendar"

/** 本地账户名（日历挂靠，不与任何系统账号关联、不参与云同步） */
private const val ACCOUNT_NAME = "OneTHU"

private val TZ = java.util.TimeZone.getTimeZone("Asia/Shanghai").id

/** 事件参数（与 TS 层 camelCase 对齐） */
@InvokeArg
class EventArg {
  lateinit var title: String
  var startMs: Long = 0
  var endMs: Long = 0
  var allDay: Boolean = false
  var location: String? = null
  var notes: String? = null
  var alarmMinutes: Int? = null
}

@InvokeArg
class SyncArgs {
  lateinit var calendarTitle: String
  var windowStartMs: Long = 0
  var windowEndMs: Long = 0
  lateinit var events: Array<EventArg>
}

@InvokeArg
class CalendarTitleArgs {
  lateinit var calendarTitle: String
}

@TauriPlugin(
  permissions = [
    Permission(
      strings = [Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR],
      alias = "calendar"
    )
  ]
)
class OnethuCalendarPlugin(private val activity: android.app.Activity) : Plugin(activity) {

  // ---------- 工具 ----------

  private val resolver get() = activity.contentResolver

  private fun hasCalendarPermission(): Boolean =
    ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
      ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED

  /**
   * 本地账户的 sync-adapter URI（创建/删除日历必须走这里；learnX 同款）
   */
  private fun localAccountUri(base: Uri): Uri =
    base.buildUpon()
      .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
      .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT_NAME)
      .appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
      .build()

  /**
   * 日历表投影：**不含 IS_PRIMARY**（华为/鸿蒙 ROM 上该合成列会抛
   * IllegalArgumentException —— learnX 打过同款补丁）；列读取用 getColumnIndex 容错。
   */
  private val calendarProjection = arrayOf(
    Calendars._ID,
    Calendars.CALENDAR_DISPLAY_NAME,
    Calendars.CALENDAR_COLOR,
    Calendars.CALENDAR_TIME_ZONE,
    Calendars.NAME,
    Calendars.OWNER_ACCOUNT,
    Calendars.VISIBLE,
    Calendars.SYNC_EVENTS
  )

  /** 找到（或创建）OneTHU 专属日历，返回其 _id */
  private fun findOrCreateCalendar(title: String): Long {
    // 先找：本账户 + 日历名
    resolver.query(
      localAccountUri(Calendars.CONTENT_URI),
      calendarProjection,
      "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=? AND (${Calendars.NAME}=? OR ${Calendars.CALENDAR_DISPLAY_NAME}=?)",
      arrayOf(ACCOUNT_NAME, CalendarContract.ACCOUNT_TYPE_LOCAL, title, title),
      null
    )?.use { cursor ->
      val idIdx = cursor.getColumnIndex(Calendars._ID)
      if (idIdx >= 0 && cursor.moveToFirst()) return cursor.getLong(idIdx)
    }

    // 再建
    val values = ContentValues().apply {
      put(Calendars.ACCOUNT_NAME, ACCOUNT_NAME)
      put(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
      put(Calendars.NAME, title)
      put(Calendars.CALENDAR_DISPLAY_NAME, title)
      put(Calendars.CALENDAR_COLOR, 0xFF1FA487.toInt())
      put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER)
      put(Calendars.OWNER_ACCOUNT, ACCOUNT_NAME)
      put(Calendars.VISIBLE, 1)
      put(Calendars.SYNC_EVENTS, 1)
      put(Calendars.CALENDAR_TIME_ZONE, TZ)
    }
    val uri = resolver.insert(localAccountUri(Calendars.CONTENT_URI), values)
      ?: throw IllegalStateException("创建系统日历失败")
    val id = android.content.ContentUris.parseId(uri)
    Logger.info(TAG, "已创建系统日历「$title」#$id")
    return id
  }

  // ---------- 命令 ----------

  /** 运行时权限：已授权直接回 true，否则弹系统授权框，结果回调后回查 */
  @Command
  fun requestPermission(invoke: Invoke) {
    if (hasCalendarPermission()) {
      invoke.resolve(grantedJson(true))
      return
    }
    requestPermissionForAliases(arrayOf("calendar"), invoke, "calendarPermissionCallback")
  }

  @PermissionCallback
  fun calendarPermissionCallback(invoke: Invoke) {
    invoke.resolve(grantedJson(hasCalendarPermission()))
  }

  /** 幂等同步：清窗口旧事件 → 全量重写 */
  @Command
  fun sync(invoke: Invoke) {
    try {
      if (!hasCalendarPermission()) {
        invoke.reject("没有系统日历权限（请在系统设置里允许 OneTHU 读写日历）")
        return
      }
      val args = invoke.parseArgs(SyncArgs::class.java)
      val calId = findOrCreateCalendar(args.calendarTitle)

      // 1) 清窗口旧事件（按 dtstart 过滤；本次要写的范围与上次完全一致，覆盖式清理）
      val removed = resolver.delete(
        Events.CONTENT_URI,
        "${Events.CALENDAR_ID}=? AND ${Events.DTSTART}>=? AND ${Events.DTSTART}<=?",
        arrayOf(calId.toString(), args.windowStartMs.toString(), args.windowEndMs.toString())
      )

      // 2) 分批写入（含提醒 back-reference；华为机器上大批量 applyBatch 分段更稳）
      val ops = ArrayList<ContentProviderOperation>()
      var added = 0
      for (ev in args.events) {
        val eventValues = ContentValues().apply {
          put(Events.CALENDAR_ID, calId)
          put(Events.TITLE, ev.title)
          put(Events.DTSTART, ev.startMs)
          put(Events.DTEND, ev.endMs)
          put(Events.EVENT_TIMEZONE, TZ)
          put(Events.EVENT_END_TIMEZONE, TZ)
          put(Events.AVAILABILITY, Events.AVAILABILITY_BUSY)
          put(Events.STATUS, Events.STATUS_CONFIRMED)
          if (ev.allDay) put(Events.ALL_DAY, 1)
          if (!ev.location.isNullOrBlank()) put(Events.EVENT_LOCATION, ev.location)
          if (!ev.notes.isNullOrBlank()) put(Events.DESCRIPTION, ev.notes)
          val alarm = ev.alarmMinutes
          if (alarm != null && alarm > 0) put(Events.HAS_ALARM, 1)
        }
        ops.add(ContentProviderOperation.newInsert(Events.CONTENT_URI).withValues(eventValues).build())
        val eventOpIndex = ops.size - 1
        val alarm = ev.alarmMinutes
        if (alarm != null && alarm > 0) {
          val reminderValues = ContentValues().apply {
            put(Reminders.MINUTES, alarm)
            put(Reminders.METHOD, Reminders.METHOD_DEFAULT)
          }
          ops.add(
            ContentProviderOperation.newInsert(Reminders.CONTENT_URI)
              .withValues(reminderValues)
              .withValueBackReference(Reminders.EVENT_ID, eventOpIndex)
              .build()
          )
        }
        added += 1
        if (ops.size >= 300) {
          resolver.applyBatch(CalendarContract.AUTHORITY, ArrayList(ops))
          ops.clear()
        }
      }
      if (ops.isNotEmpty()) {
        resolver.applyBatch(CalendarContract.AUTHORITY, ArrayList(ops))
      }

      Logger.info(TAG, "系统日历同步完成：+$added / -$removed")
      val result = JSObject()
      result.put("added", added)
      result.put("removed", removed)
      invoke.resolve(result)
    } catch (ex: Exception) {
      val message = ex.message ?: "系统日历同步失败"
      Logger.error(TAG, message, null)
      invoke.reject(message)
    }
  }

  /** 移除 OneTHU 专属日历（连同事件） */
  @Command
  fun removeCalendar(invoke: Invoke) {
    try {
      if (!hasCalendarPermission()) {
        invoke.reject("没有系统日历权限")
        return
      }
      val args = invoke.parseArgs(CalendarTitleArgs::class.java)
      val deleted = resolver.delete(
        localAccountUri(Calendars.CONTENT_URI),
        "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=? AND (${Calendars.NAME}=? OR ${Calendars.CALENDAR_DISPLAY_NAME}=?)",
        arrayOf(ACCOUNT_NAME, CalendarContract.ACCOUNT_TYPE_LOCAL, args.calendarTitle, args.calendarTitle)
      )
      Logger.info(TAG, "已移除系统日历 x$deleted")
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      val message = ex.message ?: "移除系统日历失败"
      Logger.error(TAG, message, null)
      invoke.reject(message)
    }
  }

  private fun grantedJson(granted: Boolean): JSObject {
    val obj = JSObject()
    obj.put("granted", granted)
    return obj
  }
}
