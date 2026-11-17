# i18n 接入后的账号、权限与诊断边界审查


> 归档说明：本文记录当时的代码审查与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

日期：2026-10-20。审查范围涵盖当前工作树中的 TypeScript 运行时、云盘账号生命周期、组织协同与私密分享协议，以及网络诊断日志出口。全过程均在离线隔离环境下完成，未请求学校线上 API、未读取真实用户日志，也未改动真实账号或远端权限配置；原生层文件权限、HTML 预览清洗及核心客户端解析详见各自的专项报告。

## 已复现并修复的问题

### 云盘退出与切换账号时的旧状态回填

原实现中，退出云盘账号时未同步清空内存目录缓存，而 `openDir` 又优先读取缓存再检查登录态，导致退出后在缓存 TTL 窗口内访问同一路径仍会读出上一账号的文件名；同时配置初始化在文件读取返回前便提前置为完成，且早先发出的配置读取、自动连接、目录列举与资料库查询请求若延迟返回，还会把旧账号数据写回已登出或已切换的新账号名下。

本轮在 `apps/desktop/src/state/seafile.ts:25` 起引入了配置加载 single-flight、凭据世代号（generation）与串行持久化队列：

- 退出登录时立即清空账号信息、资料库列表、目录缓存与加载状态，目录查询入口改为先校验当前有效账号。
- 所有跨世代延迟返回的旧账号信息、目录项、资料库列表与文件预览响应一律直接丢弃。
- 连接云盘时先完成服务端账号核验，再经严格文件接口落盘保存；若磁盘写入失败则直接返回连接错误。
- 退出登录时一并清理新旧两处配置文件路径；即使此前仍有挂起的写入任务，排在后面的删除操作也会按序执行到底，且后续若出现连接失败也依然保持已清理状态。
- 配置文件读取若遇瞬时错误支持后续重试，并发初始化调用则共享同一次完整读取过程。

运行 `tools/seafile-account-lifecycle-test.mjs` 直接测试真实的 `seafile` 状态模块（仅在原生命令、文件读写与 React 订阅边界接入轻量替身），全部 9 项断言通过，覆盖延迟响应拦截、并发初始化合并、落盘与登出交错、重连失败清理保持、切号缓存隔离及磁盘写入报错。测试采用本地合成账号验证状态机逻辑，线上双账号实测留待联调阶段进行。

### 诊断日志中的 Cookie、认证 URL 与页面正文脱敏

此前 `transport.ts` 的逐跳网络日志会将新下发 Cookie 的 `name=value` 截断后写入日志文件，`clients.ts` 中的 `InfoClient.onDebugDump` 也会把学校网页 HTML 分块写入磁盘。由于会话凭据或个人信息往往位于字符串前段，单纯按长度截断仍存在泄露隐患，需要从结构与字段层面彻底脱敏。

本轮新增 `apps/desktop/src/lib/networkLog.ts` 统一收口日志脱敏规则：

- 逐跳网络日志仅记录合法的 Cookie 名称，彻底剥离 Cookie 值。
- 日志与界面可见报错中的 HTTP URL 自动剥离用户名、密码、查询参数（query）与锚点片段（fragment），仅保留 `origin` 与 `path` 供定位路由。
- `clients.logLine` 集中遮蔽结构化认证字段、`Bearer` 令牌、网页特征标记及 `body` 正文片段。
- 完整学校网页的调试钩子改为仅记录响应字符长度，停止将页面原文分块落盘。
- 云盘静默连接失败时不再摘录未知 profile 页中的 token 上下文或内联脚本，避免未来页面改版引入新格式凭据时发生漏网。
- `diagnostics.redactDiagnostics` 统一复用上述清洗管线，同时保留原有的邮箱地址与长串数字遮蔽逻辑；前端网络错误弹窗与超时提示也一并去除了带认证参数的 query。

运行 `tools/network-log-privacy-test.mjs` 全部 20 项断言通过，使用合成的 Cookie、OAuth/CAS 跳转 URL、JSON 载荷、网页正文与报错文本逐一验证过滤效果及真实诊断出口接线。脱敏仅作用于日志与错误展示出口，实际发出的网络请求 URL、Cookie 与响应解析均保持原样。

## 权限与协同协议复核

- `state/orgSync.ts:23` 的受保护分支检查继续拦截预期外的个人、群组或部署密钥写入授权；私有群组归属、元数据仓库归属与成员角色一律以服务端实时返回为准。本轮国际化改造完整保留了所有权限枚举值、分支名称与底层协议字段。
- `state/orgSyncCore.ts:89` 起先审计独立授权路径，成员变动与资源降权均经服务端回读确认；一旦进入撤权流程便持续推进重试，若撤权中途出错则暂停后续新增授权并保留可重试的 `pending` 状态。
- `state/orgSync.ts:75` 与 `:163` 的远端修订号比对及乐观并发提交逻辑保持完好，遇到远端更新冲突时会阻止本地过期副本覆盖云端数据。
- `state/sealedShare.ts:26` 与 `:43` 继续为每份私密分享生成独立随机密钥与 AES-GCM 随机 IV；读取解密密钥时由云端服务端核验当前登录账号对密钥资料库的访问权限，前端展示的邮箱文本仅作界面提示；协议版本号、`kind`、`/key.json` 路径及加密算法标识均未受多语言提取影响。
- `tools/org-collaboration-test.mjs` 全部 38 项断言通过，在本地模拟网关配合下完整验证了上述权限状态机；真实 GitLab 与清华云盘的双账号线上联调留待具备双测试账号后执行。

## i18n 运行时与设置导航验收

以下测试专门验证国际化运行时机制、弹窗宿主状态与设置导航稳定性：

| 验收 | 结果 | 覆盖 |
| --- | --- | --- |
| `tools/i18n-runtime-test.mjs` | 29 项 | 变量插值、花括号字面转义、缺参兜底、CLDR 受限复数、`Intl` 格式化、语言回退、惰性数组与跨窗口通知 |
| `tools/i18n-runtime-browser-test.mjs` | 17 项，自然退出 | 真实 React/OneGUI 确认框、输入框弹窗、表单与 Toast；切换语言保持输入框挂载与已填草稿，同步更新 `document.lang` 及跨窗口状态 |
| `tools/i18n-settings-routing-test.mjs` | 12 项 | 界面展示译文切换、稳定的 `tab/section/row` 定位 ID、搜索词条 getter 动态求值 |
| `tools/settings-search-coverage-test.mjs` | 通过 | 63 个设置注册项、196 个检索别名与 10 个页面落点标记 |
| `tools/search-landing-test.mjs` | 通过 | 63 个注册路由家族的模型级跳转校验（真实浏览器点击由端到端界面测试套件覆盖） |
| `tools/i18n-security-boundaries-test.mjs` | 15 项 | 验证切换译文后分享口令字节流、导入目标路径与原生错误码识别完全恒定，二次认证提示按调用时语言动态解析 |
| `tools/mail-state-test.mjs` | 23 项 | 既有邮箱状态机全量用例接入真实词典运行时后继续保持通过（含缓存读取失败等异常分支） |

设置中心分类定位现已切换为声明式的 `data-settings-tab` 与 `data-settings-section` 属性，搜索结果跳转优先匹配稳定的 `row.id`，彻底告别根据翻译后 DOM 文本反推定位 ID 的做法；两处旧版组织设置搜索入口也已对齐至通讯录下的真实组织页面。`Confirm`、`Form` 与 `Toast` 统一采用消息描述符在展示期动态解析，插件或用户传入的自定义文本则原样呈现。

## 当前防护范围与已知边界

1. **本地凭据存储形态**：`clients.obfuscateSecret` 采用的 XOR 处理仅用于基础文本混淆；本轮完成的账号缓存隔离与目录权限收紧重点减少误读与残留，若需防范本机同用户高权限进程读取，后续仍需接入操作系统钥匙串（Keychain / Credential Manager）加密存储。
2. **磁盘异常下的文件擦除**：当文件系统删除报错时，严格文件接口会如实向上抛出错误，同时立即清空内存态凭据；由于业务上层保留了保障退出流程顺畅的异常捕获，若遭遇极端磁盘故障，本地旧凭据文件仍可能残留，此时由操作系统用户目录权限提供基础隔离。
3. **切换账号时的存量文件与在途请求**：切换账号会即时阻断旧请求响应写回内存状态；此前已下载至本地磁盘的用户文件以及远端服务器正在处理的单次请求则按各自固有生命周期结束。
4. **日志脱敏的适用面**：`networkLog` 针对已知认证头、结构化凭据键名与网页正文做规则化遮蔽；各业务模块仍须遵循“源头免记敏感数据”的原则，且诊断日志中保留的课程名等上下文信息仅供排障参考，对外分享前仍建议用户审阅。原生侧日志与核心 `HttpClient` 的脱敏详情可参阅对应专项报告。
5. **URL 路径段保留策略**：为便于排查接口故障，脱敏后的 URL 会保留 `origin` 与 `path`；若个别外部服务将临时分享令牌直接编码在 URL 路径段中，调用方需在写日志前先行裁剪。
6. **待后续阶段开展的联调与审校**：本轮测试全部基于本地隔离替身与合成数据运行；真实双账号权限联调、远端服务故障注入、系统钥匙串接入以及英文词典的母语级审校将在后续发版周期内逐步推进。

## 生产依赖安全复核

本轮修复前运行 `pnpm audit --prod` 检出 `2 high, 1 moderate, 1 low`；升级加固后降为 `0 high, 1 moderate, 1 low`，全程未添加任何审计忽略规则，剩余两条中低危上游通告均已核明触发路径并留档跟踪：

- **SheetJS（已升级修复）**：应用内文件预览会直接读取并解析用户打开的 XLSX 表格，处于真实受影响路径上。现已按官方指引切换至官方 CDN 锁定的 `xlsx-0.20.3.tgz` 并在 lockfile 中固定 SHA512 完整性校验（npm 官方源上的 `xlsx` 长期停留在旧版；上游自 `0.19.3` 起修复原型污染，自 `0.20.2` 起修复正则回溯 ReDoS）。参考：[官方安装说明](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)、[原型污染公告](https://cdn.sheetjs.com/advisories/CVE-2023-30533)、[ReDoS 公告](https://cdn.sheetjs.com/advisories/CVE-2024-22363)。
- **Quill（保留低危通告，应用层已阻断触发面）**：官方仓库与 npm 最新稳定版仍为 `2.0.3`，通告涉及 `formula` 与 `video` 两种内嵌 blot 在导出 HTML 时的属性逃逸。在隔离浏览器中以默认配置可复现恶意属性进入导出字符串；而本应用内的两处编辑器均显式配置了严格的格式白名单（未启用 `formula` 与 `video`），实测调用插入 API 与富文本粘贴探针均会直接剥离这两类节点，且下游展示层还会再经 `sanitizeDisplayHtml` 二次清洗。该通告原样保留在依赖审计中以便持续关注上游新版本；日后若放开上述两种 blot 或新增未清洗的直出渲染路径，须重新评估。参考：[官方发行](https://github.com/slab/quill/releases)、[研究者原始披露](https://fluidattacks.com/advisories/diomedes)。
- **sprintf-js（保留中危通告，未进入浏览器运行时产物）**：依赖链为 `Mammoth → argparse → sprintf-js 1.0.3`。目前 npm 最新 `sprintf-js 1.1.3` 仍在通告影响范围内，且最新 `Mammoth 1.13.0` 依旧依赖旧版 `argparse`。核查安装源码可见，`argparse` 仅被 Mammoth 的命令行入口脚本引用；按前端真实浏览器条件打包文档转换入口、Quill 与公共清洗模块后，生成的模块依赖图中完全不含 `argparse` 与 `sprintf-js`，DOCX 预览转换运行正常。应用运行时从不调用 Mammoth CLI，同时保留原始依赖声明以便后续跟进上游升级。参考：[上游问题](https://github.com/alexei/sprintf.js/issues/237)、[Mammoth 官方依赖](https://github.com/mwilliamson/mammoth.js/blob/master/package.json)。

专项脚本 `tools/dependency-preview-security-test.mjs` 的 13 项检查以退出码 0 通过：测试浏览器全程阻断外部网络，使用本地合成的 XLSX/DOCX 样本与无害属性探针验证预览链路安全，未接触任何真实用户文档。面对极端体积或深度嵌套的畸形 Office 文件时，内存与解析耗时仍受底层解析库自身能力约束，后续可结合文件大小上限与 Worker 隔离进一步加固。

## 复现命令

在仓库根目录依次执行：

```sh
node tools/seafile-account-lifecycle-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/network-log-privacy-test.mjs
node tools/dependency-preview-security-test.mjs
pnpm audit --prod
node --import ./tools/ts-resolve-register.mjs tools/org-collaboration-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/i18n-runtime-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/i18n-settings-routing-test.mjs
node tools/i18n-security-boundaries-test.mjs
node tools/mail-state-test.mjs
node tools/settings-search-coverage-test.mjs
node tools/search-landing-test.mjs
pnpm --filter @onethu/desktop typecheck
```

浏览器端运行时交互验收需先启动本地开发服务器，再按 `tools/i18n-runtime-browser-test.mjs` 文件头说明传入环境变量执行（全程运行在隔离浏览器上下文与合成测试数据之上，无需登录真实账号）。
