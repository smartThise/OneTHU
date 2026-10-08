# MadModel 校外通道验收清单

> 最后更新：2026-10-08 20:38

本文档验收「校园网外使用清华 MadModel 免费档」这条链路：通道判定、统一认证发票、票据兑换、
回环中继转发与失败分类。读者为宿主贡献者；设计背景见 [architecture.md §5](./architecture.md)。

## 1. 前置条件

| 项 | 要求 |
|---|---|
| 应用 | dev 构建（`vite` + `src-tauri/target/debug/onethu.exe`）或安装版 |
| 登录态 | 应用内已完成清华统一认证登录；插件页 → OneTHU Harness 的模型源为 MadModel |
| 网络 | 校园网外（宿舍宽带、手机热点均可）；校园网内复现见 §3 |
| 日志 | Windows 落在启动盘根的 `\tmp\onethu-debug.log`；macOS 为 `/tmp/onethu-debug.log` |

## 2. 验收步骤

| # | 操作 | 期望 | 证据 |
|---|---|---|---|
| 1 | 启动应用，等待约一分钟 | 探针判定校外 | 日志 `[MADMODEL] 可达性探针：HTTP 30x → 校外（IP 门禁）` |
| 2 | 对 OH 提一句简单问题（或插件页点「立即续期」） | 续期成功、通道为 webvpn | 日志 `[MADMODEL] token 已续期（len=…，SSO 票据兑换，通道=webvpn，base=http://127.0.0.1:<端口>/v1）` |
| 3 | 检查通道参数 | 基址为回环地址、会话票为空 | 日志 `[MADMODEL] 校外通道参数已更新：base=http://127.0.0.1:<端口>/v1` |
| 4 | 提一句需要工具的问题（例：明天图书馆哪里有座位） | 流式回答正常 | 日志 `→ LLM 请求 …` 后出现 `← LLM 应答头 HTTP 200`，且请求 URL 为回环基址 |
| 5 | 回到校园网后再对话一次 | 切回直连、中继收掉 | 日志 `[MADMODEL] 可达性探针：HTTP 200 → 校内`，通道参数被清空 |

## 3. 校园网内强制复现校外路径

通道判定读取可达性探针结果（`madmodelReachable`），探针在校园网内恒判可达，故校内复现需
临时改写判定：

1. dev 环境：把 `apps/desktop/src/state/madmodel.ts` 中 `madmodelChannel()` 的首行临时改为
   `return "webvpn";`，保存后 vite 热更新生效（安装版不含该开关，需重新构建）。
2. 重启应用并等待约一分钟：日志出现 `校外通道参数已更新：base=http://127.0.0.1:<端口>/v1`。
3. 端口连通性自检：`Test-NetConnection -ComputerName 127.0.0.1 -Port <端口>` 返回 `True`。
4. 转发自检（无需 token）：向该端口发一次对话请求，返回上游的业务错误码（401/400 等 JSON）
   即为转发成立；连接被拒则说明中继未启动。

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "Content-Type: application/json" \
     -d '{"model":"DeepSeek-V4.1-Flash","messages":[{"role":"user","content":"hi"}]}' \
     "http://127.0.0.1:<端口>/v1/chat/completions"
   ```

5. 验收结束后还原 `madmodelChannel()` 的改写。

## 4. 失败分类

| 日志或现象 | 含义 | 处理 |
|---|---|---|
| `统一认证未给出票据（…）：no-id-credentials` | id 会话失效且无内存凭据 | 应用内重新登录清华账号，勾选「信任此设备」 |
| `兑换被拒（HTTP 200：ticket已过期或无效…）` | 票据被服务端拒绝 | 重试一次（票据单次有效）；反复出现则重新登录 |
| `webvpn 会话已失效：…（校外包装通道）` | 中继转发到包装域被弹回登录页 | 宿主自愈（重签 + 预热会话 + 刷新通道参数）并自动重试一次（见 §5）；仍失败则应用内重新登录一次 |
| 回答报「模型不存在」 | 站点模型改名 | 更新 `plugins/OneTHU-Harness/core/src/madmodel.rs` 的 `MODEL` 常量 |
| 离校时探针仍判校内 | 直连被弹入 webvpn 后终态 200（探针须按 `x-onethu-final-url` 判终点）；或系统代理/VPN 使直连可见 | 关闭代理后重试；仍误判则按 §3 强制通道验证中继，并检查探针日志是否带「被弹入 webvpn」 |
| `Test-NetConnection` 为 `False` | 中继未启动 | 检查日志是否有 `[PLUGIN] 内置 OH` 种入记录，确认 `madmodel_relay_start` 被调用 |

## 5. 已知边界

- 中继仅监听 `127.0.0.1`、随应用进程存在，端口每次启动随机分配；不含鉴权（能力等价于应用自身），
  不用于跨机调用。
- 免费档依赖有效统一认证会话：JWT 有效期 6 小时、续期阈值 5 小时 50 分；票据单次有效，
  每次续期重新发票。
- 通道自愈（设计内建）：进入 webvpn 通道时先**预热**——经应用运输层对包装域发一次 GET，
  让原生 cookie 仓建立/续期 wengine 会话（同一中继不重复预热）；中继启动失败**不写退化基址**
  （留空，由预检给出提示）；通道类失败（`webvpn 会话已失效` 或 `307`）由宿主自愈后**自动重试
  一次**——该失败发生在 LLM 调用之前、未执行任何工具，重试安全。
- 退化路径（直连包装域 + 单张会话票）仅在非 Tauri 环境（单测/浏览器）使用：包装域的 wengine
  会话需要完整 cookie 集（`refresh` / `heartbeat` / `wengine_vpn_ticket` / `show_*`），单张票
  会被弹回登录页，故该路径不用于真机。
- JWT 负载含身份声明（学号、姓名、邮箱），排查记录按凭据处理。

## 6. 实测范围与已知限制

- **实测范围：PC（桌面）形态**。本清单结论均取自桌面端实测；Android/移动形态未验证。
  移动端与桌面共用同一份 Rust 核心与前端组件，但中继依赖 Tauri 命令与原生 cookie 仓，
  需在移动形态单独确认（命令注册与回环监听在当前实现中对各 Tauri 目标一致，仍应实测）。
- **Android/移动形态需单独验收**：中继依赖 Tauri 命令与原生 cookie 仓，命令注册与回环
  监听在当前实现中对各 Tauri 目标一致，但移动端的会话建立路径与后台限制不同，应实测确认。