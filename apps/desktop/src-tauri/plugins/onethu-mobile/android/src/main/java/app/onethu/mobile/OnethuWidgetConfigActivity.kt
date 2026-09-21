// 小组件「配置」入口（android:configure）。
//
// 用户往桌面放一块 OneTHU 小组件时，系统会先拉起这里。原生不做选择界面：候选项
// （功能页 / 收藏夹 / 收藏原子 / 插件原子）只存在于应用的 JS 注册表里，小组件进程里
// 既没有 WebView 也没有注册表——所以真正的配置由应用完成。
//
// 两条硬约束/定案：
// 1. **必须回 RESULT_OK 并把 appWidgetId 塞回 intent**：否则启动器认为用户取消了配置，
//    会把刚放上去的小组件直接删掉（AppWidget 配置流程的硬约束）。
// 2. **这里不拉起应用**（2026-09-21 用户定案）：ColorOS 上「配置活动立刻跳回应用」会被
//    判为放置失败、桌面留不下卡片；而「先落一块空白卡片（显示「点一下选择内容」）+
//    用户点它时由小组件自身的点击目标把 bind 层拉起来」在**所有 ROM 上都能成**，
//    代价只是多一次点击。路径因此与机型无关——不把行为押在机型判定上（属性通道是隐藏
//    API，可能读不到；品牌通道可靠但只覆盖 OPPO/一加/真我）。
//    机型判定的产物（RomInfo）只用于引导文案与自检诊断。
package app.onethu.mobile

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle

class OnethuWidgetConfigActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            // 落点：用户点这块卡片时（或应用稍后启动时）由 bind 层取走
            LaunchTarget.put(this, "widget-config:$id")
        }
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        finish()
    }
}
