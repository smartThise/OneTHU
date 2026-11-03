# 云盘分享页被网关误拦截（2026-11-03）

## 现象与定位

用户从数据结构课程网页打开清华云盘的文件夹分享链接时，浏览器显示 `GATEWAY_CROSS_SITE_REJECTED`。本次在真实 Chrome 中由课程页点击「清华大学讲义最新版」复现；没有使用仅输入分享地址的导航代替点击验收。

网关进程、受信任 CA、系统 PAC 和共享账号均仍在运行。Learn 与 Info 入口可访问，云盘首页也能显示资料库。这些检查不能代表文件夹分享入口可用。

错误来自 `packages/gateway/src/policy.mjs`：同属校园域的课程网页使用 `Sec-Fetch-Site: same-site`，但其来源没有登记为借用学校身份的业务 origin。旧规则仅为少数固定的跨站入口提供用户主动导航例外，云盘分享路径没有匹配。同站点兄弟域的真实点击因此被拒绝。

## 修正与边界

- 将规范云盘文件夹分享入口 `https://cloud.tsinghua.edu.cn/d/<20 位小写十六进制 ID>/` 识别为只读导航入口，不硬编码某一个分享 ID。
- 用户主动的 same-site 与 cross-site 导航采用相同的精确入口判断。只允许 GET / HEAD、无请求体、无 Origin、navigate / document、`Sec-Fetch-User: ?1` 的组合使用这项例外。
- 分享入口必须没有查询或 fragment 标记，包括空 `?`；API、操作路径、额外子路径、异常 ID、表单、嵌入内容和未激活导航继续走原有校验。
- 原有同源 Origin 校验、套接字/当前用户证明、账号代际、CSP、凭据隔离与方法限制保留。诊断只记录 `cloud-folder-share` 分类，不保存分享 ID、URL 或文件名。

## 自动验证与实际部署

- 网关 169 项测试通过。新增正常课程网页/外部来源点击、GET/HEAD、请求参数与路径变体、请求体、Origin、iframe/图片、缺少用户激活、代理认证仍必需等回归。
- 完整构建并逐文件核验后台 artifact：`28ffc01a831c6b508ea6595045cfdd3c95f2826a157c0d465c8e5d13c3569156`，Node v22.22.1。
- 原后台路径 `/Users/st/.local/share/onethu-cli`；原 profile 和 CA 保留，代码备份位于 `/Users/st/.local/share/onethu-cli.before-gateway-1793697973491`。
- 先暂存、校验完整 artifact 并读取全部现有 PAC 端点，再在受保护流程中替换后台。停顿 6.5 秒，四个网络服务 PAC 地址及原系统代理端口保持；GUI 未重启。
- 更新后 authenticated=true、epoch=19、system enabled=true、recoveryRequired=false。没有重新输入凭据、登记信任设备或触发二次验证。

## 实际验收

1. 在原复现用 Chrome 标签页返回课程网页，再点击同一个讲义入口。云盘分享页正常显示三份 PDF 文件，未下载或打开文件正文，也未点击保存/ZIP。
2. 相同 TLS 网关入口的真实 same-site 点击请求由 403 变为 200；未激活的跨站请求仍返回 403。
3. Learn 和 Info 入口通过原系统监听返回 200；两项证明入口可达，业务级结果以真实浏览器页面为准。
4. 经原 Clash 出口的 WebDAV 匿名 HEAD 返回预期 401（未提供 DAV 凭据，仅证明 TLS/HTTP 可达），普通外网 HEAD 返回 200。未修改 Clash、订阅、节点、TUN 或 DAV 账号，也未卸载挂载。

浏览器验收图仅保存在本机 `/Users/st/Documents/Codex/2026-11-03/onethu-gateway/cloud-share-fixed.jpg`，不加入源码。本轮没有发布三端安装包、修改 main 或更新官网的固定文档基线。
