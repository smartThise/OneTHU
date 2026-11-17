# 雨课堂 CLI／OH 查询接入修补


日期：2026-10-26；工作目录：`/Volumes/PortableSSD/Projects/thuapp/OneTHU`。

## 根因

GUI 原有雨课堂课程、作业、课件、视频和公告客户端。独立 SDK 虽有部分 `exthw.*` 查询，GUI 插件 facade 只发布外部作业快照与刷新，OH 工具及系统提示词没有雨课堂查询入口。桌面与 CLI 也没有共享单独的雨课堂登录配置。两个内置 Harness 清单还缺少 `exthw:read` 权限，因此仅增加方法仍会被权限门禁拒绝。

## 处理

- 新增 core `createYuketangQueries`，GUI 与独立 SDK 复用同一只读客户端。`yuketang.status/courses/contents/homework/homeworkDetail/leafDetail/noticeDetail` 全部登记到 CLI 目录，保留旧 `exthw.*` 命令。
- OH 内置 `query_yuketang`，说明每种查询的参数来源、独立扫码登录及错误含义。`classroomId`、`leafTypeId`、`leafId`、公告候选 id 直接沿用目录结果。两个 Harness 清单增加只读权限；独立 Agent 提示词也说明雨课堂已支持。
- 状态接口隐藏底层 Cookie，以 `configured` 字段标识本地已存在配置，实时会话有效性通过课程查询接口验证，并清晰区分未配置、过期、账号变化与课堂不存在。CLI 为常见错误提供可操作提示，同时继续屏蔽外部响应原文和敏感凭据。
- 新的代理查询逐页读取课程日志，超过 200 条继续请求下一页；去重重叠活动，重复分页报告不完整并停止。部分课堂失败返回已获得的数据和 `issues`，过期会话拒绝返回旧结果。此行为通过可选 query hooks 启用，保留原 GUI 缓存调用方式。
- 课程内容目录获取全部可用页。作业沿用已有 GUI 语义：保留既往作业，未来截止 horizon 通常 30 天；可显式传 1–3660 天，结果携带范围说明。
- `desktop.yuketangSync` 限定在本机私有原生／daemon 通道内调用，与公共服务目录及 MCP 隔离，并按学校账号与会话 epoch 绑定归属；若独立 CLI 已存在其他会话配置则保留原配置并报告冲突，桌面端断开连接时仅撤销自身同步配置，且同步载荷仅含雨课堂会话信息。
- 桌面扫码或断开后自动同步至常驻 CLI，学校主登录继续沿用原有共享机制。请求等待期间若凭据发生变更，会自动丢弃旧快照并转交新配置，迟到的雨课堂心跳 Cookie 也会被代次校验拦截；撤销授权、切换账号与临时连接异常均已补充回归用例。
- 补充中英 CLI 文档和权限说明，词条进入 seed 后重新生成。

## 验证

- SDK 全量 195 项、CLI 全量 74 项通过。
- 新的雨课堂专项 17 项：查询目录、真实客户端请求形状、单课堂范围、跨 200 条分页、重叠去重、重复页、不完整来源、过期会话、异常结构、账号／Cookie 变化、截止范围、详情路由及私有同步安全。
- 桌面私有同步编排 5 项；CLI 服务边界 48 项、共享运行时 20 项；原通知附件／资源枚举 27 组、CLI 学习服务 32 组继续通过。
- Harness 全量 66 项通过，含新 OH 工具的七种动作、发现、只读及非法参数拒绝。原雨课堂课程、作业详情、外部作业状态回归通过。
- 全工作区类型检查、生产构建、原生 `cargo build`、Harness release sidecar 构建通过。中英 i18n 7649 条，errors 0。

## 真实运行状态与范围

已更新现有 dev wrapper 和实际使用的 Harness sidecar／独立 CLI bundle；桌面原有雨课堂配置已自动同步到 CLI，`desktopSync=synced`，学校主登录保持 ready。

真实环境只读联调中，GUI 查询桥与独立 CLI 均收到雨课堂服务端返回的 HTTP401，确认本机缓存的旧雨课堂 Cookie 已过期，并据此补充了 `YUKETANG_SESSION_EXPIRED` 的扫码重登提示。本轮已完成模拟环境下的完整分页查询验收及真实环境下的过期报错链路验证，待用户重新扫码后即可拉取实时课程与内容。

联调末次重启时遇到 CLI 开关被置关的情况（用户确认未手动关闭）。排查发现应用启动初期授权状态默认值为 false，若在持久化授权读取完成前触发同步，会将该临时默认值写回后台。`syncCliRuntime` 现改为先等待 `initPrivacyConsent` 完成，并新增回归用例验证读取期间保留后台开关及授权读入后的同步状态。恢复此前 enabled=true（维持 automatic=false 逐次写操作审批）并重启验证后，学校会话保持 ready、雨课堂保持 desktopSync=synced，课程查询稳定返回预期的 `YUKETANG_SESSION_EXPIRED`。

所有代码位于原主仓库，保留既有未提交 CLI、共享后台与通知附件开发。本次任务未构建或替换安装包。
