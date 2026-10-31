# OneTHU Campus Gateway

无浏览器扩展的校园代理协议原型，开发于 `web` 分支。

当前范围是本机 HTTP/1.1 forward proxy 和受控 HTTPS CONNECT/TLS 入口。请求交给调用方注入的单一会话管理者；本包不启动第二套账号运行时，不安装证书，也不设置系统代理。

这还不是整机接管的发布版本。GUI/CLI 的正式会话连接、平台系统集成、CA 生命周期、校园网页兼容、手机与微信、局域网配对和其他协议见[实施计划](../../docs/plans/2026-10-31-campus-super-proxy.md)。

## 验证

需要 Node.js 20+ 与 `openssl` 命令。OpenSSL 仅在测试期间生成临时证书；证书只传入测试客户端的信任参数，不安装进系统或浏览器，测试结束后删除。

```sh
pnpm test:gateway
```

测试使用 loopback 套接字和模拟上游，不访问学校、账户文件或生产 daemon。

另有可选真实浏览器验收。环境需另外提供 Playwright 和 Chrome/Chromium；macOS 默认查找已安装的 Chrome，其他位置可通过 `CHROME_BIN` 指定。它在独立临时浏览器中，仅为测试证书的 SPKI 建立信任例外，保持系统证书库和用户浏览器配置不变。

```sh
node packages/gateway/test/browser-smoke.mjs
```

2026-10-31：24 项协议集成测试通过；Chrome 156 本地模拟站点验收通过，包含 HTTPS 代理认证、浏览器原生 Fetch Metadata、POST、二进制下载、跨账号请求头隔离与跳转。真实校园账号尚未接入此原型。

## 嵌入接口

```js
import { createCampusGateway } from './src/index.mjs';

const gateway = createCampusGateway({
  allowedOrigins: ['https://learn.tsinghua.edu.cn'],
  token: proxyCredential, // 独立的高熵代理凭据，不能复用 daemon 的管理凭据
  session: {
    epoch: () => authoritativeSession.epoch(),
    assertCurrent: epoch => authoritativeSession.assertCurrent(epoch),
    request: (url, init) => campusRequest(url, init),
  },
  tls: (hostname, options) => certificateProvider(hostname, options),
});

const { host, port } = await gateway.listen({ port: 0 });
// host 固定为 127.0.0.1。调用者负责明确授权与生命周期。
// await gateway.close();
```

示例中的 `authoritativeSession`、`campusRequest` 和 `certificateProvider` 是宿主必须提供的接口，不是本包创建的全局对象。正式连接必须使用当前账号权威运行时，不能通过读取 Cookie 快照另开登录实例。

客户端使用 `Proxy-Authorization: Basic base64("onethu:" + token)`。该凭据只用于 loopback 原型；局域网版本必须另行提供加密配对与设备鉴权。当前原型不提供免交互的系统凭据安装流程。

`certificateProvider(hostname, { signal })` 返回 `{ key, cert }`，证书须覆盖被允许的主机，并由客户端显式信任。提供器应遵守取消信号，不得向共享 CA 私钥文件写入，也不得为未授权目标签发证书。CONNECT 认证和目标校验先于证书调用。没有 TLS 提供器时，CONNECT 明确返回不支持。

## 上游会话适配契约

- `request(url, init)` 返回标准 Fetch `Response`，只发出一跳请求；`init.redirect` 为 `manual`。最终应用场景由浏览器发起后续请求，再次经过目标校验。
- `init.body` 有内容时为可流式消费的 Node Readable，带 `duplex: 'half'`。适配器须消费或取消流，并遵守 `init.signal`。
- 响应内容采用 Fetch 已解压的字节语义。请求优先要求 `Accept-Encoding: identity`；原型移除旧 `Content-Encoding`、`Content-Length`，避免二次解压或错误长度；`preserveResponseBytes: true` 用于阻止 SDK 的文本字符集转换。上游仍返回压缩的 206/Content-Range 时明确拒绝，避免解压后的字节长度与声明范围不符；压缩完整响应的旧摘要和 ETag 会被移除。完整的压缩断点续传需要后续原始编码字节传输。
- 学校 Cookie 和服务令牌保存在权威会话中；代理不会转发浏览器 Cookie/Authorization、向浏览器导出 `Set-Cookie`，或公开 `x-onethu-*` 内部头。依赖 `document.cookie` 或客户端业务令牌的服务仍需后续专项适配。
- 账号变化必须改变 epoch。原型在响应开始和每个输出块检查 epoch，禁止旧账号响应继续输出。适配器还应立即取消在途上游工作。
- 业务适配器负责明确的直连/WebVPN 路由、完整逻辑目标验证和服务策略。现有 WebVPN URL 编码对非默认端口的处理未经验证，因此原型拒绝非默认端口。
- 不自动重试请求。即使方法为 GET，也不能假定校园端操作没有副作用。

## 当前协议边界

精确 origin 授权、代理身份、HTTP Host、CONNECT authority 与 TLS SNI 共同限定目标。HTTP origin-form 请求不能当作未授权本地 API 使用。跨站 Fetch Metadata、不匹配 Origin，以及两者均缺失的请求会被拒绝，避免自动共享 Cookie 后丢失浏览器原来的跨站保护。CONNECT 握手本身不要求页面来源，隧道中的每次 HTTP 请求都要求。

普通 HTTP 网页及部分客户端可能缺少这些来源信息，目前会得到 `GATEWAY_PROVENANCE_REQUIRED`；后续需要明确的客户端授权上下文方案，不能直接放开以换取兼容。程序化测试客户端显式提供来源头。仅缓存了代理密码并不意味着网页可以借用学校会话。

响应禁止浏览器持久缓存，防止换账号后继续展示旧账号页面。请求/响应采用流与背压，大小和超时限制明确报错，超限不会伪装成完整下载成功。连接关闭会取消关联上游任务。

WebSocket、HTTP/2、HTTP/3、真实校园 SSO 跨域兼容、完整 Cookie SameSite 模拟、动态 CA 签发、系统代理/PAC/TUN 以及 LAN 均未在此原型中完成。代码和测试通过仅代表协议原型通过，不代表这些场景已覆盖。
