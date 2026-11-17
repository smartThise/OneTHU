# 校园网关：Windows 与手机接入


更新于 2026-11-01（开发分支 `web`），本文汇总校园网关在桌面与移动端的实现进展及真机验证情况。

## 当前可用范围

| 平台 | 当前实现 | 验收状态 |
| --- | --- | --- |
| macOS | 系统浏览器 PAC 分流、本机 TCP UID 进程归因、微信客户端签名校验、两项已登记的小程序服务桥接、原系统代理比对恢复 | 已完成浏览器、学校接口与 WebDAV 真机实测；清小搭与临时来访报备均经用户实测确认可进入业务页 |
| Windows | CurrentUser 系统 PAC、精确 TCP 客户端 SID 归因、腾讯 Authenticode 签名校验、手动代理与绕过规则合成、写入前指纹核对与安全恢复 | 已通过自动化模拟测试，待开展 Windows 真机联调验收 |
| Android | 设置页清晰展示当前平台支持情况与系统 VPN 说明 | 系统代理与 VPN 原生桥接尚在规划中，暂未支持手机微信校园分流 |
| iOS/iPadOS | 设置页清晰展示当前平台支持情况 | 系统网络扩展与授权流程尚在规划中，暂未支持手机微信校园分流 |

桌面端网关仅在本机回环地址 `127.0.0.1` 上监听，仅供同一台电脑上的应用程序连接（在手机网络设置中填写 `127.0.0.1` 会指向手机自身网卡）；当前版本暂未提供局域网共享代理或跨设备配对功能。

## Mac / Windows 的使用顺序

1. 在已打开的 OneTHU 桌面窗口登录清华统一认证账号，安装并启用本地后台组件。
2. 进入「校园超级代理」设置页，依次启动本地代理、信任本地根证书并开启系统代理。
3. 可点击「续接微信校园登录」预检学校服务出票状态。当微信小程序发起校园认证时，OneTHU 窗口会按需签发对应的短时单次票据，全程仅传递校园服务凭证，与微信个人账号本身相互独立。
4. 在桌面端微信中打开「清小搭」或「行在清华」。若学校要求二次验证，直接在官方页面按提示完成即可；其余未登记的小程序仍保持各自的原生登录与 Cookie 流程。
5. 使用完毕后可点击「恢复原代理设置」；恢复逻辑会比对系统当前配置与 OneTHU 写入时的记录，妥善保留期间其他软件新增的网络设置。

目前已完成登记并验证的小程序桥接包括：清小搭（`www.xiaoda.tsinghua.edu.cn` 及其关联 ITS 服务）与行在清华的临时来访报备模块（`visit.tsinghua.edu.cn`）。行在清华旗下的 `traffic:8443` 维持透明 TLS 转发，而 THOS、校车、停车、车证等独立 H5 页面仍沿用原有的直连转发与学校认证流程，后续将逐项推进验证。

## 与其他代理共存

- **macOS**：按每个网络服务分别备份原有的 HTTP、HTTPS、SOCKS 代理及绕过列表，再生成对应的校园分流 PAC。后台组件重启时会固定沿用原监听端口与 PAC 地址，确保系统宿主连接平滑衔接；若检测到端口占用，会自动中止启用并维持原网络设置不变。
- **Windows**：调用 `WinHttpGetIEProxyConfigForCurrentUser` 读取当前用户的活动代理配置，支持单一手动代理与分协议手动代理，并自动继承原有绕过规则，在写入前再次校验配置指纹。
- **已有自动代理脚本**：当系统已配置其他 PAC 或 WPAD 自动脚本时，为避免分流规则冲突，网关会提示冲突并保持系统原设置不变。
- **上游代理认证**：目前支持串联免认证的本地上游代理端口（带用户名/密码认证的上游代理暂未接入），原代理工具的订阅、节点与凭据均保留在其自身客户端内。
- **流量覆盖范围**：Windows 端接入当前用户的系统级代理；若部分浏览器配置了独立代理、使用了独立 WinHTTP 会话、启用了 QUIC 协议或自带私有网络栈，需单独确认其流量是否经过系统代理。
- **身份域隔离**：普通浏览器访问学校统一认证站点时仍走原有网络出口与学校官方 TLS 证书；只有通过数字签名校验的桌面微信进程才会进入小程序校园桥接，其余小程序继续使用微信自带的 Cookie 存储，与 OneTHU 身份仓严格隔离。

Windows 系统代理读取接口参考：[Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpgetieproxyconfigforcurrentuser)。

## Android 下一阶段的原生桥

根据 Android 系统规范，应用首次启用 VPN 时须经系统弹窗由用户本人授权；同一系统用户或工作空间下同一时刻仅允许运行一个活动 VPN（启动新 VPN 会接替已有连接），且上游套接字需调用 `VpnService.protect()` 防止流量回环。详见 [Android VPN 文档](https://developer.android.com/develop/connectivity/vpn)。

后续移动端方案落地需依次完成以下工作：

1. 使用原生前台服务统一管理启动、停止、常驻通知与异常清理；启动前主动检测当前是否已有运行中的 VPN，并交由用户选择保留原连接或切换至校园网关。
2. 完整实现 TUN 虚拟网卡到 TCP/UDP 的协议栈转发与回环保护（若仅调用 `VpnService.Builder.establish()` 建立接口而未配套转发流量，会导致设备断网）。
3. 通过系统提供的应用 UID 与连接归因接口限定分流范围，并与请求头元数据相互印证，确保仅对受信任的目标客户端分流。
4. 在手机本地独立维护学校账号会话、证书私钥、退出吊销及多账号请求代际隔离，采用 Android 原生网络归因机制（区别于桌面端的进程 UID/SID 查询）。
5. 在真机上验证目标版微信对用户自签根证书的信任策略；若客户端启用了独立证书库或证书固定（Certificate Pinning），则保留系统安全策略并引导走学校官方登录流程。
6. 如需进一步支持由电脑为手机提供跨设备网关，须专门构建加密配对、短时令牌授权、设备随时吊销及局域网防火墙隔离机制，同时保持电脑端凭据服务严格绑定在 `127.0.0.1`。

## iOS / iPadOS 下一阶段

iOS 与 iPadOS 端需基于系统支持的 Wi-Fi 手动代理描述文件、受管理配置或具备相应苹果开发者权限（Entitlement）的 Network Extension 实现，并分别适配根证书安装与信任开关、Wi-Fi 与蜂窝数据切换、目标应用证书策略及退出清理。上述方案留待后续阶段专项设计，现阶段客户端完全遵循系统默认网络路径运行。

## 真机验收清单

**Windows**：依次覆盖无原代理、开启 Clash 本地手动代理、系统已启用 PAC/WPAD、同机其他系统用户进程、微信私有网络栈请求、关闭 OneTHU 主窗口、退出后台服务，以及恢复原代理后的浏览器与 WebDAV 连通性，同时核验底层 TCP SID 归因与数字签名校验日志（除页面返回 HTTP 200 外，一并确认安全归因结果）。

**Android / iOS**：待移动端原生桥接实现后开展真机测试，重点覆盖 Wi-Fi 与蜂窝切换、与已有 VPN 共存提示、网络切换重连、后台常驻与锁屏唤醒、目标应用根证书信任表现、学校二次验证衔接，以及退出账号与吊销设备后的凭据清理。

## OneTHU 的 2FA 设备名称

后续通过 OneTHU 新登记的学校二次验证信任设备，将统一采用 `OneTHU（设备名）` 格式命名：macOS 读取系统电脑名称，Windows 读取计算机名，Android 优先读取系统设备名称（无法读取时回退至设备机型）；独立 CLI 与桌面端共用同一命名格式与本机名称来源。

该名称仅用于直观展示设备来源，本机既有的设备指纹与信任令牌均原样保留，学校端已保存的历史信任设备记录也维持不变；名称读取全程在本地完成，并会自动清洗控制字符、双向文本控制符及超长字符串。若运行在尚未包含系统名称读取接口的旧版原生壳中，前端会自动以「平台名 + 现有指纹短后缀」生成标识，保持原设备指纹稳定。

目前该项改进已完成源码实现及类型与原生编译检查，将在下一次打包安装新版客户端与后台组件后正式生效。

## English

macOS supports browser routing via a system PAC configuration alongside a signature-verified WeChat mini-program bridge. Windows now implements CurrentUser PAC generation, exact TCP/SID client attribution, Tencent Authenticode signature checks, and safe preservation and restoration of existing manual proxy and bypass rules, with on-device Windows testing queued next. Currently registered mini-program bridges cover Qingxiaoda and Xingzai's visitor registration service—both verified end-to-end on macOS—while other standalone Xingzai web modules continue to use their standard campus authentication flows pending individual verification.

System-level gateways for Android and iOS remain on the roadmap, and desktop listeners bind strictly to `127.0.0.1` on the local machine. Supporting Android will require a full native VPN transport layer that coordinates cleanly with any active VPN, while iOS will require a system-supported proxy profile or Network Extension with appropriate entitlements, alongside on-device verification of target-app certificate trust.

Newly registered OneTHU trusted devices for school 2FA will appear under the readable label `OneTHU（device name）`, while preserving existing device fingerprints, trust tokens, and previously registered records on the school server. Full native device-name lookup will take effect with the next packaged app and gateway build.
