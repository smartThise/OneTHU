package app.onethu.voice

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import app.tauri.Logger
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig

/**
 * sherpa-onnx KWS 唤醒引擎：assets/kws 下的 zipformer int8 模型 + keywords.txt
 * （"你好小欧" / "小欧小欧"）。AudioRecord 16k/mono/16bit 喂流式检测。
 *
 * 暂停/恢复即 AudioRecord 释放与重建——SpeechRecognizer 与 TTS 期间彻底让出麦克风。
 */
class WakeWordEngine(
    private val context: Context,
    private val onKeyword: (keyword: String) -> Unit,
    /** 诊断仪表（每 ~5s 一次）：读帧数 + RMS 电平（dBFS）+ 是否被系统静默——
     *  真机排障用，区分「没读到帧 / 被静默 / 静音 / 有声但没命中」四种死法（2026-10-10） */
    private val onStats: ((frames: Long, rmsDb: Double, silenced: Boolean) -> Unit)? = null,
) {
    companion object {
        private const val TAG = "OnethuVoice"
        private const val SAMPLE_RATE = 16000
        private const val ASSET_DIR = "kws"

        /** 模型资产是否齐备（轻探，不加载 JNI） */
        fun assetsPresent(context: Context): Boolean = try {
            context.assets.list(ASSET_DIR)?.let {
                it.any { n -> n == "keywords.txt" } && it.any { n -> n.endsWith(".onnx") }
            } ?: false
        } catch (_: Exception) {
            false
        }
    }

    private var spotter: KeywordSpotter? = null
    private var record: AudioRecord? = null
    private var thread: Thread? = null

    @Volatile
    private var running = false

    @Volatile
    private var paused = false

    /** 当前在用的音频源（诊断用）；两路全败只上报一次 */
    private var lastAudioSource = -1
    private var micFailureReported = false

    /* 诊断仪表累计量 */
    private var framesRead = 0L
    private var rmsSum = 0.0
    private var rmsN = 0L
    private var statReads = 0
    private var zeroReads = 0

    val isRunning: Boolean get() = running

    /** 启动（引擎 + 采集线程）。须已持有 RECORD_AUDIO 权限。 */
    @SuppressLint("MissingPermission")
    fun start() {
        if (running) return
        val ks = spotter ?: createSpotter(context).also { spotter = it }
        running = true
        paused = false
        // 优先级修复（2026-10-10 真机实锤）：THREAD_PRIORITY_AUDIO=-16 是 Linux nice 值，
        // Thread.setPriority 只收 1..10 → IllegalArgumentException 把引擎炸死。
        // 正确做法：线程内 Process.setThreadPriority 设调度优先级（Linux 层），Java 层不动。
        thread = Thread(
            {
                try {
                    Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
                } catch (_: Exception) {
                    /* 部分 ROM 拒绝提权：退化为默认优先级，监听照常 */
                }
                loop(ks)
            },
            "onethu-kws",
        ).apply { start() }
    }

    /** 完全停止（服务 onDestroy）：停线程、释放模型与录音 */
    fun stop() {
        running = false
        thread?.join(600)
        thread = null
        releaseRecord()
        spotter?.release()
        spotter = null
    }

    /** 暂停采集（HANDOFF/SPEAKING 期间让出麦克风） */
    fun pause() {
        paused = true
        releaseRecord()
    }

    /** 恢复采集（LISTENING 态） */
    @SuppressLint("MissingPermission")
    fun resume() {
        if (!running || !paused) return
        paused = false
    }

    private fun loop(ks: KeywordSpotter) {
        val stream: OnlineStream = ks.createStream()
        val buf = ShortArray(1600) // 100ms @16k
        while (running) {
            if (paused) {
                Thread.sleep(80)
                continue
            }
            var rec = record
            if (rec == null) {
                rec = createRecord()?.also { record = it }
            }
            if (rec == null) {
                Thread.sleep(200)
                continue
            }
            // READ_NON_BLOCKING（2026-10-10 实锤）：静默态的 record 会让阻塞式 read()
            // 永久停在调用内部（线程卡死、归零计数/自愈永远不跑）——非阻塞返回 0，
            // 零读检测与静默上报才真正生效。
            val n = rec.read(buf, 0, buf.size, android.media.AudioRecord.READ_NON_BLOCKING)
            if (n <= 0) {
                // 自愈（2026-10-10 真机实锤）：荣耀/华为「仅前台麦克风」在后台/锁屏时把
                // record 静默，read 恒 0 且**回前台也不自愈**——连续归零 ~2s 即弃旧重建，
                // 恢复后自动继续；期间仪表每 ~5s 上报「被静默」提示。
                zeroReads += 1
                if (zeroReads % 125 == 0) { // 40ms × 125 ≈ 5s 一报
                    onStats?.invoke(framesRead, -120.0, true)
                }
                if (zeroReads >= 50) { // 40ms × 50 ≈ 2s：重建
                    releaseRecord()
                    Thread.sleep(1500)
                    zeroReads = 49 // 重建后仍归零 → 保持静默态上报节奏
                } else {
                    Thread.sleep(40)
                }
                continue
            }
            zeroReads = 0
            // 诊断仪表：帧计数 + RMS（50 读 ≈ 5s 一报）
            framesRead += n
            var sq = 0.0
            for (i in 0 until n) { val v = buf[i] / 32768.0; sq += v * v }
            rmsSum += sq; rmsN += n
            statReads += 1
            if (statReads >= 50) {
                val rms = if (rmsN > 0) Math.sqrt(rmsSum / rmsN) else 0.0
                val db = if (rms > 0) 20 * Math.log10(rms) else -120.0
                onStats?.invoke(framesRead, db, false)
                statReads = 0; rmsSum = 0.0; rmsN = 0L
            }
            // JNI 吃归一化 FloatArray（-1..1），AudioRecord 的 16bit PCM 要转
            val floats = FloatArray(n) { i -> buf[i] / 32768.0f }
            stream.acceptWaveform(floats, SAMPLE_RATE)
            while (ks.isReady(stream)) ks.decode(stream)
            val keyword = ks.getResult(stream).keyword
            if (keyword.isNotBlank()) {
                Logger.info(TAG, "唤醒命中：$keyword")
                ks.reset(stream)
                if (VoiceHub.markHandoff()) {
                    pause() // 让出麦克风给 SpeechRecognizer
                    onKeyword(keyword)
                }
            }
        }
        stream.release()
    }

    /**
     * 录音创建：VOICE_RECOGNITION 优先（回声消除/降噪增益），荣耀/华为 ROM 上第三方
     * 常被拒（2026-10-10 真机实锤：RecordActivityMonitor 无 rec start，magicvoice
     * 独占 HOTWORD/识别源）→ 回退 MIC 源。两路全败 → 上报一次诊断（防循环刷屏）。
     */
    private fun createRecord(): AudioRecord? {
        for (src in intArrayOf(MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC)) {
            val rec = tryCreateRecord(src)
            if (rec != null) {
                if (lastAudioSource != src) {
                    lastAudioSource = src
                    Logger.info(TAG, "AudioRecord 起来了（source=$src）")
                }
                return rec
            }
        }
        if (!micFailureReported) {
            micFailureReported = true
            VoiceHub.onEngineError?.invoke("AudioRecord 两路全败（VOICE_RECOGNITION 与 MIC 均创建/启动失败）——检查系统麦克风限制")
        }
        return null
    }

    private fun tryCreateRecord(source: Int): AudioRecord? {
        return try {
                val min = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                )
                val rec = AudioRecord(
                    source,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(min, SAMPLE_RATE), // ≥0.5s 缓冲
                )
                if (rec.state != AudioRecord.STATE_INITIALIZED) {
                    rec.release()
                    Logger.warn(TAG, "AudioRecord 未初始化（source=$source）")
                    return null
                }
                rec.startRecording()
                if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                    rec.release()
                    Logger.warn(TAG, "AudioRecord 启动后未进入录音态（source=$source）")
                    return null
                }
                rec

        } catch (e: Exception) {
            Logger.warn(TAG, "AudioRecord 创建失败（source=$source）：$e")
            null
        }
    }

    private fun releaseRecord() {
        try {
            record?.stop()
        } catch (_: Exception) {
        }
        try {
            record?.release()
        } catch (_: Exception) {
        }
        record = null
    }

    private fun createSpotter(context: Context): KeywordSpotter {
        val cfg = KeywordSpotterConfig(
            featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = "$ASSET_DIR/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                    decoder = "$ASSET_DIR/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                    joiner = "$ASSET_DIR/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                ),
                tokens = "$ASSET_DIR/tokens.txt",
                modelType = "zipformer2",
                numThreads = 2,
            ),
            keywordsFile = "$ASSET_DIR/keywords.txt",
            keywordsScore = 2.0f,   // 2026-10-10 调灵敏度：boost 1.5→2.0、阈值 0.25→0.15（keywords.txt 同步）
            keywordsThreshold = 0.15f,
            maxActivePaths = 4,
            numTrailingBlanks = 2,
        )
        return KeywordSpotter(assetManager = context.assets, config = cfg)
    }
}
