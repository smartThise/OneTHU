// OneTHU 语音中枢插件（Android）：KWS 唤醒命令面 + 事件桥。
//
// 命令（与 Rust commands.rs 一一对应）：
//  wakeSupported / wakeStart / wakeStop / wakeStatus / wakeMarkState
// 事件（Tauri trigger → JS listen）：
//  onethu-voice://wake  { keyword, timestamp }
//  onethu-voice://state { from, to }
package app.onethu.voice

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "OnethuVoice"

@TauriPlugin(
    permissions = [
        Permission(
            strings = [Manifest.permission.RECORD_AUDIO],
            alias = "mic",
        ),
    ],
)
class OnethuVoicePlugin(private val activity: android.app.Activity) : Plugin(activity) {

    init {
        // 状态机事件桥：Kotlin 真源 → Tauri 事件 → JS（实例化即挂钩，早于 WebView 加载）
        VoiceHub.onStateChange = { from, to ->
            val payload = JSObject()
            payload.put("from", from.name)
            payload.put("to", to.name)
            trigger("onethu-voice://state", payload)
        }
        TtsEngine.onDone = { reason ->
            val payload = JSObject()
            payload.put("reason", reason)
            trigger("onethu-voice://tts-done", payload)
        }
    }

    private fun hasMic(): Boolean =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    @Command
    fun wakeSupported(invoke: Invoke) {
        val assetsOk = WakeWordEngine.assetsPresent(activity)
        val jniOk = try {
            Class.forName("com.k2fsa.sherpa.onnx.KeywordSpotter")
            true
        } catch (_: Throwable) {
            false
        }
        invoke.resolve(JSObject().put("value", assetsOk && jniOk))
    }

    @Command
    fun wakeStart(invoke: Invoke) {
        if (!WakeWordEngine.assetsPresent(activity)) {
            invoke.reject("唤醒模型缺失（assets/kws 不完整）")
            return
        }
        if (!hasMic()) {
            requestPermissionForAliases(arrayOf("mic"), invoke, "micPermissionCallback")
            return
        }
        startService()
        invoke.resolve()
    }

    @PermissionCallback
    fun micPermissionCallback(invoke: Invoke) {
        if (!hasMic()) {
            invoke.reject("无麦克风权限（系统设置 → 应用 → OneTHU → 麦克风）")
            return
        }
        startService()
        invoke.resolve()
    }

    @Command
    fun wakeStop(invoke: Invoke) {
        WakeWordService.stop(activity)
        invoke.resolve()
    }

    @Command
    fun wakeStatus(invoke: Invoke) {
        val obj = JSObject()
        obj.put("state", VoiceHub.state.name)
        obj.put("listening", VoiceHub.state == VoiceHub.State.LISTENING)
        obj.put("keyword", "你好小欧/小欧小欧")
        invoke.resolve(obj)
    }

    /** JS 回告状态（mark: recognizing|processing|speaking|done|error） */
    @Command
    fun wakeMarkState(invoke: Invoke) {
        val mark = invoke.getArgs().optString("mark", "done")
        when (mark) {
            "recognizing" -> VoiceHub.markRecognizing()
            "processing" -> VoiceHub.markProcessing()
            "speaking" -> VoiceHub.markSpeaking()
            "done", "error" -> {
                VoiceHub.markDone()
                // 恢复采集（IDLE 时服务已停，engineRef 为 null——安全）
                WakeWordService.engineRef?.resume()
            }
            else -> Logger.warn(TAG, "未知 mark：$mark")
        }
        invoke.resolve()
    }

    // ---------- TTS ----------

    @Command
    fun ttsSupported(invoke: Invoke) {
        val ok = try {
            Class.forName("com.k2fsa.sherpa.onnx.OfflineTts")
            true
        } catch (_: Throwable) {
            false
        }
        invoke.resolve(JSObject().put("value", ok))
    }

    /** 触发后台准备（下载/解包/初始化），进度经 ttsStatus 轮询 */
    @Command
    fun ttsPrepare(invoke: Invoke) {
        TtsEngine.prepare(activity)
        invoke.resolve()
    }

    @Command
    fun ttsSpeak(invoke: Invoke) {
        val text = invoke.getArgs().optString("text", "")
        val speed = invoke.getArgs().optDouble("speed", 1.0).toFloat()
        val sid = invoke.getArgs().optInt("sid", 0)
        if (!TtsEngine.isReady()) {
            invoke.reject("TTS 未就绪（state=${TtsEngine.state}）——先 tts_prepare")
            return
        }
        val started = TtsEngine.speak(activity, text, speed, sid)
        if (started) invoke.resolve() else invoke.reject("合成未开始（空文本？）")
    }

    @Command
    fun ttsStop(invoke: Invoke) {
        TtsEngine.stopSpeak()
        invoke.resolve()
    }

    @Command
    fun ttsStatus(invoke: Invoke) {
        val obj = JSObject()
        obj.put("state", TtsEngine.state)
        obj.put("progress", TtsEngine.progress)
        obj.put("ready", TtsEngine.isReady())
        invoke.resolve(obj)
    }

    private fun startService() {
        WakeWordService.start(activity)
        // 唤醒事件桥：引擎命中（已由 VoiceHub 完成 LISTENING→HANDOFF）后推给 JS
        // onKeyword 回调挂在引擎上会随服务生命周期丢失，这里经状态机一次性挂钩
        VoiceHub.onWake = { keyword ->
            val payload = JSObject()
            payload.put("keyword", keyword)
            payload.put("timestamp", System.currentTimeMillis())
            trigger("onethu-voice://wake", payload)
        }
    }
}
