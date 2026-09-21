// 机型（ROM）判定：只做一件事——认出 ColorOS 系（OPPO / OnePlus / realme）。
//
// 为什么需要它（2026-09-21 用户定案）：ColorOS 上「往桌面放 OneTHU 小组件」这条路径
// 与别家不同——配置活动（android:configure）立刻跳回应用时，放置会被判失败、桌面留不下
// 卡片。实测有效的做法是**先落一块空白小组件、不跳应用**，用户点它再进应用选内容。
// 所以这里只判品牌，行为差异交给调用方（配置活动 / 引导文案）。
package app.onethu.mobile

import android.os.Build

object RomInfo {
    private fun prop(key: String): String = try {
        val cls = Class.forName("android.os.SystemProperties")
        val get = cls.getMethod("get", String::class.java)
        (get.invoke(null, key) as? String).orEmpty()
    } catch (_: Throwable) {
        ""
    }

    /** 是否 ColorOS 系（含 OnePlus 的 ColorOS / realme UI）：品牌名或 ROM 属性任一命中 */
    val isColorOs: Boolean by lazy {
        val brand = (Build.BRAND + " " + Build.MANUFACTURER).lowercase()
        if (brand.contains("oppo") || brand.contains("oneplus") || brand.contains("realme")) return@lazy true
        listOf("ro.build.version.opporom", "ro.build.oppo.rom", "ro.vendor.build.oppo.rom", "ro.build.oplus.rom")
            .any { prop(it).isNotEmpty() }
    }

    /** 回给 JS 的机型标记（引导文案/按钮提示按它分流） */
    fun describeForJs(): String = if (isColorOs) "coloros" else "other"
}
