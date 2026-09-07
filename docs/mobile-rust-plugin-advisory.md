# 移动端 Rust 插件（内嵌 harness）使用通告

结论先行：不建议在移动端（Android/iOS）使用 Rust 构建的插件形态。移动端请优先使用 JS 插件（kind:"js"，blob 动态 import，无跨线程桥）。

## 原因（0.8.0 实测，2026-09-07）

内嵌 harness 每次调用都要跨线程/跨进程往返：
harness线程(Rust) --emit plugin-rpc--> webview(JS facade) --invoke http_request--> Rust(reqwest出网) --> webview --invoke harness_rpc_reply--> harness线程。
一次插件调用 = 4 次 IPC 往返；登录后首屏并发十余个调用，事件风暴叠加渲染竞争，实测每操作延迟达 10s 量级。回执依赖 webview 存活——页面重载时桥线程按 BRIDGE_TIMEOUT（现 15s）整批挂起。

## 现状

- 桌面（macOS/Windows）：sidecar 独立进程 + stdio JSON-RPC，与 UI 线程隔离，不受此限。
- 安卓：onethu-harness-core 以静态库内嵌（harness_embed.rs），功能可用但性能未达标；0.8.0 起 ChatDock（宿主 UI）在安卓默认不挂载，harness 保留但不自动启动。

## 移动端修复方向（待办）

1. 桥改长轮询批量泵（harness_bridge_poll 一次取走全部待处理调用，JS 并发执行后批量回执），消灭每调用一次事件往返；
2. 高频只读命名空间（learn/xk catalog）在 Rust 侧做原生 facade 直连（reqwest+会话），跳过 webview 中转；
3. BRIDGE_TIMEOUT 保持 15s 自愈；facade 任何异常必须双路兜底回执（rust.ts 已实现）。

## 附带教训

- gen/android 不入库：手工修改会静默进入后续所有构建（本次 hardwareAccelerated="false" 调试残留曾致全线软件渲染卡顿）。改前先 grep 核对。
- 荣耀/EMUI 冻结器会冻结前台 app 的 webview 渲染进程，iAware 判定"无响应"直接杀进程。移动端卡死排查先看 am_kill/freezer 日志，再怀疑代码。
