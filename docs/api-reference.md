# OneTHU API 参考


中文 · [English](en/api-reference.md) · [系统架构](architecture.md)

## 选择调用入口

| 调用方 | 接口 | 契约来源 | 生命周期 |
| --- | --- | --- | --- |
| JS 应用插件 | `ctx.onethu.<namespace>.<method>` | `OnethuApi` + facade | GUI / 原生宿主 |
| Rust 插件 / Harness | `onethu.call` 双向宿主请求 | 插件协议 + 同一 facade | sidecar 或 Android 内嵌 |
| 嵌入式 Node 程序 | `createOneThu`、`app.list`、`app.call` | SDK 注册表与 schema | 调用方持有 runtime |
| 终端与外部 Agent | `onethu commands/schema/call` | 当前 CLI 运行时目录 | daemon 或显式 desktop 模式 |
| MCP 客户端 | `onethu_commands`、`onethu_call` | 当前来源可见的操作目录 | CLI stdio / 本机服务 |
| OH 应用工具 | `app_services`、`app_call` 与专用工具 | 运行中 App 的服务门面 | 依赖 App 及模式/隐私授权 |
| OneTHU 主窗口 | 私有 `desktop.*`、`gateway.control` | 本机协议和 owner/epoch 校验 | 私有 daemon 与原生桥 |

不同调用入口面向各自的运行环境，即使方法名相近，参数与返回结构也以对应入口的定义为准。例如插件侧的 `learn.courses` 面向前端视图，而 SDK 与 CLI 中的 `learn.courses` 遵循共享操作 schema。独立运行时按自身注册表提供服务，调用前可先通过目录接口查询当前可用操作。

## 插件 API

完整签名由 [types.ts](../apps/desktop/src/plugins/types.ts) 自动生成，当前快照共包含 **41 个命名空间、297 个方法入口**，具体实现与权限校验位于 [facade.ts](../apps/desktop/src/plugins/facade.ts)。

```ts
// 插件由宿主加载并注入 ctx。
const status = ctx.onethu.session.status();
const username = ctx.onethu.session.username();
```

方法返回同步值还是 Promise 以类型声明为准。插件在 `manifest.permissions` 中声明所需权限，宿主在执行时还会结合体验模式、运行平台、登录状态、当前账号与远端权限综合判定。签名表中标注“见门面实现”的条目，说明门面在运行时根据上下文动态校验权限。

- [生成的完整签名表](api-surface.md)
- [机器可读快照](api-surface.json)
- [manifest、sidecar 与示例](plugin-development.md)

Rust 插件通过 `onethu.call` 向宿主发起请求，`params` 包含命名空间 `ns`、方法名 `method` 与位置参数 `args`，宿主按对应请求 ID 返回 `result` 或 `error` 回执。这套双向消息专用于插件与宿主的桥接通信，独立于公开 MCP 工具名称与 SDK 调用 envelope。

## SDK 调用

```ts
const controller = new AbortController();
const result = await app.call({
  operation: 'learn.courses',
  args: [],
  deadlineUnixMs: Date.now() + 30_000,
}, {
  signal: controller.signal,
});
```

外层 `CallRequest` 包含 `operation`、`args?`、`confirm?` 和 `deadlineUnixMs?` 字段。参数采用 JSON 位置数组，各位置的类型定义可通过 `app.list()` 返回的 tuple schema 查询。可信嵌入宿主通过第二个选项参数传入调用来源、权限集合、`signal` 与 `beforeWrite` 钩子；这些宿主上下文字段仅由进程内调用方直接提供，与可序列化的外层请求结构相互独立。

每项操作的描述对象提供 `name`、`description`、`parameters`、`permission`、`mutation`、`authenticated`、`localOnly` 等元数据，实际可用集合以当前运行时返回结果为准。账号认证与本机系统配置通过专用宿主接口完成，常规工具调用中的 `confirm:true` 仅用于业务写操作确认。

`app.auth.login` 与 `app.auth.twoFactor` 串联单次登录与二次验证挑战上下文，`app.auth.restore` 用于核验并恢复已有会话，`app.close` 则负责释放网络连接、执行器与 profile 锁。关于会话状态流转与写操作提交前的校验细节，请参阅 [SDK 章节](architecture/sdk-and-api.md)。

## CLI 与本机 JSON-RPC

```sh
onethu commands learn
onethu schema learn.courses
onethu call learn.courses --args '[]'
onethu --desktop commands
```

CLI 默认连接同一 profile 下的常驻 daemon；传入 `--desktop` 或显式指定 endpoint 时，则直接连接正在运行的 GUI 应用服务。daemon 启动时自动分配随机 loopback 端口，并将私有 Bearer 访问记录写入 profile 目录；GUI 本机服务默认监听 `http://127.0.0.1:8787`（私有 daemon 与 Gateway 各自使用独立的动态端口配置）。

内部客户端向 `/cli/v1` 发送 JSON-RPC 请求，例如：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "service/call",
  "params": {"operation": "learn.courses", "args": []}
}
```

客户端在发送上述请求体时会自动处理端口发现、Bearer 鉴权、取消信号与 deadline 计算。其中 `service/list` 返回当前可用操作目录，`service/call` 执行指定操作；客户端收到响应后会校验 JSON-RPC 协议版本、请求 ID 以及 `result` / `error` 的互斥关系。

公开 MCP 服务支持标准的 `initialize`、`tools/list` 与 `tools/call` 方法，暴露 `onethu_commands`（查询目录）和 `onethu_call`（执行操作）两项工具；SDK 内可选模型助手的目录查询工具则命名为 `onethu_catalog`。完整的协议流程与命令行用法见 [CLI 架构](architecture/cli-and-agents.md) 与 [CLI 使用指南](onethu-cli.md)。

## 私有接口与权限

`desktop.*` 接口专用于主窗口与后台进程之间交接会话、Cookie、账号文档与常驻任务；`gateway.control` 则负责网关监听、证书、系统代理设置、运行诊断与受限客户端出票。这两组接口仅供原生主窗口或显式受信任的本机控制通道调用，与面向外部模型的公开工具目录相互隔离。

每次调用都会综合核对当前账号、请求来源权限、体验模式、隐私授权状态与本机执行策略；常驻任务则依托任务管理器签发的持续授权范围运行。涉及修改账户配置或系统级信任状态的操作仅向本机控制面开放，由用户在设备端直接触发。

## 大小、时间与完整性

| 边界 | 当前实现 | 应对方式 |
| --- | --- | --- |
| CLI/MCP 普通请求 | 1 MiB | 命令行内联参数与参数文件共用该上限 |
| 私有 desktop 交接 | 8 MiB | 专用于已登记的私有交接方法 |
| 本机客户端响应 | 16 MiB | 按业务分页、分批或下载文件 |
| SDK 位置参数数目 | 最多 16 项 | 遵循操作 tuple schema |
| SDK 参数 JSON 长度 | 100,000 个 JS 字符 | 缩小单次调用体积，与外层传输字节数独立计算 |
| SDK 操作时间 | 默认约 110 秒，最多 150 秒 | 可传更短 deadline，CLI 也会保留传输余量 |
| Gateway 管理监听 | 上传 1 GiB、下载 4 GiB、180 秒 | 支持流式读写、背压与取消，同时受上游超时限制 |
| 模型上下文/工具结果 | 按具体助手预算 | 检查截断/完整性与剩余内容 |

上表数值对应 [CLI client](../packages/cli/src/client.mjs)、[daemon](../packages/cli/src/daemon.mjs)、[SDK 分发](../packages/sdk/src/index.ts) 和 [Gateway 管理器](../packages/gateway/src/manager.mjs)。部分业务接口还设有更细的参数约束，调用时以具体操作的 schema 和返回字段为准。

SDK 输出常规结果时会保留完整的字符串与数组内容，自动移除凭据键和 URL 认证参数；错误诊断信息则按独立规则截短。读取批量或分段数据时，可根据 Learn 的 `complete`、暂存文字的 `nextOffset` 或批量导出的逐项状态判断是否需要继续读取。业务数据分页、传输层上限与模型上下文预算按各自所处层级协同生效。

## 错误与兼容

运行时将参数校验失败、权限不足、账号切换、学校认证过期、业务规则拒绝、上游限流与连接中断区分为明确的错误类别。只读请求遇到瞬时故障时可在时间预算内有限重试；写操作一旦超时，应先向远端核查实际结果再决定后续动作。错误正文里附带的学校数据与页面片段均按外部不可信文本处理，并在写入日志或返回工具结果前剔除敏感凭据。

插件类型定义、操作 schema、私有桌面协议、白板文档和 runtime artifact 各自维护独立的版本号与迁移规则。跨环境接入时，建议结合目标平台支持范围，通过目录发现接口实时确认当前宿主已注册且已向当前来源授权的操作集合。

## 文档维护

```sh
node tools/docs-api-surface.mjs
node tools/cli-catalog.mjs --check
node tools/docs-catalog.mjs
pnpm lint:docs
```

自动生成的 API 签名表由类型定义、门面源码或提取脚本驱动更新；调用约定与架构说明则在本页和各架构章节中手工维护。校验脚本会直接读取 JSON 快照核对方法计数，确保新增或调整接口后文档与测试夹具保持同步。
