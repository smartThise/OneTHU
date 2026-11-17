# 联网短口令 · 收尾记录（2026-10-19）

> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../../README.md)（[English overview](../../en/index.md)）。


> 最后更新：2026-11-18 01:30

接手 `026a3f1b` 留档提交（含 `shortCode`/`cloudExchange` 主体与各入口改造，当时已通过类型检查、待补充端到端验收），结合用户反馈完成收尾。本目录归档本轮验收报告与界面截图。

## 用户原话与对应处理

| 用户反馈 | 根因 | 处理 |
|---|---|---|
| 「网盘仓库里存了一堆口令重复生成，一个个人名片无数口令」 | 每次分享都新建 manifest + 新分享链接 | 发布去重 + **稳定分享位**：内容没变复用旧短码；名片/组织就地覆盖同一个目录 |
| 「还一个都识别不了」 | ① 用户跑的是 10-11 安装包，缺 `seafile_share_read` 命令（10-18 才注册）；② 「导入口令」只认 ONV1/ONV2；③ 重复收名片被通讯录去重误报成失败 | ① 需 dev 应用/重打包；② 统一接收入口按类型分发；③ 明确回报「本地已有」 |
| 「名片更新的时候考虑到了吗」 | 旧设计每次更新=新口令+新目录，旧口令指向旧内容 | 稳定分享位：口令不变，manifest 就地覆盖，对方读到的永远是最新名片 |
| 「暂存箱那两个小形态也得能直接粘贴口令或者扫码」 | 雷达/抽屉只有复制口令和 NFC | 两个小形态都加「收口令 / 扫码」 |
| 「电脑上却是手机排版」「1256×596 也被判手机」 | `isPhoneViewport` 只看短边 <600，桌面窗压矮即误判 | 改为「宽<600 算手机；高<600 且宽≤960（横屏手机上限）才算手机」 |

## 这一轮改了什么

### 1. 短码编解码（`lib/shortCode.ts`）
20 位十六进制分享凭据 ↔ 16 位 Base32 无损互转，四位分组加 `ON-` 前缀共 22 字符，**长度与内容大小无关**（大头像完整保留原图，内容统一走云盘 manifest）。支持大小写、空格与连写容错，自动纠正 Crockford 形近字符（O→0、I/L→1）；遇到非标准凭据则采用 `ONX.<token>` 全量保留完整随机熵。目录分享被云盘策略拒绝时自动降级为直接分享 `manifest.json` 文件（`/f/` 链接），两种链接形态均可编解码为短码。

### 2. 发布去重与稳定分享位（`state/cloudExchange.ts`）
`publishExchangeCode(code, contentKey, slotName)` 采用两层机制：若内容摘要未变且旧口令仍可匿名读取，直接复用原短码；名片与组织则按 `slot` 复用同一个云盘目录并就地覆盖 `manifest`（`vaultCloud.updateExchangeManifest`）——口令恒定不变、对方读取到的始终是最新内容，反复修改名片也不会新增多余目录。暂存箱与碰一碰组合采用快照语义，按内容摘要缓存，箱体复用 `lastShareCode`（箱内发生任何变更时自动清空，见 `vault.ts`）。

### 3. 统一接收入口（`lib/contentExchange.ts`）
`receiveExchangeCode(text, vaultTarget)` 统一识别所有口令类型：暂存箱（ONV1/ONV2/短码）、名片与碰一碰组合（ONTOUCH1）、组织邀请（ONORG1）。`vaultTarget` 保持两类既有入口的交互习惯：`current` 替换当前暂存箱（对应「导入口令」与「收碰一碰」），`new` 存入新建暂存箱并保留原箱（对应扫码、NFC、雷达、抽屉与直接交换）。所有接收入口均统一收敛至该函数。

### 4. 小形态直接接收（`lib/useVaultReceive.ts`）
抽出共用的「收口令 / 扫码」hook：粘贴口令唤起表单弹窗，扫码调用系统选图配合 `BarcodeDetector` 识别。雷达面板（`VaultDropTarget`）与暂存箱抽屉（`VaultSheet`）同步挂载该入口，与整页交互保持一致。

### 5. 平台判定修正（`state/platform.ts`）
`isPhoneViewport()` 由原先的「短边 <600」调整为「宽 <600，或高 <600 且宽 ≤960」，避免将 1256×596 这类压矮的桌面窗口误判为手机，仅将真正的横屏手机视口（如 844×390、932×430）归入手机布局。`pnpm platform-test` 新增 11 条边界断言覆盖该规则。

## 验证

- `pnpm --filter @onethu/desktop typecheck` ✓、`pnpm guard` 全绿 ✓（含 ui-copy / onegui 棘轮 / css 配平 / 文档规范检查）。
- `tools/short-code-test.mjs` — **57** 例（编解码往返、定长 22 字符、大小写/分隔符/形近字符容错、旧前缀区分、500 次随机抽样零碰撞、链接形态校验）。
- `tools/short-share-browser-test.mjs` — **50** 例，见 [report.json](report.json)。基于模拟云盘启动**两个独立客户端**：发送方 A 已连接云盘，接收方 B 为未登录云盘的全新本地状态（同一 BrowserContext 下两个隔离页面，仅通过模拟云盘共享公开链接）。覆盖：短码生成与二维码、未改动暂存箱复用同一口令、名片更新后口令保持且读取到最新内容、组织重复邀请复用、文件分享降级路径、接收方 B 免登录匿名导入、在导入口令处粘贴名片短码、重复接收名片提示、大小写与空格容错、兼容旧版 ONV1/ONV2/ONTOUCH1/ONORG1、未连接云盘时的双层引导、过期/撤销/篡改/无效文本拦截，以及雷达新增接收入口闭环。
- 既有五个浏览器测试套件同步适配并通过：`vault-browser-test`（含长按 400ms 拾取时序对齐）、`org-browser-test`（11 例，适配组织迁入通讯录页）、`namecard-browser-test`（7 例）、`mobile-vault-browser-test`（14 例）、`feedback-round2-browser-test`（67 例，超大头像同步改为通过 manifest 传输）。

## 待实机闭环与后续事项

1. **真实云盘跨端互传验证**：用户此前运行的是 10-11 安装包（尚未包含 10-18 注册的 `seafile_share_read` 原生命令）。后续使用最新开发构建（`pnpm tauri dev`）或新安装包，即可在双设备/双账号间实测「发送方生成 → 接收方免连云盘匿名读取」完整闭环。
2. **NFC 硬件互传**：浏览器端使用桥接模拟夹具验证协议逻辑，双机碰一碰实测需在两台具备 NFC 的 Android 真机上完成。
3. **云盘历史文件自动过期**：云盘内早先旧版构建重复上传留下的 6 个历史 `exchange manifest` 满 7 天后将由云盘自动过期清理。
4. **清小搭与 OH 技能互通**：清小搭技能广场接入 OH 侧技能注册与管理作为独立专题，按计划在后续周期推进。

截图：[sender-vault-short-code.png](sender-vault-short-code.png)（发送方口令区，22 字符 + 二维码）、[receiver-anonymous-import.png](receiver-anonymous-import.png)（接收方未连云盘，导入口令成功）、[radar-receive-entries.png](radar-receive-entries.png)（雷达新增「收口令 / 扫码」）。
