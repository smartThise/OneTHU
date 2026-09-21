// Android 桌面小组件（AppWidgetProvider）。
//
// 架构是「JS 算、原生画」：小组件进程里既没有 WebView 也没有会话（凭据是 WebCrypto 加密后
// 存在 localStorage 的，原生拿不到明文），因此任何需要网络或解析的逻辑都不可能在小组件里
// 跑。App 在前台刷新数据后把渲染好的快照推到 SharedPreferences，小组件只负责把快照摆到
// RemoteViews 上；用户点小组件 → 广播记下落点 → 打开 App 重算并回写快照。
//
// **内容绑定在「每一块」小组件上**，不是全局：桌面上可以同时放「日程与 DDL」「某门课的详情」
// 「某个收藏夹的图标组」「某个功能页的 1×1 快捷方式」，各显示各的。原生按 appWidgetId 存快照：
//
//   快照 JSON（JS 侧 state/widgetSnapshot.ts 生成，字段变更需同步两端）：
//     { "kind": "list",     "title": "今日", "rows": [{ "text": "10:00 数据结构", "sub": "六教6A215" }],
//                            "footer": "3 节课 · 2 个截止", "target": "today" }
//     { "kind": "grid",     "title": "常用", "items": [{ "label": "网络学堂",
//                            "icon": "data:image/png;base64,…", "target": "learn" }], "target": "folder?folderId=f1" }
//     { "kind": "shortcut", "label": "校园卡", "icon": "data:image/png;base64,…",
//                            "sub": "余额 ¥23.4", "target": "info?infoTab=card" }
//
// R21（2026-09-21「上课了还显示还有 9 小时」）：快照行带机器时间字段，原生重画时按
// **当前时钟**重算，App 不在前台也能说真话：
//   row.at（epoch，事件开始）/ row.until（epoch，下课时刻）/ row.rel（"class"|"ddl"）
//   / row.loc（上课地点）；快照级 counts{classes,ddls,more,hadClass} 与 titleAt。
//   重画语义唯一参考：JS state/widgetNativeRender.ts（改语义先改那里再两端同步）。
//   重画的触发 = 30 分钟兜底自续 tick + 最近的 at/until 翻转点精准闹钟（WidgetTicker）。
//
// 未绑定的实例显示「点一下选择显示内容」，点击落点 widget-config:<appWidgetId>，
// 由应用打开绑定层（也可以长按小组件 → 编辑，走同样的落点）。

package app.onethu.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.res.Configuration
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/** 快照存储：SharedPreferences。槽位小组件用全局键，宿主家族按 appWidgetId 一实例一键。 */
object WidgetStore {
    private const val PREFS = "onethu_widget"
    /** 插件槽位内容（全局：槽位 → 内容，由插件声明顺序决定） */
    private const val KEY_SLOTS = "snapshot"
    private const val PREFIX_INSTANCE = "instance:"

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 写一份全局槽位快照（键：slots） */
    fun saveSlots(ctx: Context, json: String) {
        prefs(ctx).edit().putString(KEY_SLOTS, json).apply()
    }

    fun loadSlots(ctx: Context): JSONObject? = parse(prefs(ctx).getString(KEY_SLOTS, null))

    /** 写某一块宿主机小组件的内容（按 appWidgetId） */
    fun saveInstance(ctx: Context, widgetId: Int, json: String) {
        prefs(ctx).edit().putString(PREFIX_INSTANCE + widgetId, json).apply()
    }

    fun loadInstance(ctx: Context, widgetId: Int): JSONObject? =
        parse(prefs(ctx).getString(PREFIX_INSTANCE + widgetId, null))

    /** 小组件被移除后清掉它的内容，避免 appWidgetId 复用时串内容 */
    fun clearInstance(ctx: Context, widgetId: Int) {
        prefs(ctx).edit().remove(PREFIX_INSTANCE + widgetId).apply()
    }

    /** 只保留仍存在的实例（App 推送后调用）：防止历史残留越积越多 */
    fun pruneInstances(ctx: Context, liveIds: Set<Int>) {
        val e = prefs(ctx).edit()
        for (k in prefs(ctx).all.keys) {
            if (!k.startsWith(PREFIX_INSTANCE)) continue
            val id = k.removePrefix(PREFIX_INSTANCE).toIntOrNull() ?: continue
            if (id !in liveIds) e.remove(k)
        }
        e.apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    /** 所有快照行里的未来翻转点（at/until），供排下一次重画闹钟（R21） */
    fun transitionTimes(ctx: Context, now: Long): List<Long> {
        val out = mutableListOf<Long>()
        fun scan(obj: JSONObject?) {
            val rows = obj?.optJSONArray("rows") ?: return
            for (i in 0 until rows.length()) {
                val r = rows.optJSONObject(i) ?: continue
                for (k in listOf("at", "until")) {
                    val t = r.optLong(k, 0L)
                    if (t > now) out.add(t)
                }
            }
        }
        scan(loadSlots(ctx))
        for (k in prefs(ctx).all.keys) {
            if (!k.startsWith(PREFIX_INSTANCE)) continue
            val id = k.removePrefix(PREFIX_INSTANCE).toIntOrNull() ?: continue
            scan(loadInstance(ctx, id))
        }
        return out
    }

    private fun parse(raw: String?): JSONObject? {
        if (raw == null) return null
        return try {
            JSONObject(raw)
        } catch (e: Exception) {
            null   // 坏快照当作没有：小组件显示占位文案，不崩
        }
    }
}

/** 点击落点广播（小组件与通知共用）：PendingIntent 里跑不了代码，
 *  故先把落点写进 LaunchTarget 再拉起 App，App 起来后取走并导航。 */
class OnethuLaunchReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val target = intent.getStringExtra(EXTRA_TARGET) ?: ""
        if (target.isNotEmpty()) LaunchTarget.put(context, target)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try {
                context.startActivity(launch)
            } catch (e: Exception) {
                // 拉起失败（ROM 限制）：静默——用户自己点图标也能开，不能因此崩小组件
            }
        }
    }

    companion object {
        const val EXTRA_TARGET = "onethu_widget_target"
    }
}

/**
 * 小组件渲染基类：宿主小组件（按实例绑内容）与插件槽位小组件（按槽位取内容）共用。
 *
 * 宿主家族有四种子形状（1×1 快捷方式 / 2×1 窄条 / 2×2 方块 / 3×2 标准 / 4×1 长条），
 * 区别只在清单里声明的初始占位；内容与渲染完全一致——放什么由用户绑定的内容决定，
 * 拉多大由用户拖动决定，行数/图标数按实际占位自适应。
 */
abstract class OnethuBaseWidget : AppWidgetProvider() {
    /** 槽位键 "1".."3"；null = 宿主小组件（按 appWidgetId 取内容） */
    abstract fun slotKey(): String?

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) render(context, manager, id)
        scheduleNextTick(context)
    }

    /** 用户拖动改尺寸时立刻按新尺寸重排（不重排会留着一屏错位） */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        render(context, manager, appWidgetId)
        scheduleNextTick(context)
    }

    /** 小组件被移除：清掉它的内容 */
    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        for (id in appWidgetIds) WidgetStore.clearInstance(context, id)
    }

    companion object {
        /** 列表布局能放几条（slot1..slot5） */
        private const val SLOT_IDS = 5
        /** 兜底自续 tick：没有任何翻转点时也要隔这么久重画一次（顺带跨午夜换标题） */
        private const val FALLBACK_TICK_MS = 30 * 60_000L
        /** 两次重画的最小间隔：防异常快照把闹钟排成紧密循环 */
        private const val MIN_TICK_GAP_MS = 60_000L
        /** 正文墨色（浅色卡片底上的主文字色） */
        private const val INK = 0xFF0F1115.toInt()
        /** 深色卡片底上的正文墨色（自动跟随系统深色，无需设置项） */
        private const val INK_NIGHT = 0xFFE8EBF2.toInt()
        /** 一条内容占的高度（dp）：一条一行，说明在同一条里 */
        private const val SLOT_H = 22
        /** 说明文字的颜色（灰）与字号 */
        private const val SUB_COLOR = 0xFF81858C.toInt()
        /** 深色卡片上的说明灰 */
        private const val SUB_COLOR_NIGHT = 0xFF9AA1AC.toInt()

        /** 系统深色？（渲染时读当前 uiMode；布局色走 values-night 自动跟随，Span 色在此选盘） */
        private fun isNight(ctx: Context): Boolean =
            (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_YES) != 0

        private fun inkOf(ctx: Context): Int = if (isNight(ctx)) INK_NIGHT else INK
        private fun subOf(ctx: Context): Int = if (isNight(ctx)) SUB_COLOR_NIGHT else SUB_COLOR

        /** 「还有 40 分钟」/「还有 3 小时」/「还有 2 天」（口径同 JS widgetNativeRender.leftText） */
        private fun leftText(ms: Long): String {
            val m = Math.max(1, Math.round(ms / 60000.0))
            return when {
                m < 60 -> "还有 $m 分钟"
                m < 2880 -> "还有 ${Math.round(m / 60.0)} 小时"
                else -> "还有 ${Math.round(m / 1440.0)} 天"
            }
        }

        /** 本地日期键 "YYYY-MM-DD"（隔天残留守卫用） */
        private fun dayKey(ms: Long): String {
            val c = java.util.Calendar.getInstance()
            c.timeInMillis = ms
            return String.format("%04d-%02d-%02d", c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH))
        }

        /** "HH:MM"（DDL 次行用） */
        private fun hmOf(ms: Long): String {
            val c = java.util.Calendar.getInstance()
            c.timeInMillis = ms
            return String.format("%02d:%02d", c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE))
        }
        private const val SUB_SP = 11
        /** 图标组布局的格子数（2 行 × 4 列） */
        private const val CELL_IDS = 8

        /**
         * 全部 provider（宿主五种形态 + 三个插件槽位）；新增形态时只改这一处与清单。
         *
         * 为什么宿主有多形态：`targetCellWidth/Height` 是**每个 provider 一份**的静态元信息，
         * 选择器里能直接选的形态数 = provider 数。只声明一种的话，想要一条 2×1 长条的用户
         * 得先放上再拖动改尺寸——多一步且不直观。五种形态共用同一套渲染与同一份实例内容，
         * 只是初始占位不同（放置后照样能自由拖动）。
         */
        private val PROVIDERS = listOf(
            OnethuWidgetShape1Shortcut::class.java,   // 1×1 快捷方式
            OnethuWidgetShape2Narrow::class.java,     // 2×1 窄条
            OnethuWidgetShape3Square::class.java,     // 2×2 方块
            OnethuWidgetShape4Standard::class.java,   // 3×2 标准
            OnethuWidgetShape5Strip::class.java,      // 4×1 长条
            OnethuWidgetSlot1::class.java,
            OnethuWidgetSlot2::class.java,
            OnethuWidgetSlot3::class.java,
        )

        /** 槽位键 / provider 类 / 诊断名（诊断与刷新共用；槽位键 null = 宿主小组件） */
        fun providerEntries(): List<Triple<String?, Class<*>, String>> = listOf(
            Triple(null, OnethuWidgetShape1Shortcut::class.java, "宿主 1×1"),
            Triple(null, OnethuWidgetShape2Narrow::class.java, "宿主 2×1"),
            Triple(null, OnethuWidgetShape3Square::class.java, "宿主 2×2"),
            Triple(null, OnethuWidgetShape4Standard::class.java, "宿主 3×2 标准"),
            Triple(null, OnethuWidgetShape5Strip::class.java, "宿主 4×1"),
            Triple("1", OnethuWidgetSlot1::class.java, "槽位 1"),
            Triple("2", OnethuWidgetSlot2::class.java, "槽位 2"),
            Triple("3", OnethuWidgetSlot3::class.java, "槽位 3"),
        )

        /** 宿主家族的 provider（不含插件槽位） */
        fun hostProviders(): List<Class<*>> = providerEntries().filter { it.first == null }.map { it.second }

        /** App 前台刷新快照后调用：让所有已放置的小组件立刻重画（不等系统 30 分钟轮询） */
        fun refreshAll(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx) ?: return
            for (cls in PROVIDERS) {
                val ids = manager.getAppWidgetIds(ComponentName(ctx, cls))
                for (widgetId in ids) renderFor(ctx, manager, widgetId, slotKeyOf(cls))
            }
            scheduleNextTick(ctx)
        }

        /**
         * 排下一次重画（R21 新鲜度的关键一环）：取「最近的行翻转点（at/until）」，
         * 一个都没有就 30 分钟兜底自续。到点由 WidgetTicker 唤醒重画——重画本身按
         * 当前时钟重算倒计时/正在上课/过期剔除，再排再下一次，自我延续。
         */
        fun scheduleNextTick(ctx: Context) {
            val now = System.currentTimeMillis()
            var next = now + FALLBACK_TICK_MS
            for (t in WidgetStore.transitionTimes(ctx, now)) {
                if (t >= now + MIN_TICK_GAP_MS && t < next) next = t
            }
            WidgetTicker.schedule(ctx, next)
        }

        private fun slotKeyOf(cls: Class<*>): String? = when (cls) {
            OnethuWidgetSlot1::class.java -> "1"
            OnethuWidgetSlot2::class.java -> "2"
            OnethuWidgetSlot3::class.java -> "3"
            else -> null
        }

        /** 某块小组件当前的占位（宽高 dp）：内容行数/图标格子数都按它算 */
        fun sizeOf(manager: AppWidgetManager, widgetId: Int): Pair<Int, Int> {
            val opts = try {
                manager.getAppWidgetOptions(widgetId)
            } catch (e: Exception) {
                null
            }
            val w = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
            val h = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
            return w to h
        }

        /**
         * 列表形态能放几条、要不要带说明——**同一套布局靠可见性自适应**。
         *
         * 一条一行（说明用 Span 跟在主文后面，不另占一行），故每条约 22dp；标题 20dp、
         * 脚注 16dp、内边距 24dp（矮条隐藏标题，只留 12dp）。上限按高度分档，避免出现
         * 「一屏挤五条」那种密到看不清的排版。
         */
        private fun listFit(h: Int): Pair<Int, Boolean> {
            if (h <= 0) return 3 to true           // 拿不到尺寸（老系统/首次）→ 按默认 3 条渲染
            val padding = if (h < 90) 12 else 24
            val title = if (h < 90) 0 else 20      // 矮条隐藏标题，把这一行让给内容
            val footer = if (h < 90) 0 else 16
            val usable = h - padding - title - footer
            val cap = when {
                h < 200 -> 3
                h < 260 -> 4
                else -> 5
            }
            return minOf(cap, maxOf(1, usable / SLOT_H)) to (h >= 100)
        }

        /** 图标组能放几个：列数按宽度、行数按高度（每格约 56dp），最多 2 行 × 4 列 */
        private fun gridCapacity(w: Int, h: Int): Int {
            if (w <= 0 && h <= 0) return 4
            val cols = if (w <= 0) 3 else ((w + 28) / 56).coerceIn(2, 4)
            val rows = if (h <= 0) 1 else ((h + 20) / 56).coerceIn(1, 2)
            return cols * rows
        }

        private fun renderFor(ctx: Context, manager: AppWidgetManager, widgetId: Int, slot: String?) {
            val (w, h) = sizeOf(manager, widgetId)
            val snap = WidgetStore.loadSlots(ctx)
            val content = if (slot == null) WidgetStore.loadInstance(ctx, widgetId) else snap?.optJSONObject("slots")?.optJSONObject(slot)
            if (content == null) {
                renderPlaceholder(ctx, manager, widgetId, slot)
                return
            }
            when (content.optString("kind", "list")) {
                "grid" -> renderGrid(ctx, manager, widgetId, content, w, h)
                "shortcut" -> renderShortcut(ctx, manager, widgetId, content)
                else -> renderList(ctx, manager, widgetId, content, h)
            }
        }

        /** 未绑定 / 尚无快照：给一条可读的引导，不留空白 */
        private fun renderPlaceholder(ctx: Context, manager: AppWidgetManager, widgetId: Int, slot: String?) {
            if (slot == null && isShortcutProvider(manager, widgetId)) {
                val views = RemoteViews(ctx.packageName, R.layout.onethu_widget_shortcut)
                // 空框看着像坏了：先用应用图标占位，用户一看就知道「还没选东西」
                views.setImageViewResource(R.id.onethu_widget_icon, ctx.applicationInfo.icon)
                views.setTextViewText(R.id.onethu_widget_label, "点一下选择")
                views.setOnClickPendingIntent(R.id.onethu_widget_root, clickPending(ctx, "widget-config:$widgetId", 0))
                manager.updateAppWidget(widgetId, views)
                return
            }
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget)
            val title = if (slot == null) "OneTHU" else "OneTHU 插件小组件 $slot"
            val line = if (slot == null) "点一下选择显示内容" else "尚无插件占用此槽位"
            views.setTextViewText(R.id.onethu_widget_title, title)
            views.setViewVisibility(R.id.onethu_widget_title, View.VISIBLE)
            views.setTextViewText(R.id.onethu_widget_row1, line)
            views.setViewVisibility(R.id.onethu_widget_row1, View.VISIBLE)
            views.setViewVisibility(R.id.onethu_widget_bar1, View.INVISIBLE)
            for (i in 2..SLOT_IDS) views.setViewVisibility(slotId(i), View.GONE)
            views.setViewVisibility(R.id.onethu_widget_footer, View.GONE)
            views.setOnClickPendingIntent(
                R.id.onethu_widget_root,
                clickPending(ctx, if (slot == null) "widget-config:$widgetId" else "plugins", 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** 这块小组件是不是 1×1 快捷方式 provider（占位态要按它的布局画） */
        private fun isShortcutProvider(manager: AppWidgetManager, widgetId: Int): Boolean {
            val provider = try {
                manager.getAppWidgetInfo(widgetId)?.provider
            } catch (e: Exception) {
                null
            } ?: return false
            return provider.className == OnethuWidgetShape1Shortcut::class.java.name
        }

        /** 列表形态：标题 + 若干条（每条「色条 + 主文 + 小字说明」，一条一行）+ 脚注。
         *  用于日程与 DDL、单原子详情、以及教室/洗衣机这类实时状态。
         *  R21：带 at/until/rel 的行先经 nativeRow 重算（可见性/次行/加粗随当前时钟），
         *  过期行剔除后从顶上重新装填；脚注与标题同步重算。语义锚 = widgetNativeRender.ts。 */
        private fun renderList(ctx: Context, manager: AppWidgetManager, widgetId: Int, content: JSONObject, h: Int) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget)
            val rows = content.optJSONArray("rows")
            val now = System.currentTimeMillis()
            val (maxSlots, withSub) = listFit(h)
            // 矮条（2×1）里标题是冗余的（用户自己知道放的是什么），把这一行让给内容：
            // 隐藏标题、收紧内边距，于是「一条内容 + 脚注」都放得下，而不是被裁掉半行。
            val compact = h < 90
            applyCompactPadding(ctx, views, compact)
            views.setViewVisibility(R.id.onethu_widget_title, if (compact) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.onethu_widget_title, titleOf(content, now))

            val ink = inkOf(ctx)
            val subC = subOf(ctx)
            var packed = 0
            var visClasses = 0
            var visDdls = 0
            if (rows != null) {
                for (i in 0 until rows.length()) {
                    if (packed >= maxSlots) break
                    val row = rows.optJSONObject(i) ?: continue
                    val (visible, text, rowSub) = nativeRow(row, now)
                    if (!visible) continue
                    val sub = if (withSub) rowSub else ""
                    if (text.isEmpty() && sub.isEmpty()) continue

                    val slot = slotId(packed + 1)
                    views.setViewVisibility(slot, View.VISIBLE)

                    // 色条：课程色 / 紧迫度色 / 状态色；无色时保留占位但不可见（各行文字对齐）
                    val bar = barId(packed + 1)
                    val color = parseColor(row.optString("color").orEmpty())
                    if (color != null) {
                        views.setViewVisibility(bar, View.VISIBLE)
                        views.setInt(bar, "setBackgroundColor", color)
                    } else {
                        views.setViewVisibility(bar, View.INVISIBLE)
                    }

                    views.setTextViewText(rowId(packed + 1), styledRow(text, sub, row, color, ink, subC))
                    when (row.optString("rel")) {
                        "class" -> visClasses++
                        "ddl" -> visDdls++
                    }
                    packed++
                }
            }
            for (i in packed + 1..SLOT_IDS) views.setViewVisibility(slotId(i), View.GONE)

            // 脚注：按仍可见的行重计（矮条里让位给内容）
            val footer = if (withSub) footerOf(content, now, visClasses, visDdls) else ""
            views.setViewVisibility(R.id.onethu_widget_footer, if (footer.isEmpty()) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.onethu_widget_footer, footer)
            views.setOnClickPendingIntent(
                R.id.onethu_widget_root,
                clickPending(ctx, content.optString("target"), 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** 标题：快照有 titleAt 就按当前日期重写「今天 M月d日」（跨午夜不再挂昨天的日期） */
        private fun titleOf(content: JSONObject, now: Long): String {
            val base = content.optString("title").takeIf { it.isNotEmpty() } ?: "OneTHU"
            if (content.optLong("titleAt", 0L) <= 0L) return base
            val c = java.util.Calendar.getInstance()
            c.timeInMillis = now
            return "今天 ${c.get(java.util.Calendar.MONTH) + 1}月${c.get(java.util.Calendar.DAY_OF_MONTH)}日"
        }

        /**
         * 单行重算 → (可见, 主文, 次行)。与 JS widgetNativeRender.nativeRow 逐条对齐：
         *  - 无 at：非时间性行原样；
         *  - class：下课剔除；正在上课加粗 + 次行「正在上课 · 地点」；
         *    未开始次行「地点 · 还有 X」；隔天残留剔除；无结束时刻过点当结束；
         *  - ddl：过点剔除；未到次行「今天/M/d HH:MM · 还有 X」。
         *  加粗在 styledRow 内按「正在上课 / 6 小时内 DDL」判定，与此处语义互补。
         */
        private fun nativeRow(row: JSONObject, now: Long): Triple<Boolean, String, String> {
            val text = row.optString("text").orEmpty()
            val subSnap = row.optString("sub").orEmpty()
            val at = if (row.has("at")) row.optLong("at", 0L) else 0L
            val until = if (row.has("until")) row.optLong("until", 0L) else 0L
            val rel = row.optString("rel")
            if (at <= 0L) return Triple(true, text, subSnap)

            if (rel == "class") {
                if (at <= now && dayKey(at) != dayKey(now)) return Triple(false, "", "")   // 隔天残留
                if (until > 0L && until <= now) return Triple(false, "", "")               // 已下课
                val loc = row.optString("loc").orEmpty()
                if (until > 0L && at <= now && now < until) {
                    return Triple(true, text, listOf("正在上课", loc).filter { it.isNotEmpty() }.joinToString(" · "))
                }
                if (until == 0L && at <= now) return Triple(false, "", "")                 // 无结束时刻，过点当结束
                return Triple(true, text, listOf(loc, leftText(at - now)).filter { it.isNotEmpty() }.joinToString(" · "))
            }

            // ddl（及其他过点失效型）
            if (at <= now) return Triple(false, "", "")
            val sameDay = dayKey(at) == dayKey(now)
            val dayLabel = if (sameDay) "今天" else {
                val c = java.util.Calendar.getInstance()
                c.timeInMillis = at
                "${c.get(java.util.Calendar.MONTH) + 1}/${c.get(java.util.Calendar.DAY_OF_MONTH)}"
            }
            return Triple(true, text, "$dayLabel ${hmOf(at)} · ${leftText(at - now)}")
        }

        /** 脚注重算：按仍可见的行计数；全空时按「快照当天且有过课」说「今天的课已上完」 */
        private fun footerOf(content: JSONObject, now: Long, visClasses: Int, visDdls: Int): String {
            val counts = content.optJSONObject("counts")
            val parts = mutableListOf<String>()
            if (visClasses > 0) parts.add("$visClasses 节课")
            if (visDdls > 0) parts.add("$visDdls 个截止")
            if (parts.isEmpty()) {
                val hadClass = counts?.optBoolean("hadClass", false) == true
                val titleAt = content.optLong("titleAt", 0L)
                return if (hadClass && (titleAt <= 0L || dayKey(titleAt) == dayKey(now))) "今天的课已上完"
                else "今天没有课与截止"
            }
            val more = counts?.optInt("more", 0) ?: 0
            return parts.joinToString(" · ") + if (more > 0) " · 还有 $more 项" else ""
        }

        /**
         * 一条内容 → 带样式的文字：主文（可加粗、可上色、可按档放大）+ 说明（小字灰）。
         *
         * 用 Spannable 而不是多摆几个 TextView：说明跟在主文后面，既省一行高度又保持主次；
         * 这里用的三种 Span 都是 Parcelable，能跨进程送到启动器（RemoteViews 的限制）。
         */
        private fun styledRow(text: String, sub: String, row: JSONObject?, color: Int?, ink: Int, subColor: Int): CharSequence {
            val full = if (sub.isEmpty()) text else "$text　$sub"
            val sp = android.text.SpannableString(full)
            // 2026-09-20 用户反馈「安卓小组件字体很小」→ 整体 +1sp（主文 13→14、
            // 强调 17→18、小档 11→12），说明小字 SUB_SP 同步 10→11。
            val headSp = when (row?.optString("size").orEmpty()) {
                "lg" -> 18
                "sm" -> 12
                else -> 14
            }
            // R21：加粗判定随当前时钟——正在上课（until>now≥at）或 6 小时内的 DDL，
            // 与快照自带的 strong 取并集（正在上课就算快照写死 false 也要抢眼）。
            val now = System.currentTimeMillis()
            val at = if (row?.has("at") == true) row.optLong("at", 0L) else 0L
            val until = if (row?.has("until") == true) row.optLong("until", 0L) else 0L
            val ongoing = until > 0L && at in 1..now && now < until
            val ddlSoon = row?.optString("rel").orEmpty() == "ddl" && at > now && at - now <= 6 * 3600_000L
            val bold = row?.optBoolean("strong", false) == true || ongoing || ddlSoon
            sp.setSpan(android.text.style.AbsoluteSizeSpan(headSp, true), 0, text.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (bold) {
                sp.setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, text.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            sp.setSpan(
                android.text.style.ForegroundColorSpan(color ?: ink),
                0, text.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
            if (sub.isNotEmpty()) {
                sp.setSpan(
                    android.text.style.AbsoluteSizeSpan(SUB_SP, true),
                    text.length, full.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
                sp.setSpan(
                    android.text.style.ForegroundColorSpan(subColor),
                    text.length, full.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
            }
            return sp
        }

        /** "#RRGGBB" → Color；解析不出返回 null（当无色处理，不猜） */
        private fun parseColor(hex: String): Int? {
            if (hex.length != 7 || !hex.startsWith("#")) return null
            return try {
                android.graphics.Color.parseColor(hex)
            } catch (e: Exception) {
                null
            }
        }

        /** 图标组形态：收藏夹 = 内嵌的文件夹，若干原子图标并列，每个格子各自可点 */
        private fun renderGrid(ctx: Context, manager: AppWidgetManager, widgetId: Int, content: JSONObject, w: Int, h: Int) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget_grid)
            views.setTextViewText(
                R.id.onethu_widget_title,
                content.optString("title").takeIf { it.isNotEmpty() } ?: "收藏",
            )
            val items = content.optJSONArray("items")
            val capacity = gridCapacity(w, h)
            for (i in 0 until CELL_IDS) {
                val cell = cellId(i)
                val item = if (i < capacity) items?.optJSONObject(i) else null
                if (item == null) {
                    views.setViewVisibility(cell, View.GONE)
                    continue
                }
                views.setViewVisibility(cell, View.VISIBLE)
                views.setTextViewText(iconLabelId(i), item.optString("label"))
                val bmp = decodeIcon(item.optString("icon"))
                if (bmp != null) views.setImageViewBitmap(iconViewId(i), bmp)
                else views.setImageViewResource(iconViewId(i), android.R.drawable.ic_menu_compass)
                // 每个格子带自己的落点：这块小组件等于一个迷你收藏夹面板
                views.setOnClickPendingIntent(cell, clickPending(ctx, item.optString("target"), i + 1))
            }
            views.setOnClickPendingIntent(
                R.id.onethu_widget_title,
                clickPending(ctx, content.optString("target"), 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** 快捷方式形态：一个图标 + 一行名称（1×1 用；更大尺寸也能放，图标会居中） */
        private fun renderShortcut(ctx: Context, manager: AppWidgetManager, widgetId: Int, content: JSONObject) {
            val views = RemoteViews(ctx.packageName, R.layout.onethu_widget_shortcut)
            views.setTextViewText(R.id.onethu_widget_label, content.optString("label"))
            val bmp = decodeIcon(content.optString("icon"))
            if (bmp != null) views.setImageViewBitmap(R.id.onethu_widget_icon, bmp)
            else views.setImageViewResource(R.id.onethu_widget_icon, android.R.drawable.ic_menu_compass)
            views.setOnClickPendingIntent(
                R.id.onethu_widget_root,
                clickPending(ctx, content.optString("target"), 0),
            )
            manager.updateAppWidget(widgetId, views)
        }

        /** data URL（base64 PNG）→ Bitmap；坏数据返回 null（渲染处退回系统默认图标） */
        private fun decodeIcon(dataUrl: String): Bitmap? {
            if (dataUrl.isEmpty()) return null
            val comma = dataUrl.indexOf(',')
            if (comma < 0) return null
            return try {
                val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } catch (e: Exception) {
                null
            } catch (e: OutOfMemoryError) {
                null
            }
        }

        private fun slotId(n: Int): Int = when (n) {
            1 -> R.id.onethu_widget_slot1
            2 -> R.id.onethu_widget_slot2
            3 -> R.id.onethu_widget_slot3
            4 -> R.id.onethu_widget_slot4
            else -> R.id.onethu_widget_slot5
        }

        private fun barId(n: Int): Int = when (n) {
            1 -> R.id.onethu_widget_bar1
            2 -> R.id.onethu_widget_bar2
            3 -> R.id.onethu_widget_bar3
            4 -> R.id.onethu_widget_bar4
            else -> R.id.onethu_widget_bar5
        }

        private fun rowId(n: Int): Int = when (n) {
            1 -> R.id.onethu_widget_row1
            2 -> R.id.onethu_widget_row2
            3 -> R.id.onethu_widget_row3
            4 -> R.id.onethu_widget_row4
            else -> R.id.onethu_widget_row5
        }

        private fun cellId(i: Int): Int = when (i) {
            0 -> R.id.onethu_widget_cell0
            1 -> R.id.onethu_widget_cell1
            2 -> R.id.onethu_widget_cell2
            3 -> R.id.onethu_widget_cell3
            4 -> R.id.onethu_widget_cell4
            5 -> R.id.onethu_widget_cell5
            6 -> R.id.onethu_widget_cell6
            else -> R.id.onethu_widget_cell7
        }

        private fun iconViewId(i: Int): Int = when (i) {
            0 -> R.id.onethu_widget_cell0_icon
            1 -> R.id.onethu_widget_cell1_icon
            2 -> R.id.onethu_widget_cell2_icon
            3 -> R.id.onethu_widget_cell3_icon
            4 -> R.id.onethu_widget_cell4_icon
            5 -> R.id.onethu_widget_cell5_icon
            6 -> R.id.onethu_widget_cell6_icon
            else -> R.id.onethu_widget_cell7_icon
        }

        private fun iconLabelId(i: Int): Int = when (i) {
            0 -> R.id.onethu_widget_cell0_label
            1 -> R.id.onethu_widget_cell1_label
            2 -> R.id.onethu_widget_cell2_label
            3 -> R.id.onethu_widget_cell3_label
            4 -> R.id.onethu_widget_cell4_label
            5 -> R.id.onethu_widget_cell5_label
            6 -> R.id.onethu_widget_cell6_label
            else -> R.id.onethu_widget_cell7_label
        }

        /** 矮条的紧凑内边距：12dp 的留白在 2×1（约 40dp 高）里会把内容挤出可视区 */
        private fun applyCompactPadding(ctx: Context, views: RemoteViews, compact: Boolean) {
            val d = ctx.resources.displayMetrics.density
            val px = { v: Int -> (v * d).toInt() }
            if (compact) views.setViewPadding(R.id.onethu_widget_root, px(8), px(6), px(8), px(6))
            else views.setViewPadding(R.id.onethu_widget_root, px(12), px(12), px(12), px(12))
        }

        /** 点击：落点交给广播（存 target 后拉起 App）；seq 用于同一落点的多个格子互不覆盖 */
        private fun clickPending(ctx: Context, target: String, seq: Int): PendingIntent {
            val intent = Intent(ctx, OnethuLaunchReceiver::class.java)
                .putExtra(OnethuLaunchReceiver.EXTRA_TARGET, target)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getBroadcast(ctx, target.hashCode() * 31 + seq, intent, flags)
        }
    }

    private fun render(ctx: Context, manager: AppWidgetManager, widgetId: Int) {
        renderFor(ctx, manager, widgetId, slotKey())
    }
}

/* ══════════ 宿主小组件的五种初始形态 ══════════
   内容与渲染完全一致（内容由用户绑定的东西决定、行数与图标数按占位自适应），
   区别只在清单里声明的初始占位尺寸——让选择器直接给出各种形状。 */

/** 1×1 快捷方式：一个图标 + 名称（功能页 / 原子） */
class OnethuWidgetShape1Shortcut : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 2×1 窄条 */
class OnethuWidgetShape2Narrow : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 2×2 方块 */
class OnethuWidgetShape3Square : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 3×2 标准（日程与 DDL 的常见形态） */
class OnethuWidgetShape4Standard : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 4×1 长条 */
class OnethuWidgetShape5Strip : OnethuBaseWidget() {
    override fun slotKey(): String? = null
}

/** 插件小组件槽位 1..3：内容来自插件声明（JS 侧解析后放进快照的 slots 字段） */
class OnethuWidgetSlot1 : OnethuBaseWidget() {
    override fun slotKey(): String = "1"
}

class OnethuWidgetSlot2 : OnethuBaseWidget() {
    override fun slotKey(): String = "2"
}

class OnethuWidgetSlot3 : OnethuBaseWidget() {
    override fun slotKey(): String = "3"
}

/** 小组件重画闹钟：到点唤醒 → 全部重画（重画按当前时钟重算 + 排下一次，自我延续）。
 *  与通知闹钟同一套权限纪律：API 31+ 优先精确、未授权降级 setAndAllowWhileIdle。 */
object WidgetTicker {
    private const val REQUEST_CODE = 0x0A77

    fun schedule(ctx: Context, at: Long) {
        val app = ctx.applicationContext
        val mgr = app.getSystemService(AlarmManager::class.java) ?: return
        val pi = PendingIntent.getBroadcast(
            app,
            REQUEST_CODE,
            Intent(app, OnethuWidgetTickReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        try {
            if (OnethuNotifyReceiver.canExact(app)) {
                mgr.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } else {
                mgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            }
        } catch (e: SecurityException) {
            try {
                mgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } catch (e2: Exception) {
                // 闹钟彻底不可用：退回系统 30 分钟轮询 + 打开应用必刷新，不崩
            }
        }
    }
}

/** 到点重画广播：refreshAll 内部会重新排下一次 tick。 */
class OnethuWidgetTickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        OnethuBaseWidget.refreshAll(context)
    }
}
