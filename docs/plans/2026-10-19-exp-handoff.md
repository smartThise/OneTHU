# exp 分支交接报告（2026-10-19 收尾）


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 面向下一位接手协作的智能体。仓库路径 `/Volumes/PortableSSD/Projects/thuapp/OneTHU`，当前分支 **exp**，
> 远端 `github` 对应 `smartThise/OneTHU`，本地开发服务器常驻 `http://127.0.0.1:5180`。

## 当前状态

本轮已完成并提交「实用模式（第三种使用模式）」「课表页快捷栏折叠与上下拖动」「简洁壳层收起云同步与寻迹入口」「通讯录直接粘贴接收个人及组织名片并归入名片夹」「硬刷新悬浮钮自动避让与自由拖动」以及「`pnpm guard` 存量旧断言全面对齐」；浏览器自动化回归已完成核心套件验证并全部绿灯通过。

## 本会话提交

| commit | 内容 |
| --- | --- |
| `91e67e1a` | 实用模式（含设置三选一、导览三课、独立存档）+ 课表 OneShot 收起/拖动/过渡动效 + 作业详情课程行 + 简洁壳层隐藏云同步与寻迹 + 手机课表底栏净空 + 硬刷新钮自动避让与拖动 |
| `b78d52f2` | 通讯录直接接收名片 + 16 个 guard 脚本旧断言对齐（`pnpm guard` 全绿），并修复设置分节映射问题 |
| `a64f22e4` | 名片夹支持组织名片 + 将接收名片入口整合为单枚按钮，精简工具条 |
| `3cabc79b` | 组织名片并入同一个名片夹牌堆展示，保持与个人及好友名片一致的翻阅体验 |
| `8876c229` | 暂存箱回归脚本同步对齐统一收发接口与新锚点结构（42 条断言全绿） |

**推送提示**：`b78d52f2` 及更早提交已推送至远端 `exp`；若 `a64f22e4`、`3cabc79b`、`8876c229` 尚未推送，接手后可先执行 `git push github exp`。

## 已完成并可验收的功能点

### 1. 实用模式（`practical`）
- `state/experienceMode.ts`：支持 `full | simple | practical` 三种模式，新增 `isSimpleLike()` 供极简模式与实用模式共用清爽壳层。
- OneShot 快捷栏：第五格固定为 `MORE_FEATURES_SLOT="more"`，左侧四格支持自由配置（`state/quickAccess.ts`，独立存储于 `onethu.oneshot.practical.v1`）；打开「更多功能」面板按功能目录分组浏览，点击「+」后自动收起面板并点亮底栏槽位编号，轻点目标槽位即可完成替换。
- 设置页新增「使用模式」三选一切换；首启导览升级为三模式向导（存储键 `onethu.onboarded.flow4`，向下兼容 `flow3` 与 `phone` 旧标记，`resetActiveOnboarding()` 同步清理 `flow4`）。

### 2. 课表页（`is-schedule-page`）
- 进入课表页时 OneShot 默认收拢为一枚轻巧的「快捷」按钮，悬浮于「日程设置」上方，采用 `grid-template-rows: 0fr / 1fr` 平滑展开收起；按住可沿右侧上下拖动并持久记住位置（`onethu.quickbar.schedule-offset.v1`）。
- 手机端课表底部补充安全净空（`packages/gui/src/recipes/schedule.css`），确保晚间最后一节课完整露出、避开底栏遮挡。
- 作业详情页补齐「所属课程 / 截止时间」信息行（打通网络学堂作业 `courseId → courses` 课程名映射）。

### 3. 简洁壳层收口
- 简洁壳层下，日程设置精简为「刷新」动作（自动隐藏云同步与系统日历相关按钮和说明），新建日程默认保存在本地；课程详情页隐去「寻迹」页签，`compactPageAllowed()` 同步在全局搜索、OH 历史与实用模式功能面板中共用同一份页面白名单；服务原子中日程项的副标题同步去掉「·云同步」后缀。

### 4. 通讯录
- 名片夹顶部工具条收敛为一颗「接收名片」按钮，点开后提供粘贴口令、识别二维码图片与从暂存箱导入三种方式。
- 用户创建的组织名片统一归入**同一个 `.contact-deck` 名片牌堆**（按「我的名片 → 组织 → 好友」顺序排列），共用 `OrgCardDetailModal` 执行放入暂存箱、复制加入方式、管理组织与删除操作。

### 5. 硬刷新悬浮按钮
- 自动寻位避让：默认从右下角起步，实时检测并避开 OneShot、日程设置、白板工具栏、暂存箱、回到顶层按钮与底栏（优先向上避让，空间紧凑时自动左移），并在窗口缩放或切换标签页时动态重算。
- 支持按住自由拖动并按设备持久记忆坐标（`onethu.ui.refreshFab.v1`），「回到顶层」按钮自动跟随叠放在其上方。

### 6. 护栏对齐（`guard`）
- 全量 `pnpm guard`（含 `typecheck`）恢复全绿：16 个护栏脚本中面向旧版 DOM 的断言已更新为校验现行 OneGUI 实现（`.og-*` 类名、标准弹层/开关/进度条、`flow4` 新导览与新版首页锚点），已下线的历史组件（`.plg-*`、`.bottom-nav`、旧侧栏、`Today.tsx`、V3 导览）旧断言已完成清理并备注替代组件。

## 测试状态

```bash
pnpm guard                                              # ✅ 全绿
node tools/experience-browser-test.mjs                  # ✅ 实用模式全链路
node tools/schedule-timeline-browser-test.mjs           # ✅ 18
node tools/short-share-browser-test.mjs                 # ✅ 49
node tools/vault-browser-test.mjs                       # ✅ 42
node tools/namecard-browser-test.mjs                    # ✅ 14
node tools/org-browser-test.mjs                         # ✅ 11
node tools/mobile-vault-browser-test.mjs                # ✅ 14
node tools/feedback-repairs-browser-test.mjs            # ✅（含手机硬刷新钮不压白板工具）
```

待补充复跑的套件（本轮尚未逐一执行）：`tools/feedback-round2-browser-test.mjs`、`tools/short-code-test.mjs`、`tools/platform-test.mjs`、`tools/board-*`、`tools/viewer-*` 等。

## 接手实现备忘

1. **OneShot 课表态 DOM 结构**：`.oneshot.is-schedule > (.oneshot-slots-wrap > .oneshot-slots) + .oneshot-schedule-toggle`；拖拽手柄为外层 `.oneshot-schedule-drag` 的 `span` 容器，**点击切换事件需绑定在该 `span` 上**（指针捕获会将点击目标收束至 `span`，确保轻点稳定响应）。
2. **模式存档隔离**：实用模式快捷栏独立读写 `onethu.oneshot.practical.v1`；课表快捷按钮偏移量使用键名 `onethu.quickbar.schedule-offset.v1`（键名避开 `oneshot` 子串，与 `experience` 测试中的完整模式存档快照校验保持正交）。
3. **统一接收流转**：入口统一调用 `useVaultReceive().paste() / scan()` → `contentExchange.receivePastedCode`（自动识别个人名片、组织邀请、组合串与暂存箱口令）；接收暂存箱内容时统一**新建独立暂存箱**保存，完整保留用户当前正在编辑的暂存箱。
4. **短口令与模拟云盘**：`vaultShare.shareCodeForBox` 会优先复用未过期的短码，`decodeShareAsync` 遇到短码时交由 `cloudExchange.resolveExchangeCode` 解析；编写测试模拟适配器时需走通完整的模拟云盘链路 `write_temp_file → seafile_upload → seafile_share(expireDays > 0)`（注意 `expireDays` 传正整数，传 `0` 在该测试桩中会被判为立即过期）。
5. **模拟云盘测试桩用法**：引入 `tools/lib/fake-cloud.mjs` 时，请在 `page.goto` 之前调用 `installFakeCloud(page, { token })`；页面内动态加载模块可通过 `performance.getEntriesByType('resource')` 定位带 HMR 参数的 URL，并预先调用 `setResourceTimingBufferSize(10000)`。
6. **核心保护约束**：OJ 作业评测相关逻辑保持严密隔离；切换使用模式时完整保留完整模式下的用户存档数据；涉及 UI 改动请先在本地预览窗口截图核验细节（本轮截图存档于 `docs/onegui/experience-mode/`）。

## 建议下一步

1. 执行 `git push github exp` 同步最新提交。
2. 补跑上方列出的其余浏览器回归脚本，确认全绿后将更新的截图与报告一并归档提交。
3. 邀请用户实测验收：课表页「快捷」按钮的拖动位置与展开动效、手机端课表底部净空、通讯录名片牌堆排布顺序及接收名片面板文案。
4. 后续可扩展方向：在「我的组织」页面同步接入组织口令粘贴入口，并在首页空状态卡片中提供快捷「接收名片」引导。
