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

    val isRunning: Boolean get() = running

    /** 启动（引擎 + 采集线程）。须已持有 RECORD_AUDIO 权限。 */
    @SuppressLint("MissingPermission")
    fun start() {
        if (running) return
        val ks = spotter ?: createSpotter(context).also { spotter = it }
        running = true
        paused = false
        thread = Thread({ loop(ks) }, "onethu-kws").apply {
            priority = Process.THREAD_PRIORITY_AUDIO
            start()
        }
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
            val n = rec.read(buf, 0, buf.size)
            if (n <= 0) {
                Thread.sleep(40)
                continue
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

    private fun createRecord(): AudioRecord? = try {
        val min = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        )
        AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(min, SAMPLE_RATE), // ≥0.5s 缓冲
        ).also { it.startRecording() }
    } catch (e: Exception) {
        Logger.warn(TAG, "AudioRecord 创建失败：$e")
        null
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
            keywordsScore = 1.5f,
            keywordsThreshold = 0.25f,
            maxActivePaths = 4,
            numTrailingBlanks = 2,
        )
        return KeywordSpotter(assetManager = context.assets, config = cfg)
    }
}
