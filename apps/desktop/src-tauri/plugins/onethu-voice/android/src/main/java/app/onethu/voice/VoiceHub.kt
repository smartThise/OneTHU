package app.onethu.voice

/**
 * 语音状态机（进程级单例，Kotlin 侧为唯一仲裁者；TS 经事件订阅）。
 *
 * IDLE → LISTENING → [唤醒] HANDOFF → RECOGNIZING → PROCESSING → (SPEAKING) → LISTENING
 *
 * 规则：
 * - SPEAKING / PROCESSING / RECOGNIZING 期间唤醒引擎保持暂停（防 TTS 自唤醒、防抢麦）
 * - 仅 LISTENING 接受唤醒命中
 * - JS 经 wake_mark_state 回告只有 JS 知道的时刻（识别结束→processing→speaking→done）
 */
object VoiceHub {

    enum class State { IDLE, LISTENING, HANDOFF, RECOGNIZING, PROCESSING, SPEAKING }

    @Volatile
    var state: State = State.IDLE
        private set

    /** 状态变更回调（插件注册，转发 Tauri 事件到 JS） */
    var onStateChange: ((from: State, to: State) -> Unit)? = null

    /** 唤醒命中回调（插件注册，推 wake 事件到 JS） */
    var onWake: ((keyword: String) -> Unit)? = null

    private fun transition(to: State) {
        val from = state
        if (from == to) return
        state = to
        onStateChange?.invoke(from, to)
    }

    /** 用户开启监听（服务启动成功后由 Engine 调） */
    fun markListening() = transition(State.LISTENING)

    /** 唤醒命中（Engine 回调，仅 LISTENING 态接受） */
    fun markHandoff(): Boolean {
        if (state != State.LISTENING) return false
        transition(State.HANDOFF)
        return true
    }

    /** JS 回告：识别中（收到 wake 事件、开始 SpeechRecognizer 后） */
    fun markRecognizing() {
        if (state == State.HANDOFF) transition(State.RECOGNIZING)
    }

    /** JS 回告：LLM 处理中 */
    fun markProcessing() {
        if (state == State.RECOGNIZING || state == State.HANDOFF) transition(State.PROCESSING)
    }

    /** JS 回告：TTS 播放中（引擎保持暂停） */
    fun markSpeaking() {
        if (state == State.PROCESSING) transition(State.SPEAKING)
    }

    /** JS 回告：一轮结束/出错 → 恢复监听（引擎 resume） */
    fun markDone() {
        if (state != State.IDLE) transition(State.LISTENING)
    }

    /** 监听被停（服务停止/权限丢失） */
    fun markIdle() = transition(State.IDLE)

    val isBusy: Boolean
        get() = state != State.IDLE && state != State.LISTENING
}
