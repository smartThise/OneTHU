// Android 系统通知（渠道 + 定时投递）。
//
// 分工与小组件一致：**规则在 JS 算、原生只负责到点弹**。JS 侧 notifyPlan.ts 产出
// 「什么时候、发什么、点开去哪」，这里把它排进 AlarmManager；即使 App 进程被杀，
// 系统到点仍会发（force-stop 除外），重启后由 BOOT_COMPLETED 重排。
//
// 三个渠道分档（Android 8+ 用户可单独关某一档，这是「渠道管理」的落地形式）：
//   onethu_course   课程与日程（含自定义日程）
//   onethu_ddl      作业截止
//   onethu_briefing 每日早报
//
// 精确闹钟：API 31+ 需 SCHEDULE_EXACT_ALARM（用户可关）。不可用时降级 setAndAllowWhileIdle
// ——不精确但一定送得到，宁晚不丢。

package app.onethu.mobile

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/** 启动落点：小组件点击与通知点击共用一份（取走即清）。 */
object LaunchTarget {
    private const val PREFS = "onethu_widget"
    private const val KEY_TARGET = "target"

    fun put(ctx: Context, target: String) {
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_TARGET, target).apply()
    }

    fun take(ctx: Context): String {
        val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val v = prefs.getString(KEY_TARGET, null) ?: return ""
        prefs.edit().remove(KEY_TARGET).apply()
        return v
    }
}

/** 已排定通知的持久化：重启后据此重排（AlarmManager 的闹钟不跨重启存活）。 */
object NotifyStore {
    private const val PREFS = "onethu_notify"
    private val lock = Any()

    fun put(ctx: Context, id: String, item: JSONObject) {
        synchronized(lock) {
            ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(id, item.toString()).apply()
        }
    }

    fun remove(ctx: Context, id: String) {
        synchronized(lock) {
            ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove(id).apply()
        }
    }

    fun get(ctx: Context, id: String): JSONObject? {
        val raw = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(id, null) ?: return null
        return try {
            JSONObject(raw)
        } catch (e: Exception) {
            null
        }
    }

    fun all(ctx: Context): List<Pair<String, JSONObject>> {
        val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val out = mutableListOf<Pair<String, JSONObject>>()
        for ((k, v) in prefs.all) {
            if (v !is String) continue
            try {
                out.add(k to JSONObject(v))
            } catch (e: Exception) {
                // 坏条目直接跳过（并清掉），不能让一条脏数据卡住整轮重排
                prefs.edit().remove(k).apply()
            }
        }
        return out
    }

    fun clear(ctx: Context) {
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}

/** 渠道创建 + 弹通知。 */
object NotifyCenter {
    const val CH_COURSE = "onethu_course"
    const val CH_DDL = "onethu_ddl"
    const val CH_BRIEFING = "onethu_briefing"

    private val CHANNELS = listOf(
        Triple(CH_COURSE, "课程与日程", "上课前、开考前与自定义日程提醒"),
        Triple(CH_DDL, "作业截止", "作业 DDL 提醒"),
        Triple(CH_BRIEFING, "每日早报", "当天课程与截止汇总"),
    )

    /** 幂等创建三个渠道（重复调用安全）；App 启动与排程前各调一次。 */
    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java) ?: return
        for ((id, name, desc) in CHANNELS) {
            if (mgr.getNotificationChannel(id) != null) continue
            val ch = NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = desc
                enableVibration(true)
            }
            mgr.createNotificationChannel(ch)
        }
    }

    fun channelOf(raw: String): String = when (raw) {
        "ddl" -> CH_DDL
        "briefing" -> CH_BRIEFING
        else -> CH_COURSE
    }

    private fun notifId(id: String): Int = id.hashCode() and 0x7fffffff

    /** 弹一条通知；点击后落点交给 LaunchTarget（复用启动广播）。 */
    fun post(ctx: Context, id: String, item: JSONObject): Boolean {
        ensureChannels(ctx)
        val title = item.optString("title").ifEmpty { "OneTHU" }
        val body = item.optString("body")
        val target = item.optString("target")
        val channel = channelOf(item.optString("channel"))

        val clickIntent = Intent(ctx, OnethuLaunchReceiver::class.java)
            .putExtra(OnethuLaunchReceiver.EXTRA_TARGET, target)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pending = PendingIntent.getBroadcast(ctx, notifId(id), clickIntent, flags)

        val builder = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.onethu_notify_ic)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)

        return try {
            NotificationManagerCompat.from(ctx).notify(notifId(id), builder.build())
            true
        } catch (e: SecurityException) {
            false   // POST_NOTIFICATIONS 未授予：静默失败（前端据 notifyPermission 状态提示）
        }
    }
}

/** 到点触发：读回条目 → 弹通知 → 清掉（一次性）。 */
class OnethuNotifyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val item = NotifyStore.get(context, id) ?: return
        NotifyCenter.post(context, id, item)
        NotifyStore.remove(context, id)
    }

    companion object {
        const val EXTRA_ID = "onethu_notify_id"

        private fun pending(ctx: Context, id: String): PendingIntent {
            val intent = Intent(ctx, OnethuNotifyReceiver::class.java).putExtra(EXTRA_ID, id)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getBroadcast(ctx, id.hashCode() and 0x7fffffff, intent, flags)
        }

        /** 排一条：写库 + 设闹钟。已过时刻直接拒绝（前端已过滤，这里兜底）。 */
        fun schedule(ctx: Context, item: JSONObject): Boolean {
            val id = item.optString("id")
            val at = item.optLong("at", 0L)
            if (id.isEmpty() || at <= 0L) return false
            if (at <= System.currentTimeMillis()) return false
            NotifyCenter.ensureChannels(ctx)
            NotifyStore.put(ctx, id, item)
            return setAlarm(ctx, id, at)
        }

        fun cancel(ctx: Context, id: String) {
            val mgr = ctx.getSystemService(AlarmManager::class.java)
            mgr?.cancel(pending(ctx, id))
            NotifyStore.remove(ctx, id)
        }

        /** 重排全部（开机后调用）：闹钟不跨重启存活，凭持久化的条目重建。 */
        fun rescheduleAll(ctx: Context) {
            NotifyCenter.ensureChannels(ctx)
            val now = System.currentTimeMillis()
            for ((id, item) in NotifyStore.all(ctx)) {
                val at = item.optLong("at", 0L)
                if (at <= now) {
                    NotifyStore.remove(ctx, id)   // 睡过了就丢掉，不补发历史提醒
                    continue
                }
                setAlarm(ctx, id, at)
            }
        }

        private fun setAlarm(ctx: Context, id: String, at: Long): Boolean {
            val mgr = ctx.getSystemService(AlarmManager::class.java) ?: return false
            val pi = pending(ctx, id)
            return try {
                if (canExact(ctx)) {
                    mgr.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                } else {
                    // 精确闹钟不可用（API 31+ 未授权）→ 降级不精确：宁晚不丢
                    mgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                }
                true
            } catch (e: SecurityException) {
                try {
                    mgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                    true
                } catch (e2: Exception) {
                    false
                }
            }
        }

        /** 精确闹钟权限：API 31+ 需用户在系统设置里允许（应用无法自行授予）。 */
        fun canExact(ctx: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
            val mgr = ctx.getSystemService(AlarmManager::class.java) ?: return false
            return mgr.canScheduleExactAlarms()
        }
    }
}

/** 开机重排：设备重启后 AlarmManager 全部失效，凭持久化条目重建。 */
class OnethuBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val a = intent.action ?: return
        if (a == Intent.ACTION_BOOT_COMPLETED || a == Intent.ACTION_MY_PACKAGE_REPLACED) {
            OnethuNotifyReceiver.rescheduleAll(context)
            OnethuBaseWidget.refreshAll(context)
        }
    }
}
