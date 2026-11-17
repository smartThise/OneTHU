# 插件 API 参考（0.11）

中文 · [English](en/api-surface.md)

为了保持文档与代码实时同步，完整的接口签名与权限声明直接由 TypeScript 类型与宿主门面自动生成，详见 [插件 API 完整清单](api-surface.md)（当前共包含 **41 个命名空间、297 个方法入口**）。

## 代码真源与更新方式

- `apps/desktop/src/plugins/types.ts`：定义 `OnethuApi` 接口结构、参数与同步/异步返回类型。
- `apps/desktop/src/plugins/facade.ts`：负责宿主能力注入、权限校验及服务与平台适配。
- `docs/api-surface.json`：供工具与测试读取的结构化清单快照。

修改接口后可通过以下命令重新生成文档：

```bash
node tools/docs-api-surface.mjs
```

JavaScript 插件通过 `ctx.onethu.<namespace>.<method>(...)` 直接调用宿主能力；桌面 Rust sidecar 插件则通过 `onethu.call` 协议按位置传递参数，具体通信协议与 `manifest.json` 规范详见 [插件开发指南](plugin-development.md)。

## 调用与权限约定

调用时请直接对照各方法的 TypeScript 返回类型区分同步调用与 `Promise` 异步调用。宿主门面会在执行前校验插件声明的权限；遇到登录二次验证、会话过期、校方限流或请求超时等情况时，建议按错误类型分类提示用户处理；传递学校业务对象（如课程、场馆或预约条目）时，请直接沿用上游查询返回的对象结构。

自动生成表格中标注「见门面实现」的方法，会在 `facade.ts` 内部结合运行时上下文、当前模式与远端账号权限完成动态校验。

OH 工具、MCP 服务、应用插件与清小搭技能各自由对应的运行时承载：轻量纯同步计算可在内置 QuickJS 沙箱中直接执行，需要访问本地文件、网络或外部进程的复杂技能则支持一键导出至电脑端外部 Agent 运行。
