# 作业区：聚合、忽略与提交

> 最后更新：2026-09-22 22:56

作业数据来自网络学堂与外部作业源（雨课堂 / TUOJ / Tyche / DSA OJ），在「全部作业」与
「今日」两处统一呈现。外部源的接入方式、凭据维护与故障恢复见
[external-homework.md](./external-homework.md)。

本文档说明作业区的交互能力：分组与忽略、网络学堂的附件上传与必交附件预检、雨课堂
主观题原生作答与提交，以及由此确定的学术红线。

## 1. 分组与数据来源

| 来源 | 说明 |
|---|---|
| 网络学堂 | 课程作业；读方法见 [api-reference.md §9](./api-reference.md) |
| 外部作业源 | 雨课堂 / TUOJ（AI 版与经典版）/ Tyche / DSA OJ，统一映射为 `ExternalHomework`，以 `ext:` 前缀并入 |

作业页分为六个分组：进行中、已逾期、已交、已批、已忽略、全部。**旁听课堂**（雨课堂
`role=6`）的作业不计入各分组计数，也不计入「全部」，而是在当前分组下方单列「旁听作业」
一节；首页作业区不混入旁听作业。逾期判定为「未提交且
截止时间已过」，时间解析统一由 core 的 `parseLearnTime` 完成（兼容外部源的
`"YYYY-MM-DD HH:mm"` 与 ISO 串），解析失败不判逾期，作业留在「进行中」。

「今日」页的截止卡片与作业页读取同一份数据；首页小组件与通知投递计划同样基于该数据，
因此三处的过滤口径一致。

## 2. 忽略（R21c）

语义：忽略后的作业不再出现在作业区与日程提醒中，也不再推送截止提醒、不计入小组件
计数；**数据源未被修改**，可在「已忽略」分组恢复。

| 项 | 说明 |
|---|---|
| 适用范围 | 任何状态的作业（进行中 / 已逾期 / 已交 / 已批）均可忽略；网络学堂与外部作业源统一适用 |
| 入口 | 作业行常驻「忽略 / 恢复」按钮，不随提醒开关变化；忽略需二次确认，确认框说明错过截止的后果与恢复入口 |
| 呈现 | 已忽略的行灰显并带「已忽略」标记，仅列出在「已忽略」分组，其余分组与「全部」不再显示 |
| 存储 | 本机 `onethu.hw.ignored.v1`，条目为 `{id, title, at}`，上限 500 条 |
| 键设计 | 单一键：网络学堂 `xszyid` 全局唯一，外部源 id 已带 `ext:` 前缀，提醒计划使用同一 id；由此「列表过滤」与「提醒过滤」依据同一份事实 |
| 同步范围 | 作业页分组与计数、网络学堂未交计数、日程 DDL、首页小组件、通知投递计划 |

实现见 `apps/desktop/src/state/hwIgnore.ts`（只读写 localStorage，经
`useSyncExternalStore` 广播，多处列表同时生效），测试 `tools/hw-ignore-test.mjs`。

## 3. 网络学堂：附件与提交

### 3.1 附件上传与拍照

提交内容与附件至少需提供一项。Android 端提供「拍照上传」，以 `capture="environment"`
直接调用后置相机；桌面端使用文件选择。端别判定采用多信号（`isAndroidNavigator`），
不使用裸 UA 字符串——主窗口 UA 为伪装值，裸 UA 判定恒为 false（见
[android-release-traps.md §3](./android-release-traps.md)）。

### 3.2 必交附件预检（R21c）

网络学堂对要求必交附件的作业，在无附件提交时返回
`{"result":"error","msg":"请上传附件"}`。网络学堂的作业 JSON 中不存在可靠的「需要附件」
标志位，因此该拒绝即权威判定，应用据此在本机记忆并在后续提交前拦截：

| 环节 | 行为 |
|---|---|
| 服务端拒绝 | 记录该作业（`markNeedFile`，存储 `onethu.learn.needFile.v1`，上限 200 条） |
| 本地预检 | 无附件提交时不再发出请求，直接提示「本作业要求必须带附件：请选择文件或拍照上传后再提交」 |
| 提交成功 | 带附件提交成功后清除记录（`clearNeedFile`）——教师可能已调整要求，以最新一次成功为准 |
| 撤回附件 | 网络学堂不允许只删不传；该路径失败时提示改为选择新附件提交替换 |

实现见 `apps/desktop/src/state/learnAttachmentReq.ts` 与
`apps/desktop/src/pages/learn/AssignmentDetailPage.tsx`；测试
`tools/learn-need-file-test.mjs`、`tools/learn-camera-upload-test.mjs`。

### 3.4 通知的已读状态（R23）

网络学堂的已读状态只有服务端字段 `sfyd`（拉列表时读取），客户端此前不主动置读：无附件的
通知无法置读，有附件的通知要等下一次拉列表才在界面反映，于是出现「点开过仍是未读」。现在：

| 环节 | 行为 |
|---|---|
| 打开详情 | 立即写入本地已读（`onethu.learn.noticeRead.v1`），列表与未读分组即时反映，跨会话保留 |
| 服务端同步 | 详情页总是请求 `beforeViewXs`，服务端据此置读，并同时发现附件 |
| 合并规则 | 本地记录与服务端 `sfyd` 取并集，服务端已读不会被本地状态回退 |

护栏：`tools/notice-read-test.mjs`。

### 3.3 请求体序列化

网络学堂专线的请求体统一经 `apps/desktop/src/lib/bodySerialize.ts` 序列化，该模块为
唯一真源，两个 fetch 包装（nativeFetch / tauriFetch）都必须调用。历史故障：网络学堂
专线全部请求走 nativeFetch，而 FormData 处理只存在于 tauriFetch，导致提交请求体被写成
字面量 `"[object FormData]"` 且缺少 multipart 的 `Content-Type`，服务端返回 400
「Required String parameter 'xszyid' is not present」。测试
`tools/learn-submit-body-test.mjs`。

## 4. 雨课堂主观题原生作答（R20-C2）

主观题在应用内撰写与提交，不跳转官方页面。编辑器工具栏与官方对齐：加粗、斜体、下划线、
前后景色、有序与无序列表、代码块、插图与公式。

| 能力 | 实现要点 |
|---|---|
| 插图 | 四个通道：工具栏选图 / 拍照（`capture="environment"`）/ 粘贴 / 拖拽；均经官方正文插图通道（`get_aliyun_oss_token` 表单直传），判卷侧读取正文图片。**插图必须带 `referrerpolicy="no-referrer"`**：CDN 的 Referer 白名单不放行应用来源（`tauri.localhost` 返回 403），上传成功但渲染破损；插入、粘贴、受控值重渲染、草稿回填与提交态均须统一加固（复用 `yktBody.hardenYktImgs`） |
| 公式 | LaTeX 输入并以内置 KaTeX 实时预览；编辑器内为 `img.kfformula`，提交时由 `toSubmitHtml()` 转为官方形态（1px gif 的 `src` 与 `data-latex` 并存），并包裹 `<div class="custom_ueditor_cn_body">` |
| 草稿 | 按「课堂 + 题目」持久化在 localStorage，提交成功后清除；再次进入以服务端 `my_answer` 回填 |
| 提交 | 用户显式点击「提交」并经确认对话框（展示剩余次数与覆盖语义）后调用 `submitYktSubjective`；按钮文案为「提交作答」或「提交（剩余 N 次）」 |
| 状态回读 | 提交成功后重新拉取真实状态，不做乐观更新 |
| 剩余次数 | 依据 `late_submission` 判定；该字段存在对象（含 `deduct_score`）与数字两种形态，按双口径容错解析，不下单一结论 |

实现见 `apps/desktop/src/components/exthw/YktSubjectiveEditor.tsx`、
`apps/desktop/src/state/exthw.ts` 与 `packages/core/src/exthw/yuketang.ts`。方案、接口
探测与实测记录见
[外部作业源-需求与实现方案.md §31](./外部作业源-需求与实现方案.md)；测试
`tools/ykt-submit-test.mjs`。

## 5. 学术红线

作业能力仅限「用户亲笔作答的便捷提交接口」：应用只承担内容排版渲染、图片上传与把用户
已确认内容发出的三个机械动作。

**不做**：

1. AI（内置 OH 助手、任何 agent 或 LLM 工具链）生成、改写、润色或补全作业答案内容；
2. AI 触发提交、自动提交、批量提交、定时提交与失败自动重交；
3. 「一键完成作业」类入口；
4. 从任何非用户输入源（题库、网络、他人答案）抓取答案内容填入作答框。

**工程护栏**（可测试，非约定）：

- 提交 API（`submitYktProblemSubjective` 等）不注册进插件宿主的可调用工具清单，LLM
  工具循环无法触及提交能力；`tools/c2-redline-test.mjs` 断言插件工具清单中不含
  任何 `submit*` 或 `problem_apply` 字样；
- 提交按钮必须经用户确认对话框，无代码路径可绕过用户点击直达提交（表单回车、定时器、
  事件代理均不得触发）；
- 编辑器不提供「生成 / 补全 / 续写」型按钮，OH 助手面板与作答编辑器互不引用。

外部作业源的展示层仍为只读，试卷不显示任何提交入口，判定与限制见
[external-homework.md §3.1](./external-homework.md)。

## 6. 测试工具

| 工具 | 覆盖范围 |
|---|---|
| `tools/hw-ignore-test.mjs` | 忽略状态：增删、上限、坏数据、订阅一致性 |
| `tools/audited-hw-test.mjs` | 旁听作业单列：不计入计数与「全部」、不与正式课程混排 |
| `tools/notice-read-test.mjs` | 通知已读：本地覆盖、与服务端并集、不误判未读 |
| `tools/learn-need-file-test.mjs` | 必交附件记忆：记录、清除、上限 |
| `tools/learn-camera-upload-test.mjs` | 拍照上传入口的端别分流 |
| `tools/learn-submit-body-test.mjs` | 请求体序列化（FormData → multipart） |
| `tools/ykt-submit-test.mjs` | 雨课堂主观题提交：签名、multipart 顺序、callback 校验 |
| `tools/c2-redline-test.mjs` | 学术红线护栏 |
