package app.onethu.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Process
import app.tauri.Logger
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 本地 TTS：sherpa-onnx vits-melo-tts-zh_en（中英，44.1kHz）运行时下载制——
 * 模型 159MB 不打 APK，首次 ttsPrepare 从 release 下载 tar.bz2（流式 sha256 校验）
 * → commons-compress 解包到 filesDir → OfflineTts newFromFile。
 * 合成走 generateWithCallback：边合成边写 AudioTrack（首包延迟低），callback
 * 返回 1 即中止（ttsStop）。播放完成/停止经 onDone 回调上报状态机（SPEAKING → done）。
 */
object TtsEngine {

    private const val TAG = "OnethuVoice"
    const val MODEL_NAME = "vits-melo-tts-zh_en"
    const val MODEL_URL =
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2"
    const val MODEL_SHA256 = "e58351ed7149f290a54534538badd4077cdbe6fddc964b24d0bee870415d1514" // vits-melo-tts-zh_en.tar.bz2 实测（2026-10-09，159.3MB）

    @Volatile
    var state: String = "none" // none | downloading | extracting | ready | error
        private set

    @Volatile
    var progress: Int = 0 // 下载百分比
        private set

    var onError: ((String) -> Unit)? = null
    var onDone: ((reason: String) -> Unit)? = null

    private var tts: OfflineTts? = null
    private var track: AudioTrack? = null
    private var speakThread: Thread? = null

    @Volatile
    private var abortSpeak = false

    fun modelDir(context: Context): File =
        File(File(context.filesDir, "models/tts"), MODEL_NAME)

    fun isReady(): Boolean = tts != null

    /** 后台准备（幂等）：已就绪直接回；下载/解包/初始化异步推进，进度查 ttsStatus */
    @Synchronized
    fun prepare(context: Context) {
        if (tts != null || state == "downloading" || state == "extracting") return
        if (!modelReady(context)) {
            Thread({ downloadAndInstall(context) }, "onethu-tts-dl").start()
        } else {
            Thread({ initEngine(context) }, "onethu-tts-init").start()
        }
    }

    private fun modelReady(context: Context): Boolean {
        val d = modelDir(context)
        return File(d, "model.onnx").exists() && File(d, "lexicon.txt").exists()
    }

    private fun downloadAndInstall(context: Context) {
        try {
            setState("downloading", 0)
            val tmp = File(context.cacheDir, "$MODEL_NAME.tar.bz2")
            val conn = URL(MODEL_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = true
            val total = conn.contentLengthLong
            val md = MessageDigest.getInstance("SHA-256")
            conn.inputStream.use { ins ->
                FileOutputStream(tmp).use { fos ->
                    val buf = ByteArray(1 shl 16)
                    var read = 0L
                    while (true) {
                        val n = ins.read(buf)
                        if (n <= 0) break
                        md.update(buf, 0, n)
                        fos.write(buf, 0, n)
                        read += n
                        if (total > 0) {
                            val p = (read * 100 / total).toInt()
                            if (p != progress) setState("downloading", p)
                        }
                    }
                }
            }
            val sha = md.digest().joinToString("") { "%02x".format(it) }
            if (sha != MODEL_SHA256) {
                tmp.delete()
                throw IllegalStateException("模型校验失败：sha256=$sha（预期 $MODEL_SHA256）")
            }
            setState("extracting", 100)
            val parent = modelDir(context).parentFile!!
            parent.mkdirs()
            TarArchiveInputStream(BZip2CompressorInputStream(FileInputStream(tmp))).use { tar ->
                while (true) {
                    val e = tar.nextTarEntry ?: break
                    if (!tar.canReadEntryData(e)) continue
                    val out = File(parent, e.name)
                    if (e.isDirectory) {
                        out.mkdirs()
                    } else {
                        out.parentFile?.mkdirs()
                        FileOutputStream(out).use { tar.copyTo(it) }
                    }
                }
            }
            tmp.delete()
            initEngine(context)
        } catch (e: Exception) {
            Logger.warn(TAG, "TTS 准备失败：$e")
            setState("error", 0)
            onError?.invoke(e.message ?: e.toString())
        }
    }

    private fun initEngine(context: Context) {
        try {
            setState("extracting", 100)
            val d = modelDir(context)
            val cfg = OfflineTtsConfig(
                model = OfflineTtsModelConfig(
                    vits = OfflineTtsVitsModelConfig(
                        model = File(d, "model.onnx").absolutePath,
                        lexicon = File(d, "lexicon.txt").absolutePath,
                        tokens = File(d, "tokens.txt").absolutePath,
                        dictDir = File(d, "dict").absolutePath,
                    ),
                    numThreads = 2,
                ),
                ruleFsts = listOf(
                    File(d, "date.fst"), File(d, "number.fst"),
                ).filter { it.exists() }.joinToString(",") { it.absolutePath },
                maxNumSentences = 1,
            )
            tts = OfflineTts(assetManager = null, config = cfg)
            setState("ready", 100)
            Logger.info(TAG, "TTS 就绪：sampleRate=${tts!!.sampleRate()}")
        } catch (e: Exception) {
            Logger.warn(TAG, "TTS 初始化失败：$e")
            setState("error", 0)
            onError?.invoke(e.message ?: e.toString())
        }
    }

    /** 合成并流式播放；立即返回，完成/中止经 onDone(reason: done|stopped|error) */
    fun speak(context: Context, text: String, speed: Float, sid: Int): Boolean {
        val engine = tts ?: return false
        if (text.isBlank()) return false
        stopSpeak()
        abortSpeak = false
        speakThread = Thread({
            try {
                Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
                val sampleRate = engine.sampleRate()
                val minBuf = AudioTrack.getMinBufferSize(
                    sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT,
                )
                val tr = AudioTrack(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                    AudioFormat.Builder()
                        .setSampleRate(sampleRate)
                        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                    maxOf(minBuf, sampleRate / 2),
                    AudioTrack.MODE_STREAM,
                    AudioManager.AUDIO_SESSION_ID_GENERATE,
                )
                track = tr
                tr.play()
                engine.generateWithCallback(text, sid = sid, speed = speed) { samples ->
                    if (abortSpeak) 1
                    else {
                        tr.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
                        0
                    }
                }
                if (abortSpeak) {
                    tr.pause(); tr.flush()
                    onDone?.invoke("stopped")
                } else {
                    // 尾部静音兜底：写完立即停（音频已全部写入）
                    tr.stop()
                    onDone?.invoke("done")
                }
            } catch (e: Exception) {
                Logger.warn(TAG, "TTS 播放失败：$e")
                onDone?.invoke("error:${e.message}")
            } finally {
                track?.release()
                track = null
            }
        }, "onethu-tts-speak").also { it.start() }
        return true
    }

    fun stopSpeak() {
        abortSpeak = true
        try {
            track?.pause()
            track?.flush()
        } catch (_: Exception) {
        }
        speakThread?.join(500)
        speakThread = null
    }

    fun release() {
        stopSpeak()
        tts?.release()
        tts = null
        setState("none", 0)
    }

    private fun setState(s: String, p: Int) {
        state = s
        progress = p
    }
}
