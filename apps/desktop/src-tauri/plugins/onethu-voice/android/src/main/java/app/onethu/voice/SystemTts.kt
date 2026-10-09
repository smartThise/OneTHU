package app.onethu.voice

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import app.tauri.Logger
import java.util.Locale

/**
 * 系统 TTS 后端：Android TextToSpeech（各 ROM 自带引擎——华为/荣耀小艺语音、
 * 小爱语音、Google TTS 等），零下载零体积。
 *
 * 能力（对应报告 §5.4「设置必须驱动真实音频效果」）：
 * - setPitch 音高（0.5~2.0）
 * - setSpeechRate 语速（0.5~2.0）
 * - setVoice 音色（voices 列表按 ROM 而异，过滤 zh）
 * - UtteranceProgressListener onDone/onError → 状态机 SPEAKING→done
 *
 * 局限如实记录：音质为各 ROM 合成水平（非神经网络），无 GMS 且未装 TTS 数据的
 * ROM 可能 isReady=false——此时 UI 引导切 neural 档（下载 melo）。
 */
object SystemTts {

    private const val TAG = "OnethuVoice"

    @Volatile
    var ready = false
        private set

    var onDone: ((reason: String) -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    private var tts: TextToSpeech? = null

    @Volatile
    private var initStarted = false

    /** 初始化（幂等；异步 onInit 后 ready 才为 true） */
    @Synchronized
    fun ensureInit(context: Context) {
        if (initStarted) return
        initStarted = true
        val appCtx = context.applicationContext
        tts = TextToSpeech(appCtx) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (!ready) {
                Logger.warn(TAG, "系统 TTS 初始化失败（status=$status）")
                return@TextToSpeech
            }
            val t = tts ?: return@TextToSpeech
            val r = t.setLanguage(Locale.SIMPLIFIED_CHINESE)
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                Logger.warn(TAG, "系统 TTS 无中文数据（$r）")
                ready = false
                return@TextToSpeech
            }
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) {
                    onDone?.invoke("done")
                }

                @Deprecated("API 21 前回调")
                override fun onError(utteranceId: String?) {
                    onDone?.invoke("error")
                }

                override fun onError(utteranceId: String?, errorCode: Int) {
                    onDone?.invoke("error:$errorCode")
                }
            })
            Logger.info(TAG, "系统 TTS 就绪（defaultVoice=${t.defaultVoice?.name}）")
        }
    }

    /** 中文音色列表（name → 显示名映射由 JS 侧处理） */
    fun zhVoices(): List<String> {
        val t = tts ?: return emptyList()
        return try {
            t.voices.orEmpty()
                .filter { it.locale.language.equals("zh", true) || it.locale.toLanguageTag().startsWith("zh") }
                .map { it.name }
                .distinct()
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** 朗读（QUEUE_FLUSH 抢占即天然打断）；返回是否受理 */
    fun speak(text: String, speed: Float, pitch: Float, voiceName: String?): Boolean {
        val t = tts ?: return false
        if (!ready || text.isBlank()) return false
        try {
            t.setSpeechRate(speed.coerceIn(0.5f, 2.0f))
            t.setPitch(pitch.coerceIn(0.5f, 2.0f))
            if (!voiceName.isNullOrBlank()) {
                val v: Voice? = t.voices.orEmpty().firstOrNull { it.name == voiceName }
                if (v != null) t.voice = v
            }
            val r = t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "onethu-tts-${System.currentTimeMillis()}")
            return r == TextToSpeech.SUCCESS
        } catch (e: Exception) {
            Logger.warn(TAG, "系统 TTS 播放异常：$e")
            return false
        }
    }

    fun stop() {
        try {
            tts?.stop()
        } catch (_: Exception) {
        }
    }

    fun shutdown() {
        stop()
        try {
            tts?.shutdown()
        } catch (_: Exception) {
        }
        tts = null
        ready = false
        initStarted = false
    }
}
