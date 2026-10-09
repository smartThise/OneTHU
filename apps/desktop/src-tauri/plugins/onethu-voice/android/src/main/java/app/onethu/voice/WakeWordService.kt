package app.onethu.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import app.tauri.Logger

/**
 * 唤醒词监听前台服务（microphone 类型——targetSdk 34+ 强制声明服务类型；
 * Android 11+ 麦克风 FGS 的 while-in-use 限制要求由前台用户动作拉起，本服务
 * 只经用户在 App 内开启监听启动，不做开机自启/后台拉起）。
 */
class WakeWordService : Service() {

    companion object {
        const val CHANNEL_ID = "onethu_voice_listening"
        const val NOTIFICATION_ID = 0x0E7A
        const val ACTION_STOP = "app.onethu.voice.STOP"

        /** 当前引擎实例（markState 恢复采集用；服务存活期非空） */
        @Volatile
        var engineRef: WakeWordEngine? = null

        fun start(context: Context) {
            val intent = Intent(context, WakeWordService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WakeWordService::class.java))
        }
    }

    private var engine: WakeWordEngine? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        if (engine == null) {
            engine = WakeWordEngine(this) { keyword -> VoiceHub.onWake?.invoke(keyword) }
            engineRef = engine
            try {
                engine!!.start()
                VoiceHub.markListening()
            } catch (e: Exception) {
                Logger.warn("OnethuVoice", "引擎启动失败：$e")
                stopSelf()
                return START_NOT_STICKY
            }
        }
        // 服务被系统杀后不自动复活（用户重新开启才恢复；报告 §8.1：被杀有恢复入口）
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        engineRef = null
        engine?.stop()
        engine = null
        VoiceHub.markIdle()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val stopIntent = PendingIntent.getService(
            this, 1,
            Intent(this, WakeWordService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val pi = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = PendingIntent.getActivity(
            this, 2, pi, PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("OH 正在监听唤醒词")
            .setContentText("说「你好小欧」或「小欧小欧」唤醒语音助手")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(contentIntent)
            .addAction(Notification.Action.Builder(null, "停止监听", stopIntent).build())
            .build()
    }

    private fun createChannel() {
        val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "语音唤醒监听",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "唤醒词常驻监听的状态通知"
                setShowBadge(false)
            },
        )
    }
}
