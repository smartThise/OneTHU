// OneTHU 灵动岛语音输入插件（Android）
//
// 会话式长按模型（与 macOS speech.m 同契约）：
// speechStart（麦克风运行时权限 → SpeechRecognizer 启动）→ speechPoll
// （部分转写实时读取）→ speechStop（收最终文本）。
//
// 细节：
// - zh-CN + EXTRA_PARTIAL_RESULTS，onPartialResults 持续覆盖当前文本；
// - 识别器因静音超时/无匹配自行结束时保留已识别文本（松手仍能拿到）；
// - 仍在按住期间识别器提前收尾（ERROR_SPEECH_TIMEOUT 等）→ 自动重启一轮，
//   让长按期间可以停顿换气再继续说；
// - 权限被拒 → reject 带原因（JS 侧雾白遮罩上展示）。

package app.onethu.speech

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import app.tauri.Logger
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private const val TAG = "OnethuSpeech"

@TauriPlugin(
  permissions = [
    Permission(
      strings = [Manifest.permission.RECORD_AUDIO],
      alias = "mic",
    ),
  ],
)
class OnethuSpeechPlugin(private val activity: android.app.Activity) : Plugin(activity) {

  @Volatile
  private var text: String = ""

  private var sr: SpeechRecognizer? = null
  /** 用户仍按住（会话期）：识别器意外收尾时自动续一轮 */
  @Volatile
  private var holding: Boolean = false

  private fun hasMic(): Boolean =
    ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  // ---------- 命令 ----------

  @Command
  fun speechSupported(invoke: Invoke) {
    val ok = SpeechRecognizer.isRecognitionAvailable(activity)
    invoke.resolve(JSObject().put("value", ok))
  }

  @Command
  fun speechStart(invoke: Invoke) {
    if (!hasMic()) {
      requestPermissionForAliases(arrayOf("mic"), invoke, "micPermissionCallback")
      return
    }
    activity.runOnUiThread { startListening() } // SpeechRecognizer 必须主线程
    invoke.resolve()
  }

  @PermissionCallback
  fun micPermissionCallback(invoke: Invoke) {
    if (!hasMic()) {
      invoke.reject("无麦克风权限（系统设置 → 应用 → OneTHU → 麦克风）")
      return
    }
    activity.runOnUiThread { startListening() }
    invoke.resolve()
  }

  @Command
  fun speechPoll(invoke: Invoke) {
    invoke.resolve(JSObject().put("text", text))
  }

  @Command
  fun speechStop(invoke: Invoke) {
    holding = false
    try {
      sr?.stopListening() // 触发 onResults（最终文本）
    } catch (e: Exception) {
      Logger.warn(TAG, "stopListening: $e")
    }
    invoke.resolve()
  }

  // ---------- 识别会话 ----------

  private fun startListening() {
    holding = true
    text = ""
    try {
      sr?.destroy()
    } catch (_: Exception) {
    }
    sr = SpeechRecognizer.createSpeechRecognizer(activity).also { recognizer ->
      recognizer.setRecognitionListener(object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
          partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
            text = it
          }
        }

        override fun onResults(results: Bundle?) {
          results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
            text = it
          }
        }

        override fun onError(error: Int) {
          Logger.warn(TAG, "recognition error $error (text=${text.length} chars)")
          // 还在按住且没识别到东西 → 重启一轮（用户可能停顿换气超过静音窗）
          if (holding && text.isEmpty() && error != SpeechRecognizer.ERROR_CLIENT) {
            restart()
          }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
      })
      recognizer.startListening(
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        },
      )
    }
  }

  private fun restart() {
    activity.runOnUiThread {
      if (!holding) return@runOnUiThread
      try {
        sr?.destroy()
      } catch (_: Exception) {
      }
      sr = null
      startListening()
    }
  }

  override fun destroy() {
    holding = false
    try {
      sr?.destroy()
    } catch (_: Exception) {
    }
    sr = null
    super.destroy()
  }
}
