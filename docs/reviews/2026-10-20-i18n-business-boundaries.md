# 国际化业务边界复核


> 归档说明：本文记录当时的代码审查与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

日期：2026-10-20。本轮复核聚焦文案批量提取后协议状态判断、路由定位、持久化标识与静态文案缓存的准确性，测试全程在本地离线完成，未向学校接口发起请求；英文译文润色与全页面视觉走查由对应专项独立推进。

## 已修复边界

| 位置 | 原风险与修复 |
| --- | --- |
| `pages/info/ThosPage.tsx:60`、待办合并过滤器 | 校方接口返回的「任务已被…办理」「退回修改」「待我处理」属于原始协议状态文本；现恢复按中文原文匹配判断，仅对界面显示结果做翻译，确保英文模式下待处理任务完整呈现。 |
| `pages/info/WasherTab.tsx:265`、`components/LiveTiles.tsx:91` | 缺名设备的兜底词「设备」原本一并混入 `AtomRef` key、深链 DOM target 与设备查找逻辑；现已将稳定的 `deviceKey` 与展示用的 `title` 拆开，切换语言后同一收藏项依然精准匹配。 |
| `state/systemCal.ts:43`、`plugins/XiaodaPane.tsx:22`、`pages/xiaoda/XiaodaPage.tsx:38` | 原生日历名称与校方智能体名称继续保留固定原始标识，使原生侧身份与校方消息元信息在语言切换时保持稳定。 |
| `pages/zhjwxk/Courses.tsx` 的三处 `infoNewsQuery` | 恢复校内公告检索所需的固定关键词「北京大学 北京外国语大学」「北京大学 研究生」，仅对按钮可见文字做多语言转换。 |
| `plugins/ChatDock.tsx:1484` | `429` 提示操作按钮改用固定的内部 section 锚点「模型MCP日志」跳转，避免因界面文案翻译导致 OH 配置项寻址失效。 |
| `components/FilePreview.tsx:165` | Windows 预览提示改为渲染期按需调用函数求值，消除模块初次加载时锁定旧语言的问题。 |
| `components/ExtHwLoginModal.tsx:53` | 短信验证通道的 `hint` 改为动态 getter，避免在构造配置数组时提前把翻译结果固化为静态字符串；通道 ID 与禁用逻辑保持原样。 |

## 动态注册表排查

- `NAV` → `homeSpheres.sphereEntry/allSphereEntries` 直接透传原始注册对象，保留 `label` getter 的按需解析特性。
- `navigation.BY_ID` 保存原始对象引用，路由标识、`category` 与服务调用参数继续沿用既有固定 ID。
- `PAGE_ATOMS/WIDGET_ATOMS` 的展示名称通过 getter 在渲染期动态读取；学校接口下发的动态课程与机构名称作为业务原始数据直接保留。
- `widgets.cardWidgetDefs/appWidgetDefs/allWidgetDefs` 在每次函数调用时动态派生；`FreeBoard` 的组件目录 `memo` 已将当前 UI locale 列入依赖数组。
- `quickEntries()` 在调用时实时生成对应语言的标签，落盘的 OneShot 配置仅记录条目 ID；`HOME_TAB` 单例的 `title` 保持 getter 形态，未在对象展开时固化为普通字符串。

本轮排查确认上述注册表均按渲染期动态求值运行，用户本地存档中的自定义命名与学校原始业务内容均保持原样不动。

## 自动化验证

```sh
node tools/i18n-business-boundaries-test.mjs
pnpm --filter @onethu/desktop typecheck
```

两条命令均以退出码 0 通过。其中边界测试包含 **39 项**断言，直接从业务 TS/TSX 源码中提取并执行真实的状态判断、路由构造与身份标识表达式，同时在测试期注入两套截然不同的模拟译文（防止因当前英文词条留空回退中文而掩盖潜在的协议误改），完整覆盖原始 THOS 任务状态过滤与去重、四类洗衣机身份键（缺名/带名称/位置/类型）、三条跨校课程公告检索路由、OH 设置锚点、原生身份标识以及已实例化提示对象的动态语言刷新。真实账号端到端联调与译文语言质量则在对应专项中分别验证。

定向 `git diff --check` 检查通过，本机类型检查日志归档于 `/tmp/onethu-i18n-boundaries-typecheck.log`。

## 状态层展示文案补齐

完成上述协议边界复核后，按协同划定的文件范围继续补齐了状态层的 **95 条** 界面提示文案：

- `state-completion-seed.json`（75 条）：涵盖暂存箱与组织口令状态说明、对象打开 Toast、校内模型预检提示、场馆预约二次认证提示、内容接收反馈，以及校园数据拉取相关的交互提问与错误提示。
- `small-display-completion-seed.json`（20 条）：涵盖通知设置操作文案、小组件实例摘要与运行标题、工具及 OneFlow 执行报错、好友空留言占位、原生悬浮窗降级说明与附件读取失败提示。

两份种子文件均位于 `docs/i18n/` 下，采用稳定语义键并完整记录中文源文、插值参数与源码位置；英文初值暂留空，交由总控流程统一分批生成与审校。默认的组织名、用户名、暂存箱名、校方页面「登录成功」判定词、调试日志、工具 ID、参数名以及发往 OH 模型的系统级附件说明均严格保留原文。动态拼接语句已统一整理为带 `error/recipient/currentAccount/count/contents/reason/name/step` 具名参数的完整自然句。

补齐词条后的回归结果：

- `node tools/madmodel-auth-route-test.mjs`：31 项断言以退出码 0 通过；仅在旧测试夹具中补入真实 `i18n` 模块导入，原有业务断言悉数保留，全程离线运行。
- `ONETHU_TEST_OUT=/tmp/onethu-state-completion-short-share node tools/short-share-browser-test.mjs`：52 项断言以退出码 0 通过，浏览器正常关闭且无运行时异常；直接驱动真实的分享状态函数搭配本地模拟云盘，覆盖新旧版口令、组织与名片收发、重复导入、过期拦截与主动撤销，并通过独立输出目录参数保留过往测试产物。
- 合入首批 75 条后 `@onethu/desktop` 类型检查以退出码 0 通过；末批 20 条在总控集成阶段统一执行全量类型检查与构建。

本轮验证产物见 `/tmp/onethu-state-completion-short-share/report.json`，运行日志见 `/tmp/onethu-state-completion-madmodel.log` 与 `/tmp/onethu-state-completion-short-share.log`。至此状态层消息键位接入已全部就绪，后续将按批次推进英文译文填充与真实云盘账号联调。

## 末轮非 JSX 展示文本筛查

最后对非 JSX 模块做了一次人工走查，将遗漏的 **43 条** 面向用户的展示文案归入 `docs/i18n/final-completion-seed.json`，并由总控任务合并进主词典。覆盖范围包括：PPTX 未支持元素占位说明、语音读屏回退提示、插件安装与权限提示、分享范围摘要、壁纸库容量提醒、版本更新提示、分享接收失败文案、文件缓存反馈、消息铃铛相对时间、选课草稿差异确认与覆盖说明，以及记忆模块隐私拦截原因。学校原始业务文本、分类与路由 ID、校内检索关键词、用户自定义名称、默认持久化标识、内部日志及发给 OH 的附件系统提示词均继续保持原始形态。

排查中还一并优化了四处与具体译文解耦的交互细节：

- 插件安装与市场反馈状态统一重构为 `{text, tone}` 结构，直接以显式 `tone` 字段表达成功或失败语义，避免依赖中文前缀匹配决定提示颜色，全部 12 条消息分支的状态色调均稳定可控。
- 新建及历史迁移生成的系统白板继续以 `首页` 作为底层存储标识，界面标题则根据当前语言动态渲染。
- PPTX 三类暂未支持元素的占位 `label` 改为 getter，使已加载的幻灯片模型在切换语言后即时更新提示；记忆隐私黑名单同样改为仅在展示拦截原因时延迟求值，底层正则匹配规则保持原样。
- 雨课堂题干 `iframe` 内的固定交互反馈文案改为在拼装文档时按当前语言解析，经 `JSON.stringify` 序列化并转义 `<`、`U+2028`、`U+2029` 后安全注入脚本，最终仅写入节点 `textContent`；题目原文与附件文件名保持原貌。同时为 `ProblemBody.rebuild` 补入语言依赖，已展开的题干在切换语言时会同步刷新反馈文案。

末轮定向回归全部以退出码 0 通过：

| 命令 | 结果 |
| --- | --- |
| `node tools/i18n-final-display-test.mjs` | 33 项：覆盖真实 `iframe` 沙箱脚本、中英文特殊字符译文转义、惰性描述求值、12 条插件状态分支、系统白板持久化标识与题干重建依赖 |
| `node tools/pptx-render-test.mjs` | 43 项：完整保留原有的幻灯片几何、文本内容与占位渲染断言 |
| `node --import ./tools/ts-resolve-register.mjs tools/ykt-body-test.mjs` | 161 项：完整保留原有的题干正文解析、字体与深浅色适配断言 |
| `node --import ./tools/ts-resolve-register.mjs tools/plugin-widget-test.mjs` | 33 项：完整保留用户及插件自定义声明内容与槽位语义 |
| `node tools/i18n-business-boundaries-test.mjs` | 39 项：协议判断、持久化标识与延迟求值全量回归通过 |

相关日志归档于 `/tmp/onethu-i18n-final-display.log` 与 `/tmp/onethu-final-{pptx,ykt,plugin-widget,business}.log`，全仓最终类型检查与打包构建由总控环节统一收口。Android 原生桌面小组件的快照结构与 Kotlin 后台定时重绘词典由专项任务成套打通，确保前端初次推送与原生后台重绘始终保持语言一致。

## 集成前独立交叉复核

交叉检查了全仓移除纯 `t()` 回调上 `locale` 依赖的改动：由于 `t()` 每次执行时都会直接读取最新语言状态，稳定的事件回调在触发时自然会拿到当前语言文本，省去 `locale` 依赖还能避免语言切换时触发多余的网络重连、重复提交或清空正在编辑的本地状态。而对于在渲染期预先计算并缓存展示字符串的 `useMemo`，则必须显式订阅语言变化。

顺着这一原则核查，定位并补齐了两处缓存依赖遗漏：

- `state/data.ts` 中的 `useXkWorkbench.semesterOptions` 补入了语言订阅与 `memo` 依赖（原先仅依赖 `semester`，导致已打开选课工作台里的“当前学期”后缀在切语言后停留旧文案）。秋、春、夏三学期现采用三条独立的完整展示模板，底层选项值继续保持 `YYYY-YYYY-number` 原始协议格式。
- `pages/info/reportParts.tsx` 中的 `useReportStats.groups` 补入了语言订阅与 `memo` 依赖，使缺少学期名称时的本地兜底标签可随语言实时更新，学校接口返回的原始学期名与绩点、学分数值计算均保持不变且无需重新请求网络。

配套新增的 3 条展示模板已写入 `docs/i18n/display-memo-completion-seed.json`；专项测试 `node tools/i18n-display-memo-test.mjs` 共 **10 项**断言全部以退出码 0 通过，验证了真实 `memo` 缓存刷新、中英双向切换、跨年度 9 个学期协议值恒定以及原始成绩对象与学分绩点无损保留（日志见 `/tmp/onethu-i18n-display-memo.log`）。

此外，复核发现组织模块的部分表单入口仍在调用 `openFormModal` 前预先求值了标题与字段标签，随即移交负责业务表单专项的协作者一并改为消息描述符延迟解析。最后核对了总交付报告的表述口径：工程基础设施接入与英文词条翻译进度、浏览器视口仿真与真机验证、本地隔离替身与真实账号联调、安装包哈希校验与发行者代码签名等边界均已清晰交代、客观准确。
