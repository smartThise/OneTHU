# 0.11.4-fix-1 修复记录


## 反馈与判断

用户反馈原 0.11.4 Windows 登录报 `CLI_DAEMON_START_FAILED`，MatePad Pro 首页无当天课程，平板设置操作不畅，手机课程空态占用过大高度。已读取 Downloads 中最新照片和 5.4 秒视频；证据保存在忽略的输出目录，真实用户资料不进入仓库。

这些问题可以用有边界的修复处理。本次保留 xiao-dreamr 的界面更新、独立 CLI / SDK、OH 工具和常驻任务。

## 认证与常驻后台

此前修复已经处理 Windows PowerShell 5.1 文件 ACL 调用、后台恢复等待网络、GUI 重复导入旧 Cookie 等问题。本次继续解除 GUI 学校登录对后台可用性的硬依赖。

只有后台启动失败、超时、未运行等明确可用性错误允许进入本机登录／恢复分支。CLI 正在二次验证、账号不一致、会话证明失败仍保留原错误及隔离边界。本机已有会话经过一致性读取及学校只读探测后恢复。

成功登录可保存未绑定后台 epoch 的延迟移交意图。后台恢复后，仅同一账号或未退出的全新后台可以绑定；不同账号、退出墓碑、正在进行的二次验证均拒绝移交。绑定后的写入继续接受账号、epoch 和本机恢复代次检查。常驻任务仍由同一个 CLI 调度。

原生启动流程识别子进程提前退出，减少无效等待。错误详情只提取有限长度的结构化大写错误码；原始 stderr 写入权限受控的本机文件。子进程持有文件句柄，App 关闭后后台继续运行。

## 课程与触屏界面

首页原来从 Learn 聚合缓存读取课表，一级课表读取失败会落成空数组，二级课表也没有进入该分支。今日课程先请求 `info.getSchedule(day, day)` 获取一级课程，再以校历 firstDay 调用 `appendSecondarySchedule` 合并真实二级页面。该合并函数与课表页相同；校历或二级读取失败显示重试。白板卡片和简化模式共用这个组件；加载、读取失败、成功空结果分别展示。聚合缓存中的课表也改用相同来源。

平板实用设置曾命中桌面三栏 `overflow:hidden` 规则，却没有三栏内的滚动体。简单设置现在使用独立滚动体，保留完整设置的三栏结构。

手机阅读布局为桌面高度增加显示上限，今日课程上限 280 CSS px；投影不写入白板数据。自由画布保留原尺寸、摆位和编辑操作。触屏编辑继续要求显式开启。

## 版本与发布约定

实际应用、CLI、SDK 版本统一为 `0.11.4-fix-1`，Android versionCode 为 `11014`。新版本比较按基础版本、fix 编号排序。

原 0.11.4 更新器仅比较三段数字，因此本次官方清单使用 `version: 0.11.5` 作为兼容发现编号，另附 `displayVersion: 0.11.4-fix-1`。新客户端先解析实际版本，避免重复提醒；安装包、GitHub tag 和官网都使用实际名称。发布工具与云盘目录选择器已支持 hotfix 文件名。

## 验证范围

- SDK 199 项、CLI 77 项、私有会话移交 16 项、登录状态 67 项。
- Rust 后台模块 8 项，包括启动诊断隐私和 hotfix 排序；原生编译检查。
- 实际打包 Node / CLI 在全新私有目录启动、读取空会话、优雅退出。此检查也进入 Windows/macOS 发布流水线。
- 类型检查、7665 个词典键完整性、生产前端构建、二级课表与白板拟合回归。
- 浏览器触摸模拟覆盖手机与平板横竖屏下的设置滚动及首页今日课程各状态；Windows 和 MatePad 真机表现待安装正式包后实机复核。

## 最终构建与发布

- 应用冻结源码：`ec2b8b341aeeeba0bcb3e0870399211f02785dc9`，tag `v0.11.4-fix-1`。
- macOS：[Actions 40474318962](https://github.com/smartThise/OneTHU/actions/runs/40474318962) 的 macOS job 成功。
- Windows：[Actions 40474318962](https://github.com/smartThise/OneTHU/actions/runs/40474318962) 成功。使用 NSIS EXE，产物附带实际 checkout 源码证明。发布前 Windows MSI 命名与首页二级接线核查触发过两轮构建；已修正并重新冻结为上述最终源码，旧验证包未公开。
- Android：本地 ARM64 正式签名，versionCode `11014`，证书 SHA-256 `cc14d735667bb8b5d3134e7dfdccf6a4d9353e1a2fce54503f4a29705423aa97`，15 个 Logo 像素与自适应绑定通过核验，当前前端及壁纸原生命令已嵌入。
- macOS 主程序、Harness、Node 为 ARM64；Windows 主程序、Harness、Node 为 x64。包内 CLI 版本、所有运行时文件摘要、开发面板排除均通过。
- CLI/SDK 独立归档离线验证通过；SDK 的严格 NodeNext 消费者检查通过。
- 触屏编辑浏览器检查的 22 个交互断言全部通过，收尾阶段因浏览器关闭耗时超出清理时限导致进程非零退出，已单独记录；其余手机课程高度与设置触摸检查全部完成。

Windows MSI 对非数字预发布标记的限制在构建日志中得到确认；NSIS 对该标记的数字资源回退见 [Tauri 官方实现](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs)。

[GitHub Release](https://github.com/smartThise/OneTHU/releases/tag/v0.11.4-fix-1) 与清华云盘沿用既有系统目录。安装包摘要如下；另提供独立 CLI、SDK、校验文件和更新清单。

| 平台 | 字节数 | SHA-256 |
| --- | ---: | --- |
| macos | 61625244 | `e60a9ff6ab4c7a612ebe69d9c6c9f359a44a2a5b19756c6e9553fa1a6fa86295` |
| windows | 54408250 | `197946c6007a2c00dc9cc08504516ef799bcdc0789061abf68171ba8fbd4ad00` |
| android | 32293749 | `85777cdec9b68b99bf162c1985c30db8a837d56518656bc3c1c3b22ee5c60a37` |

[最终公开产物证明](../releases/0.11.4-fix-1.json)。

三端清华云盘系统目录已匿名完整下载，字节数与 SHA-256 均和 GitHub 资产、两源清单一致。生产 updater 的实际两源读取、GitHub 失败回退，以及原版发现 fix／已安装 fix 不重复提醒均通过。
