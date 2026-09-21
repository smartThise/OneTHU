// 小组件「配置」入口（android:configure）。
//
// 用户往桌面放一块 OneTHU 小组件时，系统会先拉起这里。原生这里**不做选择界面**：
// 内容候选项（所有功能页 / 收藏夹 / 收藏原子 / 插件原子）只存在于应用的 JS 注册表里，
// 小组件进程里既没有 WebView 也没有注册表，因此这里只做一件事——把「要给哪一块配」
// 记成应用能取走的落点，然后拉起应用由它显示选择层。
//
// 必须回 RESULT_OK 并把 appWidgetId 塞回 intent：否则启动器认为用户取消了配置，
// 会把刚放上去的小组件直接删掉（这条是 AppWidget 配置流程的硬约束）。

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
            LaunchTarget.put(this, "widget-config:$id")
        }
        // 让启动器保留这块小组件
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        // ColorOS 分流（2026-09-21 用户定案）：配置活动里立刻跳回应用会被判为放置失败，
        // 桌面上留不下卡片。改为**先落一块空白小组件**（显示「点一下选择内容」），
        // 用户点它时再由小组件自身的点击目标把 bind 层拉起来——这条路径实测可行。
        if (RomInfo.isColorOs) {
            finish()
            return
        }
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try {
                startActivity(launch)
            } catch (e: Exception) {
                // 拉起失败（ROM 限制）：小组件留在桌面上显示「点一下选择内容」，用户点它也能配
            }
        }
        finish()
    }
}
