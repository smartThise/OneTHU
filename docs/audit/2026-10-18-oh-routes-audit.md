# OH / OneFlow / OnePage / OH MCP 路由与操作审计（2026-10-18）


> 归档说明：本文记录 2026-10-18 针对 OH、OneFlow、OnePage 与 OH MCP 的路由及操作审计与修复情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

本轮对四个子系统进行了全面只读排查，并当场修复已确认的缺漏（审计基线 `13a71c52`）。

## 一、结论

- 共梳理出 **44 项缺口**（OH 23 项、OnePage/OneFlow 21 项），按 P0/P1/P2 优先级归类。
- 本轮已修复：OH P0 1 项、OH P1 11 项、OnePage/OneFlow P0 1 项、P1 10 项，以及绝大部分改动直接的 P2 项。
- 新增自动化回归：`tools/oh-route-onepage-browser-test.mjs`（24 条断言）、MCP 入方向 Rust 单元测试 3 条，并同步对齐路由资产 60 行。
- 全量 guard 检查中其余模块（Plugins/Courses/AttachActionsSheet/ExtHw/Notify）既有的 8 处历史 UI 文案待办保持不变，留待文案专项统一清理。

## 二、OH：路由与操作

### 已修复

| 问题 | 根因 | 修法 |
|---|---|---|
| OH 搜索窗/命令面板点 OH 设置行落到「插件」页 | `goSearchRow` 已切到 OH 入口，消费方随后又 `openSettings("plugins")` 覆盖 | 删掉两处后置入口覆盖；入口只由 `goSearchRow` 决定 |
| 高级档 OH 行首次进入停在基础档、`ui_navigate` 假成功 | `requestOhTier` 请求早于组件挂载，`subscribeOhTier` 挂载时不取 pending | 挂载时先 `takeTier()` 再订阅 |
| 首页态 navigate `learn-*` 子页/详情页静默回首页 | `KNOWN_PAGES` 只收一级页，`openTab` 对未知页回首页 | 子页/详情页并入 `KNOWN_PAGES`，抽出 `isKnownPage` 供门面共用 |
| `ext_tab` 白名单与 `openTab` 白名单矛盾、today 残留 | 两处手写白名单 | 统一走 `isKnownPage`；today 全链路别名为 homepage |
| navigate / open_page 对失败假报成功 | `nav.go` 返回 void、`openAtom` 恒 true | 两者返回真实布尔值，Rust 按结果回话 |
| 壁纸、动态壁纸声音、玻璃程度、标签栏样式、系统取色没有检索行 | 新控件未注册 | 补 5 行 + 壁纸/声音锚点 |
| 「搜索与胶囊」分节泄漏到所有设置页签 | 页签显隐按 SectionHead 精确匹配，OneGUI Section textContent 含 hint | 显隐改最长前缀匹配；补胶囊默认动作/最近搜索记录两行 |
| 极客模式无 SectionHead、无归属、无检索行 | 区块直接挂在桌面小组件卡后 | 加 SectionHead「极客模式」+ 页签映射 + 两行检索 |
| `workspace_write op=collapse` 实际关闭成员标签并删定义 | 调了 `workspaceClose` | 新增 `ext.workspaceCollapse`（只折叠）；Rust collapse 改调它 |
| `ext_workspace_delete` 只有 handler 没有 ToolDef | 漏注册 | 补 ToolDef（confirm:true） |
| OneFlow 步骤契约与执行器不符 | steps 示例用 harness 工具名、执行器只传单对象 | 执行器支持数组位置参数；文档/工具描述改 `ns.method` + 数组示例 |
| OneFlow app-start / notice 永不触发，hw/grades 每次刷新空转 | onStart 空实现、无 notice 监听、事件无条件双发 | 调度器启动跑一次 app-start；learn 数据按快照差发 hw/notice；成绩按报告签名变化发 grades |
| OnePage/OneFlow/白板等无检索/打开路径 | PAGE_ATOMS 缺一级页 | 补首页/THUBook/在线服务/待办/服务/收藏/所有 OnePage/OnePage 等页面原子 |
| 条件行「小组件槽位」桌面端无落点 | 未声明 visible/landOn | 加 `visible` + `fallbackNote` |
| 安装/管理主题行只高亮不动作 | 行无 go | 补 `go` 切插件市场/我的插件 + 主题筛选 |
| 插件市场搜索/分类无行，我的插件/市场行恒切 mine | 未注册/go 写死 | 补两行；切换行按当前视图取反 |
| `ext_wallpaper` 工具描述含 tab 档、`ext_voice` 含 neural、`ext_prefs` 含 voiceTarget | 工具说明超出当前已实现范围 | 描述对齐到现有真实能力；prefs 移除废弃字段写入 |
| `mcp_status` 开关路径写成「设置 → 插件 → …」 | 入口层级已改 | 改为「设置浮层 → OneTHU Harness 段 → 高级配置」 |

### 后续待办记录

- board 标签与 `boardId` 独立实例绑定：同时打开多块板目前仍共用「当前板」，工作区快照里的 board 标签在恢复时也指向当前激活板。修复需要扩展 `ExplorerTab.params` 类型与实例键，留待专门批次推进。
- OH 对白板组件的细粒度控制：目前以 portrait 预设切换为主，后续可继续补充 resize、pin、fold、opacity 与 custom props 操作。
- 定时与事件流程的步骤白名单：当前复用插件权限门拦截，后续可为自动流程补充独立的高敏门面方法白名单。

## 三、OnePage：数据安全与操作

### 已修复

| 问题 | 修法 |
|---|---|
| **P0：所有白板页拿挂载时快照整份 saveBoard，会覆盖其他入口新建/改名的板** | 改为 `mutateBoards`（读最新 doc → 改 → 存 → 广播），并订阅 `onethu.boards.changed` |
| OnePage 图标全应用无写入入口 | `FolderIconPicker` 改为操作 BoardDoc；列表页/OneGO 行菜单接入；OH 增 `onePage_write op=icon` + `ext.onePageSetIcon` |
| 改名只能去 OH | 列表页与 OneGO 行菜单加「重命名…」 |
| `onePage_place op=move` 只改 cell、rect 不动 → 视觉无变化且假成功 | 同时写 `rect: rectFromCell(cell)`；显式 found 判断，找不到板/件抛错 |
| `onePage_collect` 文档写 `kind:key` 实际存 `kind|key` → 永久失效入口 | facade 归一化首个 `:` 为 `|` 并校验；工具描述/示例统一为 `kind|key` |
| `onePage_write op=delete` 高危无确认、忽略失败结果 | 未确认时返回 `ConfirmNeeded`；按 `{ok:false,reason}` 如实回话 |
| 新建 OnePage 不打开、列表页无法换图标/改名/排序 | 列表页/OneGO 补齐菜单；新建后设为当前并打开 |
| OnePage 列表标签文案残留「今日页」 | 改为「当前 OnePage / 系统板」；新建按钮改「新建 OnePage」 |
| OnePage 标签的标题/图标改完不刷新 | TabStrip 订阅 `onethu.boards.changed` 重算 |

## 四、OneFlow：从可见到可执行

- 支持直接手动运行：由 harness 通过 `registerFlowExecutor` 注册执行器，在 OneGO 行点击即可直接调用 `runFlowNow`，并通过 toast 实时提示执行结果或错误信息。
- 完善状态与错误可见性：`UserFlow` 新增 `enabled` 与 `lastError` 字段，界面提供启用/停用开关及失败原因展示；OH 同步新增 `ext_flow_update`、`flowSetEnabled`，并在 `ext_flow_list` 中返回 `enabled` 与 `lastError`。
- 优化调度器触发时机：cron 基于持久化的 `lastRun` 初始化，重启后按正常周期等待下次执行；`app-start` 在每次应用启动时触发一次；`hw`、`notice`、`grades` 仅在对应数据发生实质变化时触发。
- 严谨处理流程删除：界面层增加二次确认，门面层校验目标 ID 存在性，Rust 侧按真实校验结果返回删除状态。
- 校验流程创建参数：门面层确保 `trigger` 与 `steps` 非空并返回 `{id}`，由 Rust 侧回显新建流程的真实 ID。
- 兼容多种参数格式：执行器同时支持数组位置参数（`args:["schedule"]`）与单对象参数，平滑兼容旧版步骤结构。

## 五、OH MCP：入方向协议修复

- **P0：统一入方向 MCP server 响应信封**：`initialize` 与 `tools/list` 现统一返回完整的 `{jsonrpc:"2.0",id,result|error}` 结构，确保标准 MCP 客户端正常完成握手。
- `notifications/*` 遵循单向通知语义：返回无响应体的 HTTP 202 状态码。
- `OPTIONS` 预检请求返回 HTTP 204 及 `Access-Control-Allow-Methods` 响应头，支持网页端 MCP 客户端直接接入。
- 新增 3 条 Rust 单元测试：覆盖响应信封结构、通知空响应与未知方法报错，以及需确认工具的拦截逻辑。
- 出方向配置防重：`parse_servers` 按名称自动去重，UI 表单同步拦截空名称与重名配置，避免 `mcp_<name>_` 工具前缀冲突。
- 新增检索行「连接外部 MCP 服务器」（`oh-mcp-client`），并在高级档设置中提供稳定跳转锚点。

## 六、验证

| 项 | 结果 |
|---|---|
| `node tools/oh-route-onepage-browser-test.mjs` | 24/24 |
| `node tools/usability-browser-test.mjs` | 52/52 |
| `node tools/theme-home-browser-test.mjs` | 80/80 |
| `cargo test -p onethu-harness-core --lib` | 30/30 |
| `node tools/oh-routes-sync-test.mjs` | asset 60 行 = 注册表 60 行 |
| `node tools/search-landing-test.mjs` / `settings-search-coverage-test.mjs` | 60/60 家族一致、标题别名自查通过 |
| desktop typecheck / build / guard:onegui / docs-prose-lint | 通过 |
| harness sidecar | `build:harness` 重新构建并放入 resources（4.3 MB） |

## 七、后续（已排队）

下一阶段功能规划（组织 / 万物暂存箱 / 分享口令 / 个人与组织名片 / NFC 碰一碰 / 通讯录 / 清华云盘深度集成）已整理存档于 `docs/plans/2026-10-18-organization-vault-share.md`，待本轮缺陷修复收尾后按计划启动。
