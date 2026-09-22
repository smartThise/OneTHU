> 最后更新：2026-09-22 23:04

# OneTHU Demo（脱敏演示版）

本分支（`demo`）用于构建脱敏演示版 **OneTHU Demo**：登录流程与正式版完全一致，姓名、学号、
成绩等敏感信息在本地替换为化名与编造成绩，便于演示、录屏与分享。

**正式版说明见 [dev3 分支的 README](https://github.com/smartThise/OneTHU/blob/dev3/README.md)**，
本文件只说明本分支的差异与构建方式；完整脱敏规则见 [docs/demo-build.md](docs/demo-build.md)。

## 与正式版的差异

| 项 | 正式版（dev3） | 本分支（demo） |
|---|---|---|
| 脱敏开关 `packages/core/src/privacy/config.ts` | `DESENSITIZE_ENABLED = false` | `true` |
| 应用身份 `apps/desktop/src-tauri/tauri.conf.json` | `app.onethu.desktop`，产品名 OneTHU | `app.onethu.demo`，产品名 OneTHU Demo |
| 窗口标题 | OneTHU | OneTHU Demo（脱敏演示版） |
| Android 打包脚本 | `apps/desktop/scripts/build-release-apk.sh` | `apps/desktop/scripts/build-demo-apk.sh` |
| 文档 | 工程文档全量 | 另附本说明、脱敏规则与演示流程 |

应用标识不同（`app.onethu.demo`），因此脱敏演示版可与正式版装在同一台设备上共存，互不覆盖数据。

## 脱敏规则

| 类别 | 处理 |
|---|---|
| 姓名（本人 / 教师 / 助教 / 讨论区发帖与回复 / 分组同学 / 通知发布人 / 校园卡 / 发票 / 网络账号 / 体育预约 / 体测） | 替换为化名池中的化名，同一个人始终对应同一个化名 |
| 学号 / 一卡通号 / 账号 | 替换为编造学号（保留年级前缀）；登录凭据本身仍为真实值 |
| 联系方式（邮箱 / 手机 / 座机） | 替换为示例邮箱与编造号码 |
| 成绩（成绩单、作业与考试得分、体测总分、雨课堂） | 按量表编造，只生成高分段；等级与绩点取自同一行 |
| 富文本正文（讨论区帖子、通知正文、作业评语、评教建议） | 已登记的真实姓名与学号一并替换 |
| 非敏感数据（课程名、课表、教室、洗衣机、图书馆座位、新闻、场馆、发票金额） | 保持真实数据，不做替换 |

界面标识：侧栏底部角标与登录页说明标注「脱敏演示版」，正式构建中这两处不生效。

## 已知残留（演示前须知）

1. **登录页输入框**显示的是用户输入的真实学号与密码；登录必须使用真实凭据，无法脱敏。
   演示前建议清除「记住密码」，并避免在输入过程中被拍摄。
2. **未登记的第三方自由文本**（某条通知正文里出现的姓名，且该姓名此前未在任何结构化字段中出现）
   无法被替换：替换依赖该姓名此前已在结构化字段中出现。
3. 讨论区与通知中由**服务端渲染进 HTML 的姓名**若与结构化字段写法不同，以结构化字段为准替换，
   正文中的变体可能残留。
4. 成绩被编造后，成绩单页的学分总数与平均绩点按编造值重算，与真实数值无关。
5. **宿舍卫生**为服务端渲染的图片，文本层无法脱敏；该页不显示姓名，若演示需绝对保守可跳过该页。
6. **体测**只替换姓名、学号与总分，身高、体重、肺活量等原始测量值保留。
7. 服务端返回的图片型数据（宿舍卫生图、雨课堂题干加密字体、附件缩略图）按原样展示。

## 构建

```bash
pnpm install

bash apps/desktop/scripts/build-demo-apk.sh   # Android APK（脱敏 + app.onethu.demo）
pnpm --filter @onethu/desktop tauri:build     # 桌面安装包（产品名 OneTHU Demo）
```

Android 脚本会把工程指向内盘（`~/onethu-android-demo`），并在构建后校验产物包名为
`app.onethu.demo`，避免把正式版工程打成 demo 包。

## 双线纪律

`demo` 与发布线 `dev3`（本地检出的分支名为 `dev2`）只允许在上面列出的文件上不同。镜像改动只按
文件摘取（`git checkout <sha> -- <files>` 后在发布线单独提交），**不得 `git merge` 或快进把本分支
合入发布线**：脱敏开关与 `app.onethu.demo` 身份会随合并进入正式版（2026-09-21 的实际事故）。

```bash
node tools/release-line-check.mjs             # 检查 git 引用
node tools/release-line-check.mjs --worktree  # 镜像提交前自查工作区
```

## 使用边界与许可

演示版沿用正式版的使用边界与许可：体育场馆模块仅提供查询，严禁任何形式的自动预约与抢场；
自有代码以 MIT 开源并附两条限制（严禁商业用途；严禁用于对清华大学信息服务的攻击性访问）。
详见 [dev3 的 README](https://github.com/smartThise/OneTHU/blob/dev3/README.md) 与
[LICENSE](LICENSE)。
