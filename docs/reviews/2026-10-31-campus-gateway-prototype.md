# 校园超级代理首轮原型验收

日期：2026-10-31。分支：`web`。范围：`packages/gateway` 的本机 HTTP/1.1 与 CONNECT/TLS 协议入口。

## 已完成

- 独立、默认关闭的实验包，仅显式调用 `listen()` 时监听 loopback。
- 精确目标授权、独立代理身份、CONNECT/Host/SNI 一致性校验。
- 注入式权威会话接口、请求和响应流、账号 epoch 校验、超时与取消。
- 自动拒绝不支持的协议/目标、缺少来源的请求和超限数据；不自动重试写入。
- 不转发浏览器的另一账户 Cookie/Authorization，不向浏览器输出学校 Cookie 或内部票据头。

本轮未接入真实账号或运行中的 GUI/CLI daemon。系统代理、系统 CA、自动启动和局域网监听保持原状。

## 独立审查修复

| 问题 | 影响 | 修复与验证 |
| --- | --- | --- |
| 来源头缺失仍借用共享会话 | 缓存的代理密码可随跨站 HTTP GET 自动发送，无法证明操作来源 | 缺少 Origin 与 Fetch Metadata 时拒绝；CONNECT 握手例外，内层请求逐条检查。HTTP/HTTPS 拒绝回归测试通过 |
| 透传浏览器 Authorization | 旧账号令牌可能覆盖权威 Cookie 账号，造成混用 | 与浏览器 Cookie 一并剥离；协议测试和实际 Chrome POST 验证 |
| Fetch 解压后的 206 仍保留编码前 Content-Range | 下载范围声明与实际字节数不符，影响断点续传完整性 | 优先请求 identity；压缩部分响应显式拒绝；正常未编码 206 保留范围；压缩完整响应移除旧摘要/ETag。真实 loopback gzip 上游回归测试通过 |

此外，实现审查修复了 Headers 迭代删除、启动即关闭、迟到响应取消、证书等待超时、下载首块超限错误及超时竞态。代理不会以成功状态静默完成已截断的数据流；若响应已开始后出错则断开流。

## 验证结果

### 协议集成测试

命令：`pnpm test:gateway`。

结果：24 / 24 通过。实际建立本机 HTTP、TCP CONNECT 和 TLS 套接字，覆盖：

- 代理鉴权及未授权请求无上游副作用。
- URL/Host/端口/userinfo/目标后缀绕过、CONNECT/Host/SNI 混淆。
- 跨站来源、缺失来源和不同账号 Cookie/Authorization 的隔离。
- TLS 客户端仅信任本次临时测试证书，TLS 未配置时明确拒绝。
- 二进制与旧字符集字节保留、Fetch 解压 metadata、正常和压缩部分响应。
- 单跳重定向、流式上传、不重试写入、已知长度/分块上传与下载上限。
- 超时、不合作的上游 promise、证书等待、关闭取消、响应前与流中的账号切换。

### 真实浏览器

命令：`node packages/gateway/test/browser-smoke.mjs`。

环境：macOS，Chrome `156.0.8078.74`，独立临时 Playwright 浏览器配置。无浏览器扩展。浏览器设置仅该进程的显式代理和测试证书 SPKI 信任例外。

结果：通过代理打开本机模拟的 `https://learn.tsinghua.edu.cn/`，成功完成 HTML 导航、同源 POST、二进制下载与 302 跳转。检查了浏览器原生 `Sec-Fetch-Site: none/same-origin`，验证浏览器设置的旧 Cookie/Authorization 没有进入上游适配器。

所有响应来自本机 fixture；没有请求学校服务，没有登录、预约或提交真实业务。测试证书在临时目录生成并删除，没有安装到系统。此验收证明协议入口和 Chrome 链路可行，不证明真实校园网站、小程序或整机覆盖已完成。

## 后续实际接入条件

- G1：在既有会话拥有者中挂载代理流通道，保持 GUI/OH/CLI 的单一会话权威。
- G2：验证校园原网址与 WebVPN 改写、Cookie/CSRF、跨域 SSO、业务 token、附件和 Service Worker 缓存语义。
- G3：实现系统授权、独立 CA、安全存储、代理配置的冲突处理及可恢复卸载流程。
- G4–G6：手机/微信逐服务验证，补齐其他协议及本人设备的加密配对。

原型对缺少来源信息的普通 HTTP 浏览器请求、压缩断点续传、WebSocket、HTTP/2/3 均未宣称兼容。覆盖状态继续按实施计划中的矩阵维护。
