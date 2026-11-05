# feat(life,dev): 电费余额恢复 / 更新源探测 / 洗衣机类型图标

> Base：`dev3`（`cfeaac4b`）  
> Branch：`xiao-dreamr:feat/life-washer-dev-sources`

## 1. 宿舍电费余额恢复

- 生活 → 宿舍 → 电费不再固定显示“家园网系统暂时无法获取余额接口”。
- `DormTab` 恢复调用 `info.getEleRemainder()`，增加独立 SWR 缓存 `dorm:elec.balance.v1`、5 分钟 TTL、登录态失效静默恢复与手动重试。
- 余额卡显示剩余电量、抄表时间；无数据时显示空态；余额失败与充值记录失败分别提示。
- `getEleRemainder` 主路径保留 `/Netweb_List/...`；解析为空时兼容用户提供的 `/web_Netweb_List/...` 直达路径。
- 充值记录逻辑不变；余额和流水独立恢复，互不阻塞。

## 2. Dev 面板更新源测试

- dev 菜单新增「测试更新源」按钮。
- 并行探测 GitHub Releases 与清华云盘两个官方源，**分条显示**：
  - 源名称；
  - 是否成功、最新版本；
  - 是否有更新；
  - 失败原因 / 耗时。
- 新增 `probeUpdateSources()`，不参与正式更新选源/回退，不影响启动检查。
- 仅 dev 构建加载。

## 3. 洗衣机类型图标

- 设备卡布局改为 **左侧类型图标 + 右侧文字**，状态点叠在图标右下角。
- 四类图标：
  - 波轮洗衣机：波轮俯视（机身 + 内桶 + 三叶轮）；
  - 滚筒洗衣机：滚筒侧视（机身 + 圆形筒门）；
  - 洗鞋机：鞋形轮廓；
  - 烘干机：机身 + 热气波纹。
- 类型识别优先设备名前缀 `he / hr / wm / dr`，再匹配 `type` 中文；未知类型使用通用洗衣机图标。

## 4. 掉线自动重登

- **网络学堂提交作业**：`submitHomework` 在写请求前先 `ensureSession()` 真实探活课程页；会话失效时先走 id 漫游/宿主恢复，再提交，避免把登录页/网关错误页当服务器错误直接返回。
- **家园网**：DormTab 遇到 `AuthRequiredError` 先调用新增的 `recoverCampusSession("dorm")`（无 20s 冷却：lib 主会话 → `forceEnsure("dorm")`），再回退原 `softRecover`；余额和充值记录都走这条链路。
- 保留 core 内部单飞、2.5s 会话稳定窗与原有冷却兜底，避免并发重登烧票据。

## 5. 主题色接入交互控件

- 根因：按钮强填充、分段指示器、底部快捷胶囊、暂存箱胶囊、宿主 primary 按钮都读 `--og-action`；该 token 一直固定为中性黑/白，主题 accent 只写入 `--og-accent`，所以换主题后这些控件不变色。
- 将交互控件改用 `--og-accent / --og-accent-strong / --og-accent-on`：
  - OneGUI `.og-btn` 强填充与 brand tone；
  - 分段 Tabs 激活指示器；
  - `.oneshot-button`、`#ex-bbar-onego-btn`、`.vault-box-button`、暂存箱计数徽标；
  - 宿主 `.btn-primary`、联系人/引导选中控件。
- `--og-action` 保留给非交互暗色 chrome（设备边框、兑换卡、拖拽提示），不随主题漂移。
- 实测把 accent 设为红色后，solid 按钮/底部胶囊背景与前景立即跟随；`--og-action` 仍为中性色。
- 同时修复全字符对比度引擎：它会把“无/磨砂/雾面”下采样偏亮的 accent 胶囊判成亮底并锁黑字，到玻璃档采样变暗才恢复白字。现在 `.oneshot-button`、`#ex-bbar-onego-btn`、`.vault-box-button`、`.btn-primary`、`.og-btn--solid`、分段 Tabs 等 accent 填充控件不再被自动置墨，前景固定走 `--og-accent-on`。

## 6. 待办页/手机胶囊显示修复

- 手机端 OH 搜索胶囊：常态把 `(OH)` 图标改为绝对定位，占位文字单独居中；不再被图标的 `margin-left:auto` 推成左对齐。
- 待办页统计卡（还剩作业 / 3 日内截止）与入口按钮：补 `--og-fill-surface` 纯色材质层，保留原 blur，不再只有透明渐变。
- 待办页移除“学习 / 生活”两个静态小标题（仅保留宽屏右栏详情的动态标题），整体内容上移，未读通知条不再被挤到 OneShot 下方。
- 课程筛选下拉：补 `--og-radius-control` 圆角、主题材质底色与背景模糊，内部 `.og-input` 透明，和周围玻璃一致。

## 7. 智能取色（系统 / OneTHU 壁纸）

- 原“跟随系统取色”升级为“智能取色”，总开关默认关闭；开启后才显示来源切换。
- 新增来源选项：
  - `系统`：原有 Material You / Android 12+ 调色板；
  - `OneTHU 壁纸`：从当前壁纸（内置渐变、图片或视频当前帧）提取强调色和中性色，展开成同一套 tone 调色板。
- 壁纸取色纯函数 `paletteFromSeeds()` 复用 `rolesFromPalette()` 的品牌/面层级映射；灰度壁纸、解码失败、无壁纸时回退系统取色，系统不可用再回退「清华紫」主题。
- 换壁纸时，若正在使用壁纸源，自动重新取色并注入；关闭开关或切换主题仍按原有快照恢复逻辑。
- 设置搜索别名保留“动态取色 / 壁纸取色 / 系统取色 / 智能取色”。

## 8. 修复主题色聚焦外圈

- 根因：全局 `:focus-visible` 动画和宿主 `.task-stat:focus-visible`、`.ohx-capsule:focus-within` 等
  都直接画 `--og-ring`；WebView2 在鼠标点击/程序化 focus 时也会命中 `:focus-visible`，
  于是 OH 搜索、作业卡、设置弹窗被套上主题色外圈。
- 新增输入模态跟踪（`pointer` / `keyboard`）：指针模态下关闭焦点动画并清掉 focus 外圈；
  键盘导航仍保留主题色焦点环。
- 覆盖 `:focus-within`，避免胶囊内部输入/设置弹窗只在外层漏一圈。

## 9. 修复智能取色引入的主题色描边

- 根因：`rolesFromPalette` 把 `outline` 映射到带壁纸色相的 neutralVariant；OneGUI 的
  `line-2/line-3` 又取自 `--md-sys-color-outline`，于是智能取色开启后设置面板、卡片等结构描边被染成壁纸色。
- 在动态取色注入前把结构描边强制中性灰：
  - outline 亮色 `#7a7a7a` / 暗色 `#9a9a9a`；
  - outline-variant / soft / strong 改为中性透明度叠色。
- 强调色仍只用于按钮、胶囊、选中态；不再进入边框/分隔线。

## 10. 智能取色暗色档亮度

- 壁纸源的 M3 tone 80 在深色底上接近白色：暗色按钮/强调色会变成“白按钮”，和亮色模式同一明度。
- 壁纸源专用处理：暗色主色/次色改用 tone 600，保留壁纸色相、压低亮度；亮色档仍用 tone 40。
- 暗色结构描边直接置透明（`rgba(0,0,0,0)`）：智能取色深色界面靠面阶/阴影分层，卡片与设置面板不再出现任何白边/主题色描边。
- 系统 Material You 源保持原生 M3 tone，不强行改厂商配色。

## 11. 雨课堂 LaTeX / 白底修复

- **`$ … $` 内侧空白**：不再一律拒绝；内容通过 `looksLikeMath` 判定后渲染，`$5 与 $6` 仍保留原文。
- **`\( … \)`**：支持内侧空白；同时归一 `&#92;` 数字实体与双反斜杠形态，避免定界符在扫描前被跳过。
- **`\( … \)` 只出现在文档时**：KaTeX 加载条件不再只判 `$`，同时识别 `\(`/`\[`、`&#36;`/`&#92;` 实体与双反斜杠形态；否则渲染器根本不加载，整页公式只能显示原文。
- **公式跨 `<br>`/HTML 标签 / `<span>`**：雨课堂 UEditor 会把 `\[` 公式里的换行拆成 `<br>`/`<div>`，还会在 `$…$` 公式内插入 `<span style="text-wrap-mode">`；定界符和公式体因此落在不同文本节点，按节点扫描永远配不上。增加跨标签预处理（保护属性后再配对），剥掉公式体内标签后交给 KaTeX。
- **题干 iframe 始终透明**：不再信任首帧祖先底色/皮肤属性，`ProblemBody` 一律 `bg: transparent, flush: true`；父层卡片负责材质，彻底消除“新开作业白底、切实心+主题才消失”。
- **白底真正的根因**：`color-scheme:light` 会让 WebView 按 light 画一层白 canvas；即使 `html/body` 都是 transparent 也会露白。flush 文档改为 `color-scheme:normal`，iframe 才真正透出父层卡片材质。
- **玻璃下大白底**：`ProblemBody` 在 `data-og-skin="glass"` 或 `data-glass` 时强制 iframe 画布透明（不复制祖先纸面色）；文档 CSS 对 `html,body` 都写 `background:transparent!important`（只写 body 时 Chromium srcdoc 画布仍会刷白），并观察 `data-og-skin / data-og-skin-level / data-glass` 变化重建文档。
- `yktDocCss` 的 flush 文档继续不补不透明暗纸面，玻璃只在父层出现一次。

## 验证

- `dorm-balance-test` ✓（余额接线、缓存、旧错误文案移除）
- `washer-icon-test` ✓（类型、图标组件、左图标布局）
- `devtools-test` 92 ✓（更新源探测接线）
- `washer-name-test` / `washer-source-test` 44 ✓
- `typecheck` ✓、`i18n` 0 errors ✓、CSS parse ✓
- 掉线重登未做真实账号端到端复现；逻辑已覆盖 AuthRequired 的预检与页面恢复链。

## 边界

- 电费余额需要真实家园网会话；本地未用真实账号执行端到端请求。代码恢复后，登录用户在桌面端点击「生活 → 宿舍」应能请求余额；若仍为空，`getEleRemainder` 会带页面首段与调试现场，便于定位。
- 洗衣机图标为类型提示；颜色/状态仍由原有状态点与徽标表达。
