// 机型（ROM）判定与诊断：只做两件事——认出 ColorOS 系（OPPO / OnePlus / realme），
// 以及把判定依据回给 UI 供真机核对。
//
// 为什么需要（2026-09-21 用户定案）：ColorOS 上「放置即跳回应用」会让桌面留不下卡片，
// 实测可行的是**先落一块空白卡片、用户点它再配置**。
//
// 可靠性取舍（重要）：
// - **主通道是公开 API**：`Build.BRAND` / `Build.MANUFACTURER`。OPPO、一加、真我 三家
//   品牌名稳定可读，且不受隐藏 API 限制影响。
// - **属性通道只作补充**：`SystemProperties` 是隐藏 API，targetSdk 高时反射可能被拒
//   （本仓库此前没用过它，没有先例背书）→ 反射拿不到时退回 `getprop` 子进程；
//   两条都拿不到就只信品牌通道，**不把行为正确性押在属性上**。
// - 行为上也不押注：放置路径统一「先落空白卡片」（见 OnethuWidgetConfigActivity），
//   判定只影响文案与诊断，所以漏判/误判都不会造成功能不可用。
package app.onethu.mobile

import android.os.Build

object RomInfo {
    /** 属性读取：先反射（快），失败退回 getprop 子进程（隐藏 API 被拒时仍可读） */
    private fun prop(key: String): String {
        try {
            val cls = Class.forName("android.os.SystemProperties")
            val get = cls.getMethod("get", String::class.java)
            val v = get.invoke(null, key) as? String
            if (!v.isNullOrEmpty()) return v
        } catch (_: Throwable) {
            // 隐藏 API 被拒 / 方法缺失：走下面的 getprop
        }
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("getprop", key))
            val out = p.inputStream.bufferedReader().readText().trim()
            p.waitFor()
            out
        } catch (_: Throwable) {
            ""
        }
    }

    private val BRANDS = listOf("oppo", "oneplus", "realme")

    /** 品牌命中（公开 API，主通道） */
    private val brandHit: String? by lazy {
        val b = Build.BRAND.orEmpty()
        val m = Build.MANUFACTURER.orEmpty()
        val hay = "$b $m".lowercase()
        BRANDS.firstOrNull { hay.contains(it) }
    }

    /** 属性命中（补充通道）：ColorOS 11- 用 opporom，12+ 用 oplusrom（OPPO 与一加合并后） */
    private val PROP_KEYS = listOf(
        "ro.build.version.oplusrom",
        "ro.build.version.opporom",
        "ro.build.oplus.rom",
        "ro.build.oppo.rom",
        "ro.vendor.build.oppo.rom",
        "ro.build.version.ota",
    )

    private val propHit: Pair<String, String>? by lazy {
        for (k in PROP_KEYS) {
            val v = prop(k)
            if (v.isNotEmpty()) return@lazy k to v
        }
        null
    }

    val isColorOs: Boolean by lazy { brandHit != null || propHit != null }

    /** 回给 JS 的机型标记（引导文案/按钮提示按它分流） */
    fun describeForJs(): String = if (isColorOs) "coloros" else "other"

    /** 判定依据（真机核对用：设置页自检里显示，用户截图即可确认检没检到） */
    fun signals(): String {
        val b = "brand=${Build.BRAND}/${Build.MANUFACTURER}" + (brandHit?.let { " hit=$it" } ?: "")
        val p = propHit?.let { "prop=${it.first}=${it.second.take(40)}" } ?: "prop=(none)"
        return "$b $p"
    }
}
