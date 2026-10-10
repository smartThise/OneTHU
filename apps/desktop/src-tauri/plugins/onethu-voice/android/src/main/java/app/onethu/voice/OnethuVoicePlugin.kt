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
        VoiceTts.onDone = { reason ->
            val payload = JSObject()
            payload.put("reason", reason)
            trigger("onethu-voice://tts-done", payload)
        }
        VoiceTts.ensureInit(activity)
        // 引擎错误事件桥：服务内异常 → JS（console.error 落 onethu-debug.log，可导出）
        VoiceHub.onEngineError = { msg ->
            val payload = JSObject()
            payload.put("message", msg.take(600))
            trigger("onethu-voice://engine-error", payload)
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
        if (!startService()) {
            invoke.reject("监听服务拉起失败（详见通知/日志）")
            return
        }
        invoke.resolve()
    }

    @PermissionCallback
    fun micPermissionCallback(invoke: Invoke) {
        if (!hasMic()) {
            invoke.reject("无麦克风权限（系统设置 → 应用 → OneTHU → 麦克风）")
            return
        }
        if (!startService()) {
            invoke.reject("监听服务拉起失败（详见通知/日志）")
            return
        }
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

    // ---------- TTS（双后端：system=Android TextToSpeech 默认 / neural=sherpa-onnx 可选下载） ----------

    @Command
    fun ttsSupported(invoke: Invoke) {
        val neural = try {
            Class.forName("com.k2fsa.sherpa.onnx.OfflineTts")
            true
        } catch (_: Throwable) {
            false
        }
        invoke.resolve(JSObject().put("value", neural || SystemTts.ready))
    }

    /** 准备（backend=neural 时下载/解包/初始化模型；system 即时初始化引擎） */
    @Command
    fun ttsPrepare(invoke: Invoke) {
        val backend = invoke.getArgs().optString("backend", VoiceTts.BACKEND_SYSTEM)
        if (backend == VoiceTts.BACKEND_NEURAL) {
            TtsEngine.prepare(activity)
        } else {
            SystemTts.ensureInit(activity)
        }
        invoke.resolve()
    }

    @Command
    fun ttsSpeak(invoke: Invoke) {
        val text = invoke.getArgs().optString("text", "")
        val speed = invoke.getArgs().optDouble("speed", 1.0).toFloat()
        val pitch = invoke.getArgs().optDouble("pitch", 1.0).toFloat()
        val sid = invoke.getArgs().optInt("sid", 0)
        val voiceName = invoke.getArgs().optString("voice", "")
        if (!VoiceTts.isReady()) {
            invoke.reject("TTS 未就绪（backend=${VoiceTts.backend}, state=${VoiceTts.status()}）")
            return
        }
        val started = VoiceTts.speak(activity, text, speed, pitch, sid, voiceName.ifBlank { null })
        if (started) invoke.resolve() else invoke.reject("合成未开始（空文本或引擎拒绝）")
    }

    @Command
    fun ttsStop(invoke: Invoke) {
        VoiceTts.stop()
        invoke.resolve()
    }

    @Command
    fun ttsStatus(invoke: Invoke) {
        val obj = JSObject()
        obj.put("state", VoiceTts.status())
        obj.put("progress", VoiceTts.progress())
        obj.put("ready", VoiceTts.isReady())
        obj.put("backend", VoiceTts.backend)
        invoke.resolve(obj)
    }

    /** 系统引擎中文音色列表（仅 system 档有效） */
    @Command
    fun ttsVoices(invoke: Invoke) {
        SystemTts.ensureInit(activity)
        val arr = org.json.JSONArray()
        SystemTts.zhVoices().forEach { arr.put(it) }
        invoke.resolve(JSObject().put("voices", arr))
    }

    /** 切换后端（system | neural），持久化 */
    @Command
    fun ttsSetBackend(invoke: Invoke) {
        val backend = invoke.getArgs().optString("backend", VoiceTts.BACKEND_SYSTEM)
        val ok = VoiceTts.setBackend(activity, backend)
        if (ok) invoke.resolve() else invoke.reject("未知后端：$backend")
    }

    private fun startService(): Boolean = try {
        WakeWordService.start(activity)
        installWakeBridge()
        true
    } catch (e: Exception) {
        Logger.warn(TAG, "监听服务拉起失败：$e")
        VoiceHub.onEngineError?.invoke("startForegroundService: $e")
        false
    }

    /** 唤醒事件桥：引擎命中（已由 VoiceHub 完成 LISTENING→HANDOFF）后推给 JS。
     *  onKeyword 回调挂在引擎上会随服务生命周期丢失，这里经状态机一次性挂钩。 */
    private fun installWakeBridge() {
        VoiceHub.onWake = { keyword ->
            val payload = JSObject()
            payload.put("keyword", keyword)
            payload.put("timestamp", System.currentTimeMillis())
            trigger("onethu-voice://wake", payload)
        }
    }
}
