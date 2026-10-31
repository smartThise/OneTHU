# Mac 浏览器与 WebDAV 网络恢复（2026-11-01）

## 当前状态

校园系统代理已重新启用，`recoveryRequired=false`。使用原 OneTHU dev 窗口和原共享账号，没有重新登录、清空数据或卸载 WebDAV。现有 CA 与各网络服务的原代理回退保持不变。

本次完整构建并安装的后台为：

```text
6c4966f138e46e9e69e23345916c6ee6320bca3691d4446c1660dfb4074d6d7f
```

安装位置为 `/Users/st/.local/share/onethu-cli`，共享 profile 为 `/Users/st/Library/Application Support/OneTHU CLI`。daemon 返回的 runtime ID 与安装清单一致；账号仍 authenticated / ready，epoch 保持 19。原 GUI PID 67363 保持运行。

本记录更新 [微信接入事故报告](2026-11-01-wechat-mini-program-rea-completion.md) 的网络状态与恢复建议。没有继续执行 REA、修改微信或推进新的微信身份共享边界。

## 故障与修正

### 1. 源码中的修复没有完整部署到运行包

接手时系统 PAC 已被前一 agent 关闭，HTTP / HTTPS / SOCKS 恢复为原 Clash `127.0.0.1:7897`。因此校园借用会话功能当时也处于关闭状态。

运行包是 `4218d310cc0f32b9a196a55c94e3e415dd8e95d43433f94f5e4c229dce558845`。检查保留的代码备份确认，它没有 `lsofFatalStderr`、启用前预检或非阻塞 lsof 参数。源码提交中已有的挂载告警兼容，没有全部进入实际运行包。

本次通过 `apps/desktop/scripts/build-cli-runtime.mjs` 完整生成 runtime，校验清单 buildId、所有文件摘要与 Node 摘要后暂存、原子替换代码并重启同一个后台。保留上一份代码备份，profile 和 GUI 未替换。没有发布安装包或推送远端分支。

### 2. TCP 鉴权不应依赖远端文件系统的 stat

旧同 UID 检查运行 lsof 时，可能对已挂载的 WebDAV / NFS 调用 stat、readlink 等操作。事故记录包含挂载不可达时的 lsof WARNING；旧部署包又把非空 stderr 当成失败，从而让校园新 CONNECT 集体返回 503。

保留 `7554b8af` 的挂载告警兼容，并增加 `-b -w`：

- `-b` 按当前系统 lsof 手册避免可能阻塞的 lstat / readlink / stat。
- `-w` 抑制这种模式下预期的文件系统告警。
- 子进程失败、超时、未知 stderr、截断或歧义的 TCP 记录继续拒绝。
- 仍验证完整 TCP 客户端方向、端口、连接状态和 UID；未改为只信任进程名或请求头。

在真实挂载保持存在时，本机 TCP 实测：原参数在挂载健康时通过；单独 `-b` 会产生多条预期告警；`-b -w` 保留完整 TCP 证明并通过验证。没有通过卸载挂载点解决鉴权。

### 3. 启用系统 PAC 前，实际检查候选监听

过去可以先部署 / 启用 PAC，再发现整个同 UID 路径无法鉴权。现每组候选监听在修改任何网络服务前执行一次真实 loopback 预检。

预检通过候选监听正常的 socket 鉴权，使用仅本实例持有的随机地址返回 204，不访问学校、不返回账号数据、不绕过身份校验。鉴权失败时关闭候选监听与 PAC 服务，保持原网络设置。之后修复原因可以重新尝试启用。

新增回归覆盖失败时零网络设置写入、候选资源清理、成功重试，以及预检不转发学校业务请求。

## 恢复顺序

1. 先核实原代理、WebDAV 挂载和正常外网的状态，保留原配置。
2. 完整构建 / 校验 / 安装后台，保持系统 PAC 关闭。
3. 经独立私有代理实际读取 Info、Learn、Info 日历和待办接口，全部通过后启用系统接入。
4. 新启用前预检在实际部署代码中通过；随后通过系统监听重复验证业务读取。
5. 在普通 Chrome 实际重新加载校园页面，检查课程卡片与课程详情；同时检查原外网出口和 WebDAV 挂载。
6. 对一次 WebDAV 新建 TLS 连接失败做回退与前后对照，最终重新启用并完成连续检查。

## 实际验收

| 项目 | 结果与证明范围 |
| --- | --- |
| 原 Chrome Info 网页 | 重新加载后显示门户栏目和内容，91 个详情链接，正在加载计数为 0，无网关错误或控制台错误。 |
| Info 数据 | 私有监听与系统监听两条路径均实际返回 200；日历 `/b/info/gxfw_fg/common/xl` 和待办 `/b/info/gxfw_fg/common/todo/xtList` 返回 success。未输出防伪 nonce 或业务正文。 |
| Learn 课程页 | 真实 Chrome 显示课程列表；经用户现有 NextTHULearn 界面点击可见课程卡片后，课程详情、待办作业、课程通知和最新文件模块出现。没有提交作业或打开通知正文。 |
| 普通外网 | Chrome 实际打开 Apple 页面，标题及导航正常；经原 Clash 的新 HTTPS 请求返回 200。 |
| WebDAV 挂载 | `/Volumes/dav.stcloud.cc.cd` 保持挂载；在代理启用前后及并发检查后，根目录 stat 与 scandir 均通过。未读取文件内容、写入、删除或卸载卷。 |
| WebDAV HTTPS | 直连与原 Clash 出口均得到服务端 401，证明 TLS / HTTP 服务可达；401 是这类未带凭据 HEAD 的预期结果，不代表已验证 WebDAV 文件权限。开启系统接入后，经原 Clash 连续三次新连接均得到 401。 |
| 实际并发连接 | WebDAV 仍挂载时，16 条并发新 CONNECT + TLS 连接全部通过，同 UID、CA、目标主机和 ALPN 均实际验证，用时约 102 ms；未发送学校业务请求。 |
| 网络共存 | 核实本 runtime 生成的四份 PAC：Ethernet / Wi-Fi 的 DAV 请求继续走原 `127.0.0.1:7897`；USB LAN / Thunderbolt Bridge 沿原 DIRECT。校园站点与 DAV 出口不同。此检查不执行其他软件提供的 PAC。 |
| 会话与进程 | 原 GUI 继续运行；共享账号 ready，epoch 未改变；没有要求用户重新登录。 |

### 对单次 TLS 失败的记录

第一次启用后，一次显式经 Clash 的 DAV HEAD 出现 `SSL_ERROR_SYSCALL`。当时挂载仍可读；为避免冒险，立即关闭系统接入恢复原设置，再分别检查直连和原 Clash。随后重新启用，直连、三次连续 Clash 请求、真实挂载及校园代理均通过。

这一次失败没有复现为稳定的“PAC 开启必失败”，因此没有据此修改 Clash 订阅、规则、DNS、证书或 DAV 服务配置。保留这一观察，不把一次请求成功或失败当成完整归因。

### 验收边界

本轮恢复的是当前 Mac 的浏览器 / WebDAV 共存与校园会话基线；未运行 REA 或验证微信免密接入，未对 Windows / Android 作真机承诺。

期间另见一条 Info GET 向未登记 `zhxxfw.cic.tsinghua.edu.cn` 跳转的 `GATEWAY_SERVICE_UNSUPPORTED`。门户主体与已验证的学习 / 日历 / 待办均正常，控制台无错误；此记录不能等同于全部校园深链接已覆盖。本次没有为消除一条日志而放宽未知服务准入。

## 自动检查与可复用原则

- gateway 138 项通过，包括真实 macOS 同 UID 连接、挂载告警兼容、非 443 透传和失败预检不写系统设置。
- SDK 295 项通过，SDK TypeScript 检查通过。
- 实际安装包清单与运行 ID 已核对，包含非阻塞 lsof、挂载告警兼容、启用前预检及原非 443 透传修复。

部署后需要验证真正运行的 artifact，再进行真实连接检查。源码测试通过或重新计算 runtime.json，均不能单独证明已部署了全部修复。保留现有 WebDAV，使用精确 TCP 证明；遇到启动鉴权失败时保持原出口，避免把系统校园请求切到错误监听。

普通浏览器验收截图仅保存在本机私有可视化目录，没有将真实页面或账号内容提交到仓库。
