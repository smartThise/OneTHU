# OneTHU Campus Gateway

OneTHU 本机校园代理（开发于 `web` 分支），运行在现有的 OneTHU SDK / daemon 进程内，直接复用当前已登录的学校账号，为受支持的浏览器与经过验证的本机客户端提供校园访问。

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

上述命令直接连接本机已有的后台服务并复用其账号运行时。当前安装与配置目录对应的根证书（CA）、私钥及代理凭据均存放在设备私有目录中；运行 `status` 仅返回网关状态摘要，自动隐去学校 Cookie、票据与代理口令。可选的独立校园浏览器与系统级代理入口各自独立管理。

## 请求边界

- 监听地址仅绑定本机 loopback，并依次校验 HTTP/CONNECT、Host/SNI、请求来源、HTTP 方法、报文分帧、体积上限与会话 epoch。
- 已登记的校园业务通过受控 TLS 门面与 SDK 会话转发，由适配器统一处理直连与 WebVPN 的 Cookie 作用域、地址与 CSP 改写以及流式响应。
- 普通浏览器访问学校身份认证站点时走透明转发，保留学校原始 TLS 握手与默认网络出口。
- 经过签名验证的腾讯微信进程访问已登记校园服务时，走受限的官方票据桥接链路（清小搭与行在清华临时来访报备已在 Mac 端完成实测验证）；其余未命中规则的身份请求保持客户端自带的独立 Cookie。
- 内部管理接口 `gateway.control`、主窗口出票与系统证书信任仅对本机受控通道开放，与公开 MCP 服务目录相互隔离。

macOS 端通过组合 PAC 按网络服务保留原有的 HTTP/HTTPS/SOCKS 代理与 bypass 列表；Windows 端采用 CurrentUser 级代理配置并记录归属标记。若系统已配置第三方自定义 PAC/WPAD、带认证代理或其他复杂规则，网关会保持原有系统配置不变并在状态页提示兼容限制。关闭系统接入时会先比对当前系统设置，保留其他软件在此期间写入的新改动；Clash 等代理软件的节点、订阅、规则与令牌仍由原软件自行维护。

私有 endpoint hints 用于记录当前监听端口与 PAC URL，方便宿主在重启后直接沿用原有地址；遇到端口占用冲突时网关会安全报错退出，保持占用该端口的其他进程正常运行。

网关开启状态按学校账号保存在本机。后台重启或同一账号重新登录后，系统会自动恢复此前开启的网关与系统代理接入，并继续沿用原端口与 PAC URL；手动停止网关或撤销信任则会清除自动恢复标记。在 macOS 上切换手动代理、修改代理地址端口或关闭代理时，网关会自动同步更新上游转发路径，保持校园连接与 PAC 地址稳定，并在停止网关时还原至最新的系统代理设置。若检测到外部 PAC、自动代理发现或带认证代理，状态页会一并给出兼容性说明。

## 平台与验收

| 平台 | 当前实现/证据 |
| --- | --- |
| macOS | 系统接入、原代理共存、Info/Learn 与两项微信业务实测 |
| Windows | CurrentUser/PAC、TCP SID、腾讯签名及模拟验证；本轮真机验收待完成 |
| Android/iOS | 全设备原生传输桥待实现 |
| LAN / 跨设备配对 | 尚未开放 |

2026-11-01 的 [受信客户端验收](../../docs/reviews/2026-11-01-trusted-client-campus-gateway.md)记录了真实票据流转与业务页面验证结果；[首轮原型](../../docs/reviews/2026-10-31-campus-gateway-prototype.md)、[系统接入](../../docs/reviews/2026-10-31-system-browser-gateway.md)与[网络恢复](../../docs/reviews/2026-11-01-network-webdav-recovery.md)归档了各阶段的开发与验证记录。

## 开发

```sh
pnpm test:gateway
pnpm --filter @onethu/sdk test
```

主要模块：`src/index.mjs`（协议处理）、`policy.mjs`（目标与来源策略）、`manager.mjs`（生命周期管理）、`platform.mjs`（系统代理状态）、`clientIdentity.mjs` / `trustedClient.mjs`（微信进程校验与票据边界）、`endpointHints.mjs`（端口与地址保持）。SDK 适配与 GUI 续接的源码入口详见架构文档。
