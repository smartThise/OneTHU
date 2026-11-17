# 导航、传输、通讯录、日程 · 收尾记录（2026-10-18）


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../../README.md)（[English overview](../../en/index.md)）。


接手 `5ef7618b` 留档分支的阶段性改动，对照用户提出的 8 条验收清单完成收尾。本目录归档本轮验收结果与界面截图。

## 这一轮改了什么

### 1. 暂存箱雷达重做（用户反馈：旧版雷达视觉粗糙）
旧版形态为空白圆盘（[before-radar-ugly.png](before-radar-ugly.png)），缺少刻度与光束，条目随圆圈旋转导致文字倾斜，空箱时仅悬浮两个按钮。新版改为**半圆刻度环**，包含环带、刻度与两道扫描光束；箱内条目沿弧线缓慢摆动且文字始终保持水平正向；中心区域展示件数与箱名，空箱提示「长按任意内容，拖进来」。单击直接浏览，长按拖动进入投递 HUD（雷达自动展开、箱体放大、OH 胶囊呼吸闪烁并浮现「发给小OH」跟随提示）。

### 2. 完全展开改成下弹抽屉（按需留在本页浏览）
新增 `VaultSheet`：支持查看清单、逐项移除、打开条目及「在标签页打开」。雷达页脚的「打开展示柜」与各条目均接入该抽屉；深链与全局搜索依然可直达完整页面。

### 3. 手机顶栏精简与居中
移除顶栏 `::after` 伪元素生成的 "OneTHU" 品牌字样，将暂存箱入口绝对居中，左侧放置首页、右侧放置「我的」。

### 4. 长按拖动与投递修复
此前长按后拖动会被浏览器原生 HTML5 拖拽打断（触发 `pointercancel`），导致松手无法落入暂存箱；现已在拾取瞬间拦截 `dragstart`。实测长按 0.4s 后雷达自动展开，拖至箱体即可入库、拖至 OH 胶囊即可发给小OH，中途取消则干净退出；触屏合成指针事件同样验证通过。

### 5. OneGO 收藏栏 + OneShot
收藏栏位于 OH 下一栏，集成深色 OneGO! 入口、OnePage/工作区书签、空间不足时的**实心小三角**溢出菜单，支持右键编辑、拖拽排序与长按传输。OneShot 四枚独立胶囊（网络学堂/日程/待办/生活）补齐注册了「待办」与「生活」两个一级入口，配置项移至「外观」，手机端 FAB 与白板工具栏主动避让，内容页底部同步留出滚动余量。

### 6. 通讯录成为一级功能 + 拟物名片
`page=contacts` 提供完整页面（页头、搜索、收藏星标、全部·好友·组织分段、星标筛选、名片夹与我的组织）；采用拟物纸质名片设计，还原 1.586 真实卡面比例、纸纹、金属芯片、压印姓名、THU 钢印、首字防伪水印与多层纸叠阴影；桌面端多列微倾排布、手机端单列叠压，点击通过组件库 Modal 弹出大卡详情。原有的放入暂存箱、共享云盘、留言/传文件与组织邀请口令全部保留。**「我的」四栏**（我的名片/个人设置/插件/Harness）保持原有结构，`profile` 栏直接复用同一套大卡组件。

### 7. 清华云盘邮箱自动识别
`resolveCloudEmail()` 按优先级依次读取：名片已存邮箱 → 云盘账号（`seafile_account.email`）→ 校园 info 邮箱 → 已配置 CalDAV，获取到真实邮箱后直接展示并自动回写至名片一次，全页面彻底清理了旧版「登录后获取」占位文案（已纳入浏览器测试断言）。

### 8. 日程改为铺满式周时间表
桌面、手机与横屏统一采用 7 列周视图时间轴；精简掉大标题与顶部按钮条，仅在右下角保留一枚常驻悬浮圆钮，点开浮层即可操作周切换、视图切换、显示时段、同步导出、新建与收藏；时间表铺满内容区，表头吸顶并在容器内独立滚动。作业详情中的「前往」打开新作业标签，课程详情中的「前往」与「寻迹」均开启新标签。同轮一并修复了 OneGUI `useFloating` 的首次展开定位相位问题（此前影响 Schedule 与 GitLab 浮层）。

### 9. 扫码与碰一碰状态反馈
`ExchangeFeedback` 由真实的 `pending/success/error` 状态驱动，呈现雷达波扩散、名片悬浮与完成大对勾（统一改用组件库 `IconCheck`），开启系统减少动态效果时自动切换为静态降级展示。

## 验证

- `pnpm --filter @onethu/desktop typecheck` ✓、`pnpm --filter @onethu/desktop build` ✓、`node tools/onegui-guard.mjs` ✓（R2 258≤265 / R3 315≤317 / R4 235≤243，棘轮稳步下降）。
- 浏览器验收（真实鼠标与触屏事件）：
  - `tools/navigation-rebuild-browser-test.mjs` — **22** 项（长按拾取、雷达展开、真实落库、溢出菜单、我的四栏、通讯录路由、390/320 顶栏与快捷胶囊互不遮挡、无运行时错误）。
  - `tools/contacts-browser-test.mjs` — **52** 项（卡面比例、弹层、搜索、筛选、星标、邮箱自动识别、深浅主题、动效降级、三档宽度无溢出）。
  - `tools/schedule-timeline-browser-test.mjs` — **18** 项（周列排布、精简大标题、画布铺满、课块展示、详情前往/寻迹开新标签、三档视口无横向溢出）。
- 全量 `pnpm guard`：本轮清空了全部 14 处文案护栏待修项（14→0）并修复 1 处白板长按正则回归，`icon-test` 与 `pc-layout-test` 对齐新设计口径后通过，`visit-client-test` 由红转绿；其余未通过项均为接手基线（`70995a68`）既有待修项（详见下表）。

| 护栏项 | 基线 70995a68 | 现在 |
|---|---|---|
| ui-copy-lint | 14 处违规 | **0** |
| board-drag-test | 通过 | 通过（曾因白板长按改动回归，已修） |
| icon-test | 通过 | 通过（ExchangeFeedback 手写 SVG 已换成 IconCheck） |
| pc-layout-test | 通过 | 通过（课表护栏改钉周视图口径） |
| nav-shell-test | 3 处 | 3 处（既有） |
| dynamic-flow / theme-system / explorer-canvas / tabstrip-layout / modal-shell / theme-picker / settings-ia / help-coach / onboarding-v3 / widget-coverage / button-variants / card-layers / input-system / empty-state / theme-ia / density / controls / list-row | 红 | 红（既有，未触碰） |

## 截图

[旧雷达（改造前）](before-radar-ugly.png) · [雷达·浏览](radar-browse.png) · [雷达·投递](radar-transfer.png) · [暂存箱抽屉（桌面）](vault-sheet-desktop.png) · [暂存箱抽屉（手机）](vault-sheet-phone.png) · [手机顶栏](phone-topbar.png) · [OneGO 收藏栏](onego-bar.png) · [暂存箱页](vault-page.png) · [通讯录（桌面）](contacts-desktop.png) · [通讯录（手机）](contacts-phone.png) · [名片大卡](contacts-detail.png) · [我的名片·桌面](my-card-desktop.png) · [我的名片·手机](my-card-phone.png) · [我的组织](contacts-orgs.png) · [日程（桌面）](schedule-desktop.png) · [日程（手机）](schedule-phone.png) · [日程（横屏）](schedule-landscape.png)
