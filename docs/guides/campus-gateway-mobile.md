# 校园网关：Windows 与手机接入

更新于 2026-11-01，开发分支 `web`。本页区分代码能力与真实设备验收。

## 当前可用范围

| 平台 | 当前实现 | 验收状态 |
| --- | --- | --- |
| macOS | 原浏览器系统 PAC、本机 TCP UID 归因、微信签名验证、两项已登记的小程序服务桥、原代理比较恢复 | 浏览器、学校接口与 WebDAV 实测；小程序登录待微信恢复登录后验收 |
| Windows | CurrentUser 系统 PAC、精确 TCP 客户端 SID、Authenticode 腾讯签名检查、手动代理与绕过规则合成、写前校验和恢复 | 自动化模拟验证；尚无本次 Windows 真机结果 |
| Android | 设置显示明确的能力与 VPN 限制 | 系统代理/VPN 原生桥尚未实现，不能接管手机微信 |
| iOS/iPadOS | 设置显示明确的能力边界 | 原生桥与系统授权尚未实现，不能接管手机微信 |

本机监听始终绑定 `127.0.0.1`。手机的 `127.0.0.1` 指手机自己，不能填写电脑上显示的这一地址来连接电脑。当前版本没有局域网共享监听或跨设备配对入口。

## Mac / Windows 的使用顺序

1. 在现有 OneTHU 窗口登录学校账号，安装并启用可用的本地后台组件。
2. 进入校园超级代理，启动代理、信任本地证书、启用系统代理。
3. 可使用“续接微信校园登录”检查学校服务出票。小程序实际登录时，由现有窗口转交对应的短时单次票据；不会登录腾讯微信账号。
4. 在微信中打开清小搭或行在清华。学校额外验证仍在官方流程完成；其他小程序保留自身的身份交易，不借用 OneTHU 的 Cookie。
5. 验收完成后可选择“恢复原代理设置”。恢复时比较当前值与本程序写入值，保留其他应用后来的修改。

清小搭桥对应 `www.xiaoda.tsinghua.edu.cn` 与其已登记 ITS 服务；行在清华桥对应临时来访报备 `visit.tsinghua.edu.cn`。行在清华的 `traffic:8443` 保持透明 TLS 转发；THOS、公车、停车、车证等独立 H5 入口保留原有转发和学校认证流程，尚未逐项证明共享登录可用。不能把“临时来访报备可续接”当成整个行在清华的所有服务均完成验收。

## 与其他代理共存

- Mac 按网络服务保存原 HTTP、HTTPS、SOCKS 和 bypass，再生成各自的校园 PAC。
- Windows 通过 `WinHttpGetIEProxyConfigForCurrentUser` 读取当前用户的活动连接配置。支持单一手动代理和按协议区分的手动代理，并保留绕过规则；启用前再次核对计划指纹。
- 已有 PAC / WPAD 不能安全地当成静态手动代理合并，当前会明确拒绝启用并保留原设置。
- 需要上游代理用户名/密码的配置尚未接入。不会收集或更换其他代理软件的订阅、节点或凭据。
- Windows 接入的是当前用户的系统代理。独立 WinHTTP 配置、某些浏览器的独立代理、QUIC、应用自带网络栈都需要分别确认是否实际经过网关。
- 普通浏览器的学校身份站连接仍保留原出口与学校 TLS 证书。受验证的微信进程才进入客户端分流；其余小程序身份交易使用原生客户端自己的 Cookie，不混入 OneTHU 的身份仓。

Windows API 依据：[Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpgetieproxyconfigforcurrentuser)。

## Android 下一阶段的原生桥

Android 官方要求 VPN 在首次使用时取得系统同意。同一用户或工作配置只能有一个活动 VPN，新 VPN 会停止已有 VPN；上游连接必须调用 `VpnService.protect()` 以免回流。见 [Android VPN 文档](https://developer.android.com/develop/connectivity/vpn)。

落地前需完成：

1. 原生前台服务管理启动、停止、通知与异常撤销；显式检测现有 VPN，并让用户选择保留它或切换。
2. TUN 到 TCP/UDP 的完整传输实现与回环保护。只调用 `VpnService.Builder.establish()` 会产生黑洞，不能视为实现完成。
3. 以系统允许的应用 UID / 网络归因来限制客户端；User-Agent、Referer、包名字符串不能替代实际应用身份验证。
4. 手机本地学校账号权威、证书私钥、退出撤销和所有请求的账号代际隔离。桌面的 UID/SID 查询不能搬到 Android 使用。
5. 明确测试微信是否信任用户安装 CA。若目标客户端有独立信任策略或证书固定，应保留系统限制与官方登录流程。
6. 若提供电脑代手机网关，另做受认证的加密配对、短时授权、设备撤销和 LAN 防火墙边界。禁止直接把本机凭据监听改成 `0.0.0.0`。

## iOS / iPadOS 下一阶段

需要选择受系统支持的 Wi-Fi 手动配置、受管理配置或具备对应 entitlement 的 Network Extension。需要分别处理 CA 安装与信任、蜂窝网络和 Wi-Fi 的覆盖差异、目标应用的证书策略以及退出撤销。当前没有部署这些能力，也没有静默接管系统配置的入口。

## 真机验收清单

Windows：无原代理、Clash 手动代理、PAC/WPAD 已启用、另一用户进程、微信自有网络栈、关闭 OneTHU、后台退出、恢复后浏览器与 WebDAV。核对真实 TCP SID 与数字签名结果，不只观察 HTTP 200。

Android / iOS：先完成原生桥再验收。覆盖 Wi-Fi / 蜂窝、已有 VPN、切网、后台存活、锁屏、CA 不被目标应用信任、学校二次验证、退出学校账号与撤销设备。

## English

macOS has a working browser/system-proxy path and a restricted signed-WeChat bridge. Windows now has a CurrentUser PAC, exact TCP/SID attribution, Tencent signature checks, and manual-proxy/bypass preservation; physical Windows acceptance is still required. The registered mini-program flows are Qingxiaoda and Xingzai's visitor service. Other Xingzai web services retain their existing authentication paths and have not all been accepted.

Android and iOS system gateways are not implemented. Desktop listeners remain loopback-only. Android needs a complete native VPN/transport implementation and conflicts with another active VPN; iOS needs a supported system integration and the relevant approvals. Target-app certificate trust must be tested on the actual device. No LAN listener, credential broadcast, or certificate-validation bypass is provided.
