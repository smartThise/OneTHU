# OneTHU Campus Gateway

本机校园代理，由已有 OneTHU SDK / daemon 持有，开发于 `web` 分支。复用当前学校账号，为受支持的浏览器与受验证客户端提供校园访问。

现行说明：[Gateway 架构](../../docs/architecture/gateway.md) · [系统总览](../../docs/architecture.md) · [跨平台配置与限制](../../docs/guides/campus-gateway-mobile.md)。

## 接入与恢复

```sh
onethu gateway status
# 更改本机监听、信任与系统设置分别确认
onethu gateway start --confirm
onethu gateway trust --confirm
onethu gateway system-enable --confirm
# 恢复原代理设置
onethu gateway system-disable --confirm
```

这些命令连接已存在的本机后台，不为网关另建账号运行时。安装/profile 的 CA、私钥和代理凭据保存在设备私有目录。状态查询不暴露学校 Cookie、票据或代理口令。可选独立校园浏览器与系统代理入口分别管理。

## 请求边界

- 监听仅绑定 loopback；HTTP/CONNECT、Host/SNI、来源、方法、framing、大小和 epoch 逐层检查。
- 已登记业务经受控 TLS 门面和 SDK 会话访问。直连/WebVPN Cookie 作用域、地址/CSP 改写与流式响应由适配器处理。
- 普通浏览器的身份站连接透明转发，保留学校 TLS 与原出口。
- 受验证腾讯微信进程的已登记学校服务使用受限官方票据桥。清小搭和行在清华临时来访报备已有 Mac 用户确认；未匹配身份交易保留客户端独立 Cookie。
- 私有 `gateway.control`、主窗口出票与系统信任均不加入公开 MCP 服务目录。

Mac 组合 PAC 按网络服务保留原 HTTP/HTTPS/SOCKS 和 bypass；Windows 使用 CurrentUser 配置与对应归因。已有任意 PAC/WPAD、额外认证或无法安全解析的代理配置保持原样并报告限制。恢复时比较当前设置，保留其他程序后来的修改。Clash 的节点、订阅、规则和令牌由原软件管理。

私有 endpoint hints 保留监听端口和 PAC URL，减少宿主缓存旧端口的问题。占用冲突安全失败，不终止其他进程。

## 平台与验收

| 平台 | 当前实现/证据 |
| --- | --- |
| macOS | 系统接入、原代理共存、Info/Learn 与两项微信业务实测 |
| Windows | CurrentUser/PAC、TCP SID、腾讯签名及模拟验证；本轮真机验收待完成 |
| Android/iOS | 全设备原生传输桥待实现 |
| LAN / 跨设备配对 | 尚未开放 |

2026-11-01 的 [受信客户端验收](../../docs/reviews/2026-11-01-trusted-client-campus-gateway.md)记录真实票据与业务页结果。[首轮原型](../../docs/reviews/2026-10-31-campus-gateway-prototype.md)、[系统接入](../../docs/reviews/2026-10-31-system-browser-gateway.md)和[网络恢复](../../docs/reviews/2026-11-01-network-webdav-recovery.md)保留对应阶段证据。

## 开发

```sh
pnpm test:gateway
pnpm --filter @onethu/sdk test
```

主要实现：`src/index.mjs`（协议）、`policy.mjs`（目标/来源）、`manager.mjs`（生命周期）、`platform.mjs`（系统状态）、`clientIdentity.mjs` / `trustedClient.mjs`（微信边界）、`endpointHints.mjs`（地址连续性）。SDK 适配和 GUI 续接的源码入口见架构章节。
