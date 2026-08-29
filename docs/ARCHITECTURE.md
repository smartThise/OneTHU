# OneTHU · 架构

## 分层

```
┌──────────────────────────────────────────────┐
│  apps/desktop (Tauri 2 + React)              │  ← 界面：纸面墨线，信息密度真实
│  apps/mobile  (RN，规划中)                    │
├──────────────────────────────────────────────┤
│  @onethu/core                                │  ← 唯一数据层
│   auth/    CAS 登录 · ticket 漫游 · 凭证存储   │
│   crypto/  SM2 国密 · WebVPN AES-CFB 编解码   │
│   learn/   网络学堂客户端                      │
│   info/    信息门户/教务客户端                  │
│   http.ts  可插拔 fetch + CookieJar + 自动重登 │
├──────────────────────────────────────────────┤
│  传输层（按运行环境注入）                       │
│   · 直连（校园网 / Tauri plugin-http）         │
│   · WebVPN（core 动态编码 URL，校外可用）       │
└──────────────────────────────────────────────┘
```

## 关键决策

1. **core 不依赖 DOM/RN**：fetch 与凭证 IO 都以接口注入（`FetchLike` / `CredentialStore`），
   同一份 core 跑桌面、移动、Node 脚本。
2. **WebVPN 是传输开关不是另一套代码**：`HttpClient.withWebVPN(true)` 后所有请求自动编码，
   Cookie 按"真实域"记账（解码后归属），切换直连/代理零成本。
3. **诚实的数据层**：任何接口失败都抛出带语义的错误（`AuthRequiredError` / `CasError`），
   UI 只做如实展示，不生成假数据；演示数据独立在 `demo/`，显式进入。
4. **API 结论先写文档再写代码**：docs/API-NOTES.md 是唯一事实来源，改动需同步。

## 端上路线

- desktop：Web 预览（本轮）→ Tauri 2 壳（窗口/托盘/钥匙串/开机自启）
- mobile：复用 core + RN 新架构，优先 今日/课表/作业 三场景
- 网络异常优先级：直连失败自动尝试 WebVPN（可关）
