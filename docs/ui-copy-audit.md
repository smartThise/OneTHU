# UI 文案审计（§4.5 对照表 · 续篇）

状态：**已落地**。本表经你审定后执行，词表扩展与全部改写同一批提交，中间没有留红。

## 一、审定意见（已按此执行）

1. 语气比原来的极客风好，但有些过于口语 —— 改为**书面语表达，保留亲民与普适性**：
去掉「没收藏上」「试试」「点一下」这类口语助词，保留「请重试」「请刷新」「稍后再试」这类明确动作。
2. 用户可见文案里，「原子」统一改叫 **「收藏项」**。

## 二、量法与结果

扫描 `apps/desktop/src/pages` 与 `appsrc/components` 下的全部 `.tsx/.ts`，
取「看着是给人看的」字面量（含中文、出现在 JSX 文本或常见 UI 属性里），跳过注释行、块注释续行与带 `ui-copy-lint-ok` 的行。

| 阶段 | 结果 |
| --- | --- |
| 扩展词表后首次扫描 | 违规 **63** 处（R1 术语 42 / R4 语气 21 / R2 超长 0） |
| 改写后 | 违规 **0** 处 |
| 另人工清出的扫描范围外用户可见文案 | 7 处（启动提示 1、toast 1、组件/收藏标题 3、插件权限说明 2） |

扫描范围的边界：日志与排障行不列入（`state/exthw.ts` 的 `logLine`、`info/tabStates.tsx` 的 TAB-HEAL 等，用户看不到），
其余未被自动扫描的目录（`App.tsx`、`state/`、`plugins/`）已按人工逐条过一遍，用户可见的都已改，诊断用的按原样保留。

## 三、词表（本轮新增）

| 词 | 处置 |
| --- | --- |
| 原子 | 收藏项 |
| 会话 | 登录状态（聊天语境除外，`ChatDock` 里指对话，不动） |
| 凭据、凭证 | 绑定（「账号与凭据」→「账号与绑定」） |
| 接口 | 数据、来源、网络地址 |
| CAS、SM2、manifest、插件宿主、WebVPN | 加入禁用词（WebVPN 原规则漏了大小写标志，一并补上） |
| R4 语气 | 完整句里的失败类字眼必须带行动词；以「：」结尾的「前缀 + 详情」不算违规；状态标签走行内豁免并写明理由 |

## 四、逐条对照

### 语气（错误与空态带行动词）

| 位置 | 现在 | 改成 |
| --- | --- | --- |
| learn/AssignmentDetailPage.tsx:235 | 提交失败 | 提交未成功，请稍后重试 |
| learn/AssignmentDetailPage.tsx:265 | 撤回失败 | 撤回未成功，请稍后重试 |
| learn/CourseDetailPage.tsx:254 | 分组加载失败 | 分组没有加载出来，请刷新后重试 |
| info/SportsTab.tsx:43 | 体育预约服务暂不可用（info app 同样无法使用） | 体育预约暂不可用，请在「清华体育」App 中预约 |
| info/tabStates.tsx:80 | 该服务暂不可用（上游服务维护中） | 该服务暂不可用（正在维护），请稍后再试 |
| info/NewsTab.tsx:484、504 | 服务端返回删除失败 | 删除未成功，请刷新后重试 |
| info/NewsTab.tsx:508 | 服务端返回添加失败 | 添加未成功，请刷新后重试 |
| info/ThosPage.tsx:49 | 办理失败 | 办理未成功，请重试 |
| info/ThosPage.tsx:186 | 服务目录加载失败 | 服务列表没有加载出来，请刷新后重试 |
| info/ThosPage.tsx:193 | 在线服务连接失败（会话可能已失效） | 连不上在线服务，登录可能已过期，请重新登录 |
| info/ThosPage.tsx:271 | 收藏保存失败 | 收藏未保存，请再试一次 |
| components/RootErrorBoundary.tsx:47 | 界面渲染出错，已停在当前页面 | 本页出现问题，已停留在当前页面，可刷新页面重试 |
| components/FilePreview.tsx:108、829 | 未知错误 | 出现未知问题，请重新打开 |
| components/FilePreview.tsx:143 | 预览渲染出错，已停在这一条上（应用其余功能不受影响）。 | 这一条预览失败，其他内容不受影响；可换一条，或用上方「打开」查看原文件。 |
| components/FilePreview.tsx:617 | mammoth 模块加载失败 | docx 预览组件没有加载成功，请重新打开 |
| components/NotifySettingsSection.tsx:104 | 通知未授权 | 通知权限未开启，请在系统设置中打开 |
| pages/Settings.tsx:536 | 复制失败，可改用导入框核对 | 复制未成功，请改用下方的导入框核对 |
| pages/Settings.tsx:1792 | 系统取色不可用，已改用「清华紫」主题。 | 系统取色暂不可用，已自动改用「清华紫」主题，稍后可在外观里手动更换。 |

行内豁免（理由写在代码行尾）：

| 位置 | 文案 | 理由 |
| --- | --- | --- |
| pages/Plugins.tsx:248 | 加载失败 | 状态标签，同一行操作区就有「日志」按钮 |
| components/NotifyBridge.tsx:39 | [notify] 启动失败 | 只进 `console.warn`，用户看不到 |
| info/tabStates.tsx:32 | 会话重建成功→自动重拉 | 排障日志，TAB-HEAL 前缀即诊断标记 |

### 技术细节

| 位置 | 现在 | 改成 |
| --- | --- | --- |
| Settings.tsx:62、259 | 账号与凭据 | 账号与绑定 |
| Settings.tsx（雨课堂区 9 处、导出/导入标题 3 处） | 会话 / 会话健康 / 检查会话 / 导出会话 | 登录状态（如「登录状态：尚未检查」「检查登录状态」） |
| learn/YktAssignmentDetailPage.tsx:471 | 本作业暂无题目明细（可能接口未返回 problems）。 | 本作业暂无题目明细（老师端未提供）。 |
| info/LibraryTab.tsx:351、579、608、LibRoomTab.tsx:542 | 需要登录会话（未获取到学号） | 需要先登录（未读取到学号） |
| info/LibraryTab.tsx:351 | 馆列表为空（seat.lib 返回空 list，会话可能未建立） | 馆列表为空（数据源未返回内容，登录状态可能未建立） |
| info/VenueSportsTab.tsx:217 | 未能自动登录（统一身份会话可能已失效） | 未能自动登录（统一身份登录可能已过期） |
| zhjwxk/Courses.tsx:198 | 官方教评获取失败（教务会话或网络），稍后重试 | 官方教评获取未成功（教务登录或网络问题），请稍后重试 |
| zhjwxk/Courses.tsx:851 | 暂无培养方案数据（可能该学期未配置培养方案，或会话已过期） | 暂无培养方案数据（该学期可能未配置，或登录已过期） |
| components/ThemePickerModal.tsx、Settings.tsx | 基础令牌 | 默认外观 / 应用自带配色 |
| components/ExtHwLoginModal.tsx:310 | 我已登录，读取会话 | 我已登录，读取登录信息 |
| components/OnboardingTour.tsx:532 | 会话失效时在 设置 → 外部作业源 重登。 | 登录过期时在 设置 → 外部作业源 重登。 |
| plugins/types.ts:50、72 | 登录会话状态 / 任意外部 HTTP(S) 接口 | 登录状态 / 任意外部网络地址（HTTP(S)） |
| info/DormTab.tsx:199 | 清华水站 dingshui.bjqzhd.com · 公开接口 | 清华水站 dingshui.bjqzhd.com · 公开数据（域名保留：来源标注对用户有意义，不按「URL 必须折叠」处理） |

### 禁用词：「原子」→「收藏项」

涉及 6 个文件（FolderPage 6 处、Collect 3 处、WidgetBindModal 6 处、WidgetSettingsSection 1 处、FavAtomPicker 1 处），
另清出 3 处扫描范围外的（`state` 的组件标题、收藏项详情标题、选课页说明）。
**只动用户可见文案**，数据层与 `FavAtom`、`atom` 等标识符未动，收藏行为不变。

## 五、遗留

1. 「技术细节（状态码 / URL）收进『详情』折叠区」**未做完**：本轮只做措辞改写。真正折叠需要折叠组件支持，
   且部分页面没有折叠位（如 `DormTab` 的来源标注）。计划表里这一格保持未勾。
2. `ChatDock` 里的「会话」指聊天对话，不属于本次禁用的登录语境，保持原样（lint 若将来扫到该目录，需按语境豁免）。
3. 扫描器的注释识别本轮补了**块注释跨行**跟踪（此前 `/* ... */` 的续行行首没有 `*`，会被当成代码文本误报一条）。
