package app.onethu.voice

import android.content.Context

/**
 * TTS 统一调度：双后端
 *  - system：Android TextToSpeech（默认，零下载；pitch/rate/voice 真实生效）
 *  - neural：sherpa-onnx vits-melo（可选下载 ~160MB，神经网络音质；speed/sid）
 * 激活后端持久化（SharedPreferences），onDone 统一汇聚到状态机。
 */
object VoiceTts {

    const val BACKEND_SYSTEM = "system"
    const val BACKEND_NEURAL = "neural"

    @Volatile
    var backend: String = BACKEND_SYSTEM
        private set

    var onDone: ((reason: String) -> Unit)? = null

    fun ensureInit(context: Context) {
        loadBackend(context)
        SystemTts.onDone = { r -> onDone?.invoke(r) }
        SystemTts.ensureInit(context)
        TtsEngine.onDone = { r -> onDone?.invoke(r) }
    }

    fun setBackend(context: Context, b: String): Boolean {
        if (b != BACKEND_SYSTEM && b != BACKEND_NEURAL) return false
        backend = b
        context.getSharedPreferences("onethu_voice", Context.MODE_PRIVATE)
            .edit().putString("tts_backend", b).apply()
        if (b == BACKEND_SYSTEM) SystemTts.ensureInit(context)
        return true
    }

    private fun loadBackend(context: Context) {
        backend = context.getSharedPreferences("onethu_voice", Context.MODE_PRIVATE)
            .getString("tts_backend", BACKEND_SYSTEM) ?: BACKEND_SYSTEM
    }

    /** 就绪判定：system 看引擎；neural 看模型 */
    fun isReady(): Boolean = when (backend) {
        BACKEND_NEURAL -> TtsEngine.isReady()
        else -> SystemTts.ready
    }

    /** 朗读（按后端分发，pitch/voiceName 仅 system 生效；speed 两档都生效） */
    fun speak(context: Context, text: String, speed: Float, pitch: Float, sid: Int, voiceName: String?): Boolean {
        return when (backend) {
            BACKEND_NEURAL -> TtsEngine.speak(context, text, speed, sid)
            else -> {
                SystemTts.ensureInit(context)
                SystemTts.speak(text, speed, pitch, voiceName)
            }
        }
    }

    fun stop() {
        SystemTts.stop()
        TtsEngine.stopSpeak()
    }

    fun status(): String = when (backend) {
        BACKEND_NEURAL -> TtsEngine.state
        else -> if (SystemTts.ready) "ready" else "none"
    }

    fun progress(): Int = if (backend == BACKEND_NEURAL) TtsEngine.progress else (if (SystemTts.ready) 100 else 0)
}
