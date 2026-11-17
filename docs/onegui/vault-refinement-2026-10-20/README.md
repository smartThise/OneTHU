# 暂存箱体验重做验收 · 2026-10-20


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../../README.md)（[English overview](../../en/index.md)）。


本轮覆盖共享管理面板与标签页、可移动贴边入口、预览雷达、收发口令及已发口令管理。全部验收均通过真实浏览器的点击、键盘与触摸事件驱动，在保留既有功能回归覆盖的同时，补齐了新版交互的专项断言。

## 浏览器回归

| 命令 | 结果 | 主要范围 |
| --- | --- | --- |
| `node tools/vault-workspace-browser-test.mjs` | 136 项，进程自然 exit 0 | 1280×860、390×844、320×568、844×390；入口、面板、标签页、焦点、文件与文字预览 |
| `node tools/vault-browser-test.mjs` | 50 项，进程自然 exit 0 | 原暂存箱收纳、分享、接收、名片组合、权限与拖入回归 |
| `node tools/mobile-vault-browser-test.mjs` | 14 项，进程自然 exit 0 | 手机贴边入口、组合分享、名片及组织入口 |
| `node tools/short-share-browser-test.mjs` | 52 项，进程自然 exit 0 | 分享预览、显式生成与复制、短码兼容、匿名接收、过期与撤销 |

上述脚本均在浏览器正常关闭并完成资源清理后退出（Chrome 测试实例开启 `--disable-updater-scheduler` 并隔离 HMR，按顺序执行清理）；四个脚本的 `node --check` 与工作区 `git diff --check` 均已通过。

结构化验收数据见 [workspace-report.json](workspace-report.json)，短口令套件的截图与报告位于 [short-share-codes](../short-share-codes/report.json)，完整运行日志保存在 `/tmp/onethu-vault-workspace-final.log` 与 `/tmp/onethu-vault-regressions-final.log`。

## 本轮实际验收的行为

- 桌面端鼠标拖动入口、移动端长按拖动入口后自动保存贴靠的左右边缘与相对高度，刷新后准确恢复；手机端从贴边入口向屏内短滑即可唤起完整管理面板，而常规页面边缘滑动互不干扰。
- 预览雷达直接挂载至 `body`，清晰展示最近三条不同内容的标题；「整理」按钮可准确点击且与 OneShot 胶囊保持安全间距；点击关闭或按下 `Escape` 均将键盘焦点归还至常驻贴边入口。
- 管理面板与独立标签页共用同一套状态与内容：新建箱子、切换箱子、搜索过滤、清空搜索及通过更多菜单移除条目均通过真实控件完成验证（手机端校验原生下拉选择框当前值，桌面端校验标题与侧栏选中态）。
- 接收子弹层内支持 `Tab` 与 `Shift+Tab` 循环切换焦点，按下 `Escape` 仅逐层关闭最顶层弹窗；退出条目菜单后焦点回到对应条目，关闭管理面板后焦点回到贴边入口。
- 按下 `Enter` 打开长文本条目预览，校验超过 90 字后的完整尾部文本，按下 `Escape` 关闭预览并留在管理面板；桌面端点击拖入的真实文件时，管理面板平滑退出并打开独立文件预览展示完整字节内容，按 `Escape` 可正常关闭。
- 单次冒泡的文件 `drop` 事件仅执行一次哈希指纹计算与入库，并准确落入目标暂存箱（测试直接断言底层哈希函数调用次数，确保无隐式重复计算）。
- 发起分享时先展示内容预览，显式点击生成按钮后才创建短码，再点击复制按钮将完整口令写入剪贴板；已发口令列表继续完整支持复制、更多管理、重命名、指定邮箱访问与撤销操作。
- 四档视口下均验证管理面板完整位于屏幕边界内、独立标签页零横向溢出、页面零运行时异常。

## 截图索引

管理面板主截图均在滚动容器复位至顶部、临时提示条收起后采集；两档短屏视口额外采集了滚至底部的截图，展示长列表与「已发口令」入口的滚动可达性。采集时统一关闭过渡动画以获取清晰的稳态画面。

| 尺寸 | 预览雷达 | 管理面板顶部 | 条目菜单 | 完整标签页 | 管理面板底部 |
| --- | --- | --- | --- | --- | --- |
| 1280×860 | [预览](radar-1280x860.png) | [顶部](manager-1280x860.png) | [菜单](item-menu-1280x860.png) | [标签页](page-1280x860.png) | — |
| 390×844 | [预览](radar-390x844.png) | [顶部](manager-390x844.png) | [菜单](item-menu-390x844.png) | [标签页](page-390x844.png) | — |
| 320×568 | [预览](radar-320x568.png) | [顶部](manager-320x568.png) | [菜单](item-menu-320x568.png) | [标签页](page-320x568.png) | [底部](manager-bottom-320x568.png) |
| 844×390 | [预览](radar-844x390.png) | [顶部](manager-844x390.png) | [菜单](item-menu-844x390.png) | [标签页](page-844x390.png) | [底部](manager-bottom-844x390.png) |

已逐张人工核验最新的 320×568、844×390 顶部与底部截图及 1280×860、390×844 主截图，确认顶栏选择框、标题与操作区排布完整，底部长内容可顺畅滚动查看。

横屏走查时发现首版页头纵向占空偏高，随即收紧了短屏下的标题与内边距，并以 `ONETHU_TEST_SIZES=844x390 node tools/vault-workspace-browser-test.mjs` 复跑全部 33 项横屏断言（正常 exit 0）：新版横屏顶部截图中第一条文件已完整露出、第二条标题也进入首屏，底部截图确认三条记录及「已发口令」入口均可顺畅滚达。该次复跑结果另存为 [landscape-compact-report.json](landscape-compact-report.json)，同时将横屏最新检查项与几何数据同步合入四尺寸完整报告（共 136 条记录）。

## 并行专项结果

同轮并行执行的其他专项测试结果如下（具体覆盖范围详见对应测试脚本）：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `tools/vault-anchor-browser-test.mjs` | 33 项 | [edge-results.json](edge-results.json)；触屏横屏、避障、默认复位、返回和设备位置隔离 |
| `tools/vault-vertical-rail-browser-test.mjs` | 17 项，自然 exit 0 | [vertical-rail-report.json](vertical-rail-report.json)；固定与悬停展开的竖标签栏，保存左侧偏好时临时避让且不覆盖偏好 |
| `tools/vault-exchange-ui-test.mjs` | 36 项，自然 exit 0 | 含已删箱的口令管理、命名/确认/输入子弹层的返回、Tab/Shift+Tab/Escape 与 Promise 结算 |
| `tools/nav-stack-test.mjs` / `tools/mobile-nav-test.mjs` | 15 / 4 项 | 嵌套覆盖层返回栈 |
| `tools/private-share-browser-test.mjs` | 43 项 | `/tmp/onethu-vault-private-regression.log` |
| `pnpm guard` / `pnpm guard:onegui` | exit 0 | `/tmp/onethu-vault-guard-complete.log`、`/tmp/onethu-vault-onegui-final-state.log` |
| 桌面类型检查 / 生产构建 | exit 0 | `/tmp/onethu-vault-typecheck-final-state.log`、`/tmp/onethu-vault-build-final-state.log` |

贴边入口专项截图：[手机](edge-phone390.png)、[触屏横屏](edge-landscape.png)、[暗色入口](edge-dark-phone390.png)、[玻璃入口](edge-glass-phone390.png)、[暗色面板](manager-dark-phone390.png)、[玻璃面板](manager-glass-phone390.png)。

桌面竖向标签栏避让截图见 [悬停展开与贴边入口](edge-vertical-rail.png)：当鼠标悬停将竖栏展开至 232px 时，贴边入口与预览雷达自动向右避让，整理按钮保持可点，关闭面板后焦点准确归还至入口。

## 测试环境说明

上述自动化套件基于本机无头 Chrome 与本地模拟云盘夹具运行：手机端拖动与边缘轻滑通过 CDP 可信触摸事件触发，桌面端文件拖入通过浏览器 DOM `DataTransfer` 模拟；Workspace 套件中的 844×390 采用桌面非触屏横屏配置，贴边入口专项则额外覆盖了移动触屏上下文旋转至 844×390 横屏的场景。

移动真机触控手感、操作系统级文件管理器拖入与原生文件选择、NFC 硬件互传以及生产环境云盘连通性，留待 Android 与桌面实机环境联调确认。

## 截图审阅与存量静态脚本核对

已完成桌面、390 手机、320 窄屏、844 横屏以及暗色与玻璃主题截图的人工走查。针对首轮截图中横屏页头偏高的问题收紧间距后，复查确认首屏即可完整显示第一条内容，短屏底部区域也可顺畅滚动到达。合入最后一处横屏 CSS 调整后，CSS 结构检查、OneGUI 护栏与桌面生产构建均在原有基线阈值下再次通过。

在将确认弹窗统一迁移到共享确认框组件时，已同步更新三个旧静态检查脚本中的组件断言；仓库中另外三项历史静态脚本仍维持基线状态（未做删改或放宽），核对记录如下：

| 脚本 | 仍失败的检查 | 基线核验 |
| --- | --- | --- |
| `tools/motion-test.mjs` | 347 行课表动画结构 | 独立 HEAD 副本同一首个失败 |
| `tools/hw-ignore-test.mjs` | 63 行首页作业过滤结构 | 独立 HEAD 副本同一首个失败 |
| `tools/session-img-prompt-test.mjs` | 132 行附件登录墙结构 | HEAD 原脚本先在 91 行旧 `</button>` 字面断言失败；独立对 HEAD 的 FilePreview 执行 132 行断言亦失败 |

上述对比基于 `git archive 4921a9c1d50248449e1b9da28c4b145dbfafb927` 导出的基线源码与原脚本独立验证，所涉及的 `FilePreview`、`boardCards` 与 `Schedule` 文件与基线逐字节一致，留待对应模块迭代时同步更新脚本断言。
