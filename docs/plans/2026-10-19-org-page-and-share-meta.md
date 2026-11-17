# 组织主页 + 分享口令改名/限定邮箱（2026-10-19 晚）


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 用户口径：
> - 「口令应该可以改名，可以设定某个用户邮箱才有权限接收」；
> - 「组织不能只是一张卡片，而是一个完整的页面，可以创建或者关联 gitlab 仓库、
>   共享资料库（不只是文件夹！），成员也都是具体邮箱关联的而不只是一个名字。
>   总之，是一个可以真正处理的组织架构」。

## 一、分享口令（暂存箱）

在 `state/vaultShare.ts` 的分享载荷中新增两个随口令同步的元数据字段：

| 字段 | 含义 |
| --- | --- |
| `label` | 口令名称（由发送方自定义命名，接收方导入时直观可见） |
| `allowEmail` | 指定接收人邮箱；设置后仅限已登录该清华云盘邮箱的账号打开 |

- 本地分享台账 `state/vaultShareLog.ts` 为每条记录补充 `label` 与 `allowEmail` 字段；「已发出的口令」管理面板（`components/vault/IssuedSharesCard.tsx`）新增**改名**与**限定邮箱**两项操作。
- 就地更新保持原口令编码不变：调用 `updateShareMeta(code, patch)` 解析云端清单 → 更新元数据字段 → 通过 `VaultCloudAdapter.update(ref, payload)` 先完整读取再将更新后的 `manifest.json` 写回原分享目录，完整保留原有条目列表。对于早期离线生成的内联长口令，界面会清晰提示重新生成新口令以启用云端权限控制。
- 接收端在 `importShareCodeAsCurrent` 中设立双重校验：① 短码初步解码后立即核对；② 拉取到云端权威 `manifest.json` 后再次核对，确保发送方事后追加或修改的邮箱限制同样即时生效。接收方身份取自当前已连接的清华云盘账号邮箱；若本地缓存邮箱与 `allowEmail` 不一致，会先主动向云端刷新一次真实账号信息再作判定。
- 补齐短码解析透传（`cloudExchange.resolveExchangeCode`），在原有的 `name` 与 `cloud` 之外一并携带 `label`、`allowEmail` 与 `expiresAt`。

## 二、组织完整主页（`page=org`）

新增一级路由页面 `page=org`（接收 `navParams.orgId`，可从通讯录「我的组织」列表行、名片夹中的组织名片或全局搜索进入）。

主页采用多页签工作区结构（`pages/Organization.tsx`）：

- **概览**：集中展示成员总数与已绑定邮箱人数、负责人、已关联的云盘资料库与 GitLab 仓库、加入方式、最新邀请口令（支持改名、限定接收邮箱与展示二维码）、组织名片预览以及删除本地组织记录入口。
- **成员**：管理成员真实的清华云盘邮箱（支持新增、编辑与按邮箱自动去重）及角色分工（负责人 / 成员 / 访客），提供「将资料库一键共享给全体成员」快捷操作。
- **资料库**：直接绑定独立的清华云盘**资料库（repo）**——支持新建资料库（`seafile_create_repo`）、关联已有资料库、按成员邮箱开通资料库根目录共享（`seafile_share_folder_to_user`）、复制 7 天分享链接、通过云盘页深链接（`navParams.cloudRepo`）直达浏览，以及解除本地关联（云端原资料库完整保留）。
- **GitLab**：支持新建代码仓库（`POST /api/v4/projects`）、按 `group/project` 路径关联既有仓库（`GET /api/v4/projects/:encoded`）、在应用内直达打开仓库（`navParams.gitlabProject`）及解除本地关联；`info-lib` 配套新增 `getGitProjectByPath` 与 `createGitProject`（复用既有 Cookie + CSRF 写入通道）。
- **项目 / 公告**：完整承接原组织工作区的项目协作与公告板功能，升级为独立整页标签。
- **组织邀请口令**：支持自定义名称与限定接收人邮箱（记录于 `org.invite`）；同一组织在有效期内复用固定短码，修改名称或限定邮箱时直接就地更新云端清单（固定槽位 `org:<id>`）；接收方通过云盘邮箱核验后自动以该邮箱身份加入组织成员列表。

数据模型（`state/org.ts`）新增 `OrgMember.email`、`Org.libraries[]`、`Org.gitlabRepos[]` 与 `Org.invite`；存量本地数据在加载时平滑补齐默认空值，历史记录完整保留。原先的弹窗式 `OrganizationWorkspace.tsx` 正式退役，在名片夹中点击组织卡片即可直接进入完整的组织主页。

## 三、测试与证据

- `node tools/org-browser-test.mjs` → 21 条断言通过（基于模拟云盘串联测试：创建组织 → 进入完整主页 → 维护成员邮箱 → 限定邀请邮箱并复用短码 → 新建资料库并按邮箱共享 → GitLab 页签入口 → 删除组织）。
- `node tools/vault-browser-test.mjs` → 48 条断言通过（新增口令改名后解码核验、限定接收邮箱后非目标账号拦截与目标账号正常导入）。
- `node tools/namecard-browser-test.mjs` → 14 条断言通过（验证点击名片夹组织卡直达组织主页）。
- `experience`、`short-share`（49 条）、`schedule`、`mobile-vault`（14 条）与 `feedback-repairs` 回归套件全部绿灯，全量 `pnpm guard`（含 `typecheck`）通过。
- 归档截图：`docs/onegui/experience-mode/org-page-{overview,libraries,phone,phone-overview}.png`。

## 四、阶段性范围说明

- GitLab 新建与关联操作依赖在线的校内 GitLab 登录会话（本地自动化环境重点验证前端表单与路由骨架）。
- 云盘资料库创建与按成员共享依赖有效的云盘令牌，未连接时页面会自动展示「去连接云盘」引导按钮。
- 暂存箱普通分享口令采用生成时设定的 7 天有效期（可在台账中随时查看；组织邀请口令的自定义有效期已在下方第五节补齐）。

## 五、2026-10-19 续：自动共享 / GitLab 组织 / 页内预览 / 口令有效期与删除

### 成员权限自动同步（云盘与 GitLab）
- 新建或关联云盘资料库时，自动遍历当前组织成员邮箱开通资料库根目录共享（`seafile_share_folder_to_user`），已共享过的成员自动跳过避免重复请求；成员页同时保留「同步云盘与 GitLab 权限」一键全量对齐按钮。
- 新建或关联 GitLab 仓库、新增成员或更新成员邮箱时，自动按邮箱检索校内 GitLab 用户（`GET /users?search=`）并加入对应的 GitLab Group 与仓库（成员授予 `30 developer`，访客授予 `20 reporter`；已在组内返回 `409/400` 时自动视为成功；未检索到对应账号的邮箱会提示手动邀请）。

### 一键创建 GitLab 组织并自动邀请成员
- 数据模型新增 `Org.gitlabGroup`（`id / name / path / webUrl`）：首次点击「建 GitLab 组织与仓库」时，先调用 `POST /groups` 创建对应的 GitLab Group（默认沿用组织名称并自动生成 URL slug），自动邀请全体成员加入该 Group，随后在该 Group 命名空间（`namespace_id`）下创建首个项目仓库；后续继续添加时则直接显示「在组织下新建仓库」。
- `info-lib` 配套新增 `createGroup`、`addGroupMember`、`searchUsers` 与 `addProjectMember`。

### 页内直接预览云盘文件与 GitLab 项目
- 资料库卡片新增「预览文件」：展开内联目录树（调用 `openDir`，支持逐级进入子文件夹与刷新）并配备文件预览弹层——纯文本直接排版渲染、图片转为 Data URL 即时展示，其他格式或大体积文件提供「下载到本机」按钮（基于 `seafile_read_bytes` 内存流读取）。
- GitLab 仓库卡片新增「预览项目」：内联展示仓库简介、默认分支、可见性、Star 数、开启中的 Issue 数量与最近动态；云盘与 GitLab 卡片均附带「浏览器打开」外部直达按钮。

### 组织页入口收口（统一携带 `orgId` 进入）
- 移除无上下文的独立「组织」搜索原子与功能目录入口，统一从通讯录组织列表或名片夹组织卡携带具体 `orgId` 进入。
- 恢复持久化标签页时自动过滤缺少 `orgId` 的历史空白标签；若 `orgId` 对应的本地组织已被移除，页面展示清晰的「找不到这个组织」提示与返回出口，同时提供「用邀请口令加入」快捷入口。

### 组织邀请口令：支持修改有效期与彻底删除
- 扩展 `publishExchangeCode(code, contentKey, slot, { expireDays, forceNew })`，让 `uploadExchangeManifest(code, expireDays)` 支持灵活传入有效天数（传 `0` 代表长期有效）。
- 由于云盘分享链接的到期时间在创建时由服务端绑定，修改邀请口令有效期时会自动先调用 `revokeShareSlot` 注销旧分享链接、清空槽位与内容缓存，再按新有效期重建分享并签发新短码；若有效期保持不变（2 小时容差内），则继续就地更新清单并复用原短码。
- 组织主页邀请设置支持选择 `1 天 / 7 天 / 30 天 / 不过期`，概览页直观展示到期时间；点击「删除口令」会同步撤销云盘分享链接并清空本地 `invite` 与 `lastInviteCode` 记录。

### 补充回归验证
- `org` 浏览器回归扩展至 28 条全部通过（新增新建资料库自动按成员邮箱共享、云盘文件页内目录与文本预览、修改有效期自动轮换新短码、删除口令同步清理本地记录与云端分享），`namecard`（14 条）、`experience`、`mobile-vault`、`feedback` 等套件及全量 `pnpm guard` 全部绿灯。
- 新增归档截图：`org-page-*`、`org-lib-preview-list/text.png`。
