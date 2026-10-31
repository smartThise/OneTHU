# Info、选课与运行中 dev 的会话共享修复（2026-10-31）

## 诊断更正

用户指出，现有 Mac OneTHU dev 明明正常。此前检查的是磁盘持久化 Cookie 快照，而非运行中 Rust Cookie 仓；据此要求用户重新登录缺乏依据，已撤回这一要求。磁盘快照、后台缓存的 `ready`、真实业务请求成功，分别属于不同证据，后续验收以原有 dev 和浏览器实际请求为准。

本轮始终使用原 Mac dev 窗口，没有另开 OneTHU、退出账号、清空应用数据或迁移设备信任。系统代理保持与原有 Clash 回退共存，证书没有更换。未读取保存密码文件，未发送验证码或执行选课、退课等业务写操作。

## 已确认的故障链

### 正常选课响应被当成失登

旧 `isXkDeadHtml` 只要看到 `__vpn_app_hostname_data` / `__vpn_hostname_data` 就判定失败。然而 Wengine 给正常业务页面同样注入这些变量。原生日志中存在约 16 KiB、有 `kcTable` 和 10 行数据的培养方案，随后依然出现“选课系统会话已过期”，触发重复认证。

现改为检查真实登录表单、确认表单和可见错误结构，忽略脚本/注释中的登录字符串。正常表格、空表格、培养方案、网格数据与页面框架均保留。HTTP 500 保留服务错误，不包装成会话过期或空课程。

### 局部失败扩大到全局

选课错误原先广播全局 `AuthRequiredError`，页面自己的 `softRecover("xk-*")` 也能再次重登全局 WebVPN。确认死循环的回退还会清除 ID/OAuth，再把抢救的 Cookie 路径压平。

现选课使用不广播的 `XK_AUTH_REQUIRED`；`xk-*` 不发起全局恢复；共享权威只做一次正常探活/恢复，保留健康会话。删除清空身份 Cookie 的回退。确认票据已落地时直接使用业务响应，避免再打开登录入口。密码表单保留学校所需隐藏字段，同时明确剔除 `singleLogin` 和 `deviceName`，不继承旧表单中的单点踢出/设备声明。

### 原生、选课独立缓存与后台快照不一致

GUI 恢复时可能导入旧的 resident 快照，覆盖更新的原生 Cookie。选课还使用独立 JavaScript Cookie 仓：仅导出 Rust 仓不能保证包含它刚获得的业务会话。

新增私有 `service-session-merge-v1` 协议。GUI 从原生 IPC 获取当前 Cookie；选课成功后再合并实际事务使用的独立 Cookie 仓。接收端必须验证 Info 返回的账号，且账号、设备指纹、epoch、显式退出标记和待完成登录流程均符合要求。

- `university` 只更新 Info、ID、OAuth 与根 WebVPN 控制票；保留云盘、邮箱和其他业务 Cookie。
- `selection` 只更新选课域；仅确实完成身份确认时同步 ID/OAuth；其他服务采用接收端当时的 Cookie，不采用旧快照。
- 保留 Cookie 的真实路径、secure、HttpOnly 和有效期；处理同一服务中旧的长路径 Cookie 遮蔽。
- 不修改账号 epoch、设备信任或密码；不因服务交接停掉现有任务。
- 旧 runtime 未声明能力时不发送新协议，防止被旧版误作全量覆盖。
- 后台 Info 失效时标记需要 live 同步，由原 GUI 定时恢复共享；不把后台的旧状态解释成 GUI 已失登。

### 有效选课会话被登录入口重复开启 CAS

官方 Info “本科生选课”选择器为 `A7298655396722EF78BA5B5FB0B5482A`，目标是旧系统 `/xklogin.do`。即使业务会话仍有效，这个入口也会重新启动 CAS。

代理在取得经过认证的官方目标后，优先只读验证该选课服务已有业务主页。正常则直接复用；过期或错误页面继续走原有有界 SSO。此分支不能自行授权新主机，也不消费任意调用者提供的 URL。HTTP 服务收到同主机 HTTPS 回调时保留原有 HTTP 上游的通用规则继续有效，不同主机/HTTPS 降级仍拒绝。

### 选课页面能显示，但导航脚本仍依赖 WebVPN

真实浏览器验收发现，旧系统菜单的 `onclick` 被改写为 `vpn_rewrite_js` 外壳；外部 `validator.jsp` 使用非标准 `javascript/x-javascript`，漏过脚本还原。移除 Wengine loader 后会导致菜单点击没有效果。

补充只对完整、已观察到的事件属性外壳进行静态还原，保留属性引号与实体。普通属性、注释、脚本字符串、JSON 和 textarea 原样保留；不在服务端执行下载的 JavaScript。兼容该非标准 MIME，保留 charset 并规范为 `application/javascript`。脚本正文仍按字节流处理，避免损坏 GBK。

## 验证记录

实际 Mac 验收已完成：

1. 原 Chrome Info 工作台重新加载，应用服务、Learn 待办与日历正常，无 `GATEWAY_AUTH_REQUIRED`。
2. 原 OneTHU dev 选课页刷新后显示实时目录与已选课程，私有交接日志成功；后台读取业务主页为正常框架页。
3. 从原 Info 点击“本科生选课”，浏览器打开原学校页面，显示 2026–2027 秋学期导航与帮助内容，无认证错误页。
4. 重新加载选课页，展开“选课查询”，菜单正常展开；点击“教学计划查询”，右侧有 2 个表格、12 行，未出现身份页面或超时消息。
5. 再次重新加载原 Info 工作台，应用服务与 Learn 待办继续显示，未因选课读取导致全局失登。

本地 resident runtime 为 `12622c83ffebd6964257b8a3ef18cb2fd884ed8f867b17eb36b4b3c0b16b9e6b`。原 GUI PID 67363 保持运行，系统代理 enabled、recoveryRequired=false，CA 保持原值。更新的是同一 profile 下已有后台代码，未另起未登录 GUI。

离线验证：SDK 全量 295 项、gateway 全量 135 项、选课真实 HttpClient 响应回归 10 项、学校语言解析 48 项通过；额外 CAS 信任字段与 Wengine 引导回归通过。core / SDK / desktop TypeScript 检查通过。回归覆盖误判、确认成功后重复登录、继承 singleLogin、失效确认不清会话、独立 jar 交接、账号/设备/epoch 越界、局部合并、有效选课主页复用、事件属性与特殊 MIME 脚本恢复、GBK 和任意分块边界。

真实验收只进行页面导航和读取，不提交选课/退课。未覆盖 Windows/Android 真机和业务写操作；本次不能据此宣称所有终端/所有服务均已验收。安装包、远端分支和发布渠道均未在本轮更新。
