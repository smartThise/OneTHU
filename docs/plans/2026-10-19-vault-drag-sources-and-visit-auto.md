# 暂存箱长按来源大补 + 文件自动缓存 + 日程可选入日程 + OH 自动报备（2026-10-19）


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

本轮围绕暂存箱拖入体验与来访报备自动化集中补齐能力，用户原话反馈如下：
- 「手机上怎么长按拖动没有雷达弹出」；
- 「补充几个基础的应该被拖动放到暂存箱的东西：任意一个日程（时间块）；云盘里的任意一个文件夹和文件；
  课程里面通知、作业里任意具体的附件；新闻里的文件附件；任意一个 gitlab 项目；任意一个在标签页栏的
  标签页与工作区」；
- 「文件拖进去就是自动缓存到暂存箱云盘了（可能比较复杂的下载再上传），日程则是可以选择是否
  添加到自己的日程」；
- 「预约报备那里是不是不对劲，怎么还要我手动点击！这玩意应该是自动的，且 OH 能操作的！」

## 暂存箱长按来源

新增 `lib/vaultCatch.ts`，统一构造 `data-vault-catch` 拖拽载荷：

| 来源 | 文件 | 拖入后的行为 |
| --- | --- | --- |
| 日程（周时间块/列表） | `Schedule.tsx` / `ScheduleAgenda.tsx` | 存快照；点开时问「添加到我的日程？」 |
| 云盘文件 | `CloudPage.tsx` | **自动下载 → 缓存进暂存箱云盘** |
| 云盘文件夹 | `CloudPage.tsx` | 保留资料库引用，点开落云盘 |
| GitLab 项目 | `GitLabPage.tsx` | 点开落 project（gitlabProject 深链） |
| 课程通知附件 / 作业附件 | `NoticeDetailPage.tsx` / `AssignmentDetailPage.tsx` | 自动下载缓存 |
| 新闻附件 | `NewsTab.tsx` | 自动下载缓存 |
| 桌面标签页 | `TabStrip.tsx` | 点开回到该页 |
| 工作区 | `TabDrawer.tsx` / `OneGoSheet.tsx` | 点开恢复工作区 |

- OneGUI 的 `Row` 与 `Card` 组件现已支持透传 `data-*` 属性（通过 `kit.tsx` 的 `pickDataAttrs`），解决了此前自定义数据属性在组件封装层丢失的问题。
- 手机端长按手势将触摸容差 `longPressSlop` 放宽至 14px，避免手指轻微晃动触发滚动取消；同时在长按期间屏蔽 Android 原生 contextmenu，防止系统「复制/全选」菜单中断指针事件。

## 文件自动缓存

`lib/vaultRemote.ts` 串联起文件下载与暂存箱云盘缓存链路：

1. 云盘文件调用 `seafile_download` 拉取，课程与新闻附件调用 `downloadLearnUrl` 下载；
2. 通过 `read_file_base64` 读取文件字节并用 `crypto.subtle` 计算 SHA-256，随后经 `state/vault.updateVaultItem` 回写暂存箱条目元数据（含 size/mime/hash/stagedPath）；
3. `state/vaultCloud.cacheVaultFiles()` 将带有 `stagedPath` 的条目上传至 OneTHU 资料库 `/Vault/cache` 目录，并回写 `cloudPath`；
4. 若当前未连接云盘或处于纯浏览器预览环境，则保留原始引用并提示「已加入暂存箱；缓存失败…」，确保条目内容始终稳妥留存。

## 日程拖入后可加入我的日程

`vaultCatchSchedule` 附带 `startMs/endMs` 时间信息（列表视图取自条目时间，周视图时间块取自对应日期）；在 `vaultRegistry` 中点开日程快照时会调用 `offerScheduleToCalendar()`，弹出 `confirmChoice("添加到我的日程？" / [添加到日程] [先留在暂存箱])` 供用户选择。确认添加后调用 `putLocalEvent` 写入本地日程（缺省时段为 09:00–10:00，支持后续编辑）。

## 来访报备自动 + OH 可操作

- `state/visitDraft.ts`：`requestVisitDraft(patch, { submit?: boolean })` 新增 `pendingSubmit` 状态与 `peekVisitAutoSubmit()` 读取接口；
- `VisitTab`：消费草稿时若带有 `submit` 标记，会自动勾选确认项并置位 `autoSubmit`，待页面模型就绪后直接执行 `submit()` 提交，无需手动补点（未传 `submit` 时默认仅填充草稿，方便人工核对）；
- `facade.visit.fill(patch, { submit: true })` 完整透传自动提交参数；
- Rust Harness 新增 **`visit_fill`** 工具（位于 `plugins/OneTHU-Harness/core/src/tools.rs`），默认填充草稿，传入 `submit: true` 时委托 `visit.fill` 完成自动提交；子模块已完成构建并推送（`OneTHU-Harness` `f7eb971`）。

## 测试

- 新增浏览器回归 `tools/vault-catch-browser-test.mjs` 共 6 条用例，覆盖云盘、文件与标签页的 `data-vault-catch` 挂载、CDP 触摸长按呼出雷达、拖入暂存箱计数递增以及运行期零报错；
- 扩展静态守卫，核验全部来源文件的 `data-vault-catch` 声明、registry 各 kind 注册、文件缓存链路、日程弹窗二选一逻辑，以及 visitDraft/facade/VisitTab/Rust `visit_fill` 接线；
- `pnpm guard` 全量通过。
