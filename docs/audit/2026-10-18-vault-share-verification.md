# 暂存箱 / 口令 / 组织 / 名片：验证矩阵（2026-10-18）


> 归档说明：本文记录 2026-10-18 暂存箱、分享口令、组织与名片模块的阶段性测试进展；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

本文汇总当时的本机自动化回归结果、真实清华云盘联调记录，以及待真机或双账号环境继续补测的事项清单。

## 自动化回归（本机可复跑）

| 领域 | 命令 | 当前结果 |
|---|---|---|
| 暂存箱全链路（拖拽来源、文件通道、口令、触屏、云适配器 fake） | `node tools/vault-browser-test.mjs` | 39/39 |
| 设置行/OS 文件/主题/插件拖拽来源 | 含在 vault 套件 | ✓ |
| 手机暂存箱/名片/组织布局（390/320） | `node tools/mobile-vault-browser-test.mjs` | 13/13 |
| 名片 | `node tools/namecard-browser-test.mjs` | 7/7 |
| 组织（建/成员/邀请/共享空间） | `node tools/org-browser-test.mjs` | 9/9 |
| 好友通道（本机留言回退） | `node tools/friend-channel-browser-test.mjs` | 6/6 |
| 手势竞技场纯逻辑 | `node --import ./tools/ts-resolve-register.mjs tools/gesture-arena-test.mjs` | 9/9 |
| 分享引用账本 | `node --import ./tools/ts-resolve-register.mjs tools/share-refs-test.mjs` | 8/8 |
| 手机返回键命令/ACL 一致性 | `node tools/mobile-nav-test.mjs` | 4/4 |
| 动效纪律 | `node tools/motion-test.mjs` | 142/142 |
| 云盘路由/检索行 | `node tools/oh-routes-sync-test.mjs` / `search-landing-test.mjs` | ✓ |

## 真实清华云盘 live（需 token，非 CI）

| 项 | 命令/脚本 | 结果 |
|---|---|---|
| API 形状、目录分享、匿名读、撤销、单文件分享 | `SEAFILE_TOKEN=… node tools/cloud-smoke-live.mjs` | 11 步 PASSED |
| Rust 分享读取（目录 dirent_list + 单文件 /f direct） | `TSINGHUA_SEAFILE_TOKEN=… cargo test live_share_read_dir_and_file --lib -- --ignored` | 1 passed |
| App UI：生成云口令 → 第二上下文导入（含 files/）→ UI 撤销 | `SEAFILE_TOKEN=… node tools/cloud-ui-live-test.mjs` | 11/11 |

清华云盘实测要点：
- 目录分享链路畅通，匿名读取返回 `{"dirent_list":[{file_name,is_dir,folder_name,...}]}`。
- 单文件分享生成 `/f/<token>/` 链接（此时请求 `dirents` 会返回 400），需走直链 `/d/<token>/files/?p=/&dl=1` 下载。
- 撤销分享后外部链接立即失效，云端分享目录支持递归删除。

## Android 构建/模拟器（2026-10-18）

- Kotlin 插件与主应用编译通过（`BUILD SUCCESSFUL`），顺利产出 debug APK。
- 模拟器 `onethu-demo` 完成安装与冷启动并进入登录页，按系统返回键正常退出、运行无崩溃。
- 构建与运行手册见 `docs/audit/2026-10-18-android-build-runbook.md`。
- 受限于模拟器的硬件与登录状态，NFC 近场交互、暂存箱及云端界面将在真机登录真实账号后继续验收。

## 待真机与双账号补测项

1. **NFC 真机双机交互**：Android ReaderMode 接收与 HCE NDEF 发送代码已落地；下一步需在两台支持 NFC 的真机上验证 AID 路由、默认应用唤起与分块读取。
2. **双向好友通道**：已接入 `/api2/repos/{id}/dir/shared_items/`（`seafile_share_folder_to_user`），支持在名片中填写云盘邮箱并在共享云盘创建后自动或手动开通读写权限；单账号环境下已验证 owner 自共享拦截路径，**跨账号读写流程需配合第二个真实账号进一步验证**。
3. **相机与截图扫码**：针对无头环境下高密度 ONTOUCH1 截图识别率受限的情况，已补充放大重采样兜底与超时控制，下一步需在真机相机实拍与相册截图场景下复测。
4. **手机全量交互体验**：`mobile_exit` 命令已补齐，下一步需在真机上集中验收拖拽手感、过渡动画、无障碍支持、系统返回键行为及中低端机型性能。
5. **组织多成员真实协作**：成员邀请与云空间链接生成已打通，下一步需使用成员账号实测加入组织、权限分级与 GitLab 组织空间联动。

## 完成口径

待上述 1–5 项全部补齐真机与第二账号实测证据，同时保持本机自动化回归全绿后，即可将本阶段目标标记为完成。
