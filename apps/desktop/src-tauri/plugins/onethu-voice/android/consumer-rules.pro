# sherpa-onnx vendored 绑定：JNI 侧按**字段名**反射读配置（GetFieldID）——
# R8 改名字段 = 运行时 "Failed to get field ID for maxActivePaths" → 唤醒引擎
# 起不来（2026-10-10 真机实录：点球无反应的根因）。类名/字段名/方法名全 keep。
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keepclassmembers class com.k2fsa.sherpa.onnx.** { *; }
-dontwarn com.k2fsa.sherpa.onnx.**
