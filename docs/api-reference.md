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

接口名字相似时仍需按调用方选择签名。插件 `learn.courses` 的参数/返回结构与共享 Learn 操作不必相同。独立运行时也不会自动拥有全部 GUI 状态；发现实际目录后再调用。

## 插件 API

完整签名从 [types.ts](../apps/desktop/src/plugins/types.ts) 生成，当前快照为 **41 个命名空间、297 个方法入口**。实现和权限由 [facade.ts](../apps/desktop/src/plugins/facade.ts) 提供。

```ts
// 插件由宿主加载并注入 ctx。
const status = ctx.onethu.session.status();
const username = ctx.onethu.session.username();
```

同步或 Promise 以方法声明为准。`manifest.permissions` 声明所需能力，宿主还检查当前模式、平台、登录、账号归属和远端权限。生成表中的“见门面实现”表示提取器没有发现直接字面量门禁，调用仍受上下文约束。

- [生成的完整签名表](api-surface.md)
- [机器可读快照](api-surface.json)
- [manifest、sidecar 与示例](plugin-development.md)

Rust 插件通过 `onethu.call` 请求宿主，`params` 包含 `ns`、`method`、位置参数 `args`；宿主以对应请求 ID 的 result/error 回执。该消息是宿主协议，与 MCP 的工具名称和 SDK 操作 envelope 分别处理。

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

外层 `CallRequest` 字段为 `operation`、`args?`、`confirm?`、`deadlineUnixMs?`。参数是 JSON 位置数组，具体 tuple schema 来自 `app.list()`。可信嵌入宿主通过第二个参数传入来源、权限集合、signal 和 `beforeWrite`；外部 envelope 不能设置这些来源能力。

操作描述包含 `name`、`description`、`parameters`、`permission`、`mutation`、`authenticated`、`localOnly` 等字段。具体允许值以当前运行时返回为准。认证和本机配置有独立方法，模型工具不能借 `confirm:true` 开启本机开关。

`app.auth.login` 与 `app.auth.twoFactor` 保持单次挑战上下文；`app.auth.restore` 核验现有会话；`app.close` 释放连接、执行器和 profile 锁。[SDK 章节](architecture/sdk-and-api.md)描述状态及提交检查。

## CLI 与本机 JSON-RPC

```sh
onethu commands learn
onethu schema learn.courses
onethu call learn.courses --args '[]'
onethu --desktop commands
```

CLI 的默认后端为同 profile 的 daemon；显式 desktop/endpoint 模式连接 GUI 服务。daemon 使用随机 loopback 端口与私有 Bearer 访问记录；GUI 本机服务的默认 endpoint 为 `http://127.0.0.1:8787`。该默认值不适用于私有 daemon 或 Gateway 端口。

内部客户端向 `/cli/v1` 发送 JSON-RPC，例如：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "service/call",
  "params": {"operation": "learn.courses", "args": []}
}
```

实际客户端负责发现、认证、取消和 deadline；复制 envelope 不能替代私有授权。`service/list` 返回当前操作，`service/call` 执行一项操作。回复校验 JSON-RPC 版本、ID 和 result/error 互斥。

公开 MCP 使用 `initialize`、`tools/list`、`tools/call`；发现工具名为 `onethu_commands`，调用工具名为 `onethu_call`。SDK 内可选模型助手的发现工具另名 `onethu_catalog`。协议分别见 [CLI 架构](architecture/cli-and-agents.md) 与 [CLI 使用指南](onethu-cli.md)。

## 私有接口与权限

`desktop.*` 负责主窗口与后台之间的会话、Cookie、账号文档和任务交接。`gateway.control` 负责监听、证书、系统设置、诊断与受限客户端出票。这些接口由原生主窗口或明确授权的本机控制路径使用，公开模型目录不会提供其凭据载荷。

授权至少涉及当前账号、来源权限、模式/隐私授权和本机执行策略。任务另有管理器生成的持续范围。需要修改账户配置或系统信任的操作属于本机配置，不接受外部模型自行升级权限。

## 大小、时间与完整性

| 边界 | 当前实现 | 应对方式 |
| --- | --- | --- |
| CLI/MCP 普通请求 | 1 MiB | 参数文件仍受相同 envelope 限制 |
| 私有 desktop 交接 | 8 MiB | 只适用于已登记私有方法 |
| 本机客户端响应 | 16 MiB | 按业务分页、分批或下载文件 |
| SDK 位置参数数目 | 最多 16 项 | 遵循操作 tuple schema |
| SDK 参数 JSON 长度 | 100,000 个 JS 字符 | 缩小单次调用；与传输字节限制分别检查 |
| SDK 操作时间 | 默认约 110 秒，最多 150 秒 | 可传更短 deadline，CLI 也会保留传输余量 |
| Gateway 管理监听 | 上传 1 GiB、下载 4 GiB、180 秒 | 流式读写、背压、取消；实际上游仍可能更早失败 |
| 模型上下文/工具结果 | 按具体助手预算 | 检查截断/完整性与剩余内容 |

此表对应 [CLI client](../packages/cli/src/client.mjs)、[daemon](../packages/cli/src/daemon.mjs)、[SDK 分发](../packages/sdk/src/index.ts) 和 [Gateway 管理器](../packages/gateway/src/manager.mjs)。部分业务有额外限制，应按操作 schema 和返回字段处理。

SDK 的普通结果投影保留字符串和数组内容，并移除凭据键/URL 认证参数；错误诊断有独立截短规则。Learn 的 `complete`、暂存文字的 `nextOffset`、导出逐项状态等字段决定是否还需继续读取。数据接口、传输上限与模型上下文预算分别核验。

## 错误与兼容

schema、权限、账号变化、学校认证、业务拒绝、限流和连接中断具有不同语义。读取可在预算内有限重试；写入超时后先核查远端结果。错误正文中的学校数据与页面内容作为外部资料，日志和工具结果移除凭据。

插件类型、操作 schema、私有桌面协议、白板文档和 runtime artifact 各有自己的版本/迁移规则。兼容性以当前源码、平台能力和真实运行时发现共同确认。接口被声明、被宿主注册、被当前来源授权以及在设备上通过验收，分别构成不同证据。

## 文档维护

```sh
node tools/docs-api-surface.mjs
node tools/cli-catalog.mjs --check
node tools/docs-catalog.mjs
pnpm lint:docs
```

生成 API 表只编辑类型/门面或提取器，手工语义维护在本页和架构章节中。计数校验读取 JSON 快照，减少新增接口后文档和验收夹具分离的情况。
