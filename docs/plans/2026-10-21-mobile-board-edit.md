# 手机白板显式编辑与 Android 0.11 补包


按用户确认的方案推进：手机端首页与所有白板默认处于锁定阅读态，点击“编辑”后才允许调整组件；画笔、缩放、添加组件等编辑工具仅在编辑态下展开，继续停靠在原工具栏位置。功能验收完成后在本地使用正式证书签名构建 Android 安装包，原地替换 GitHub Release 与清华云盘 `/Android/` 目录下的同名 APK，并同步更新校验文件与双源更新清单。

- 在共享 `FreeBoard` 中实现按白板与横竖屏朝向独立隔离的临时编辑态，状态仅驻留内存：切换白板、离开当前标签页或刷新重载后自动恢复锁定，手机系统返回键优先退出当前编辑态。
- 锁定态下屏蔽组件选中、拖动与尺寸缩放、自动几何重排，同时拦截键盘快捷键、右键菜单、双击与画布双指缩放等修改入口；组件内正常链接点击与页面纵向滚动保持畅通。退出编辑态时统一清理进行中的指针监听、选中框、画笔工具与编辑浮层。
- 编辑开关置于原工具栏顶部，进入编辑态后原有工具按钮顺序与右下角停靠锚点保持不变；编辑器叠层接入 OneGUI 新增层级令牌，避免被回到顶部或强制刷新悬浮按钮遮挡。
- 中英文按钮、状态提示及既有导览说明同步更新，用户已保存的全部白板布局数据原样保留。
- Android 对外版本号维持 `0.11.0`，内部 `versionCode` 由首发正式版的 `11000` 递增至 `11001`，沿用同一正式发布证书。

## 验证

- `tools/board-mobile-edit-browser-test.mjs`：挂载真实白板组件与隔离示例数据，在 390 竖屏与 844 横屏下覆盖 Home 与 OnePage 双白板，逐项验证真实 CDP 触摸滚页、锁定态零布局篡改、进入编辑后真实拖动与角点缩放、点击完成恢复锁定、跨白板编辑态隔离、英文界面切换与返回键退出，以及桌面端保持免解锁直接编辑。测试报告存档于 `/Volumes/OneTHUBuild/artifacts/release-0.11/mobile-board-edit/`；当前测试环境未连接物理 Android 设备。
- TypeScript、i18n、CSS、设计令牌与对比度护栏全部通过。旧脚本 `board-drag-test.mjs` 中的 `repairOverlaps` 断言针对早期禁止重叠的旧版规则，而现行 `state/freeBoard.ts`（本轮未作修改）已支持组件自由叠放，故维持现行叠放设计；纯模型单测 `board-edit-test.mjs` 通过。

## 发布检查表

- [x] 完成本地正式签名构建，核验 APK 版本号、签名证书与内嵌前端产物。
- [x] 替换 GitHub Release 中的 APK、`SHA256SUMS.txt` 与 `latest.json`，桌面端双平台安装包保持不变。
- [x] 更新云盘 `/Android/` 目录下的 APK 及根目录校验文件与 `latest.json`。
- [x] 运行三目录匿名下载、全量字节哈希、双源清单门禁及客户端真实更新器三平台探测。
- [x] 刷新官网下载快照并复核线上 Pages 部署结果。

## 补包结果

- Android 构建源码提交：`f1e06f9496bd3ddcecbb1eef6ccb884741f013d9`。
- 版本信息：`0.11.0` / `versionCode` **11001**，包名 `app.onethu.desktop`，ARM64 架构，正式签名证书 SHA256 为 `cc14d735667bb8b5d3134e7dfdccf6a4d9353e1a2fce54503f4a29705423aa97`（与首发正式版完全一致）。
- APK SHA256 为 **`0ae0f44d8396b3109c909330620c477cb9159818486744a2bc151dfef0ac6409`**，大小 `31,912,765` 字节。v1/v2/v3 签名、zipalign 对齐与 ZIP 完整性校验全部通过；包内已确认嵌入新版前端资源 `index-BT4eo_R6.js`，且不含 `DevPanel`。
- 已原地替换 [Release v0.11.0](https://github.com/smartThise/OneTHU/releases/tag/v0.11.0) 同名 Android 安装包与清华云盘 `/Android/OneTHU_0.11.0_arm64.apk`，两侧 `SHA256SUMS.txt` 与 `latest.json` 同步更新。
- 匿名完整拉取云盘三端目录最新安装包并与 GitHub SHA256 逐字节比对全部一致；双源清单校验以及真实 `updater` 三平台解析、GitHub 故障自动回退云盘测试全部通过；macOS 与 Windows 安装包的 `asset ID` 及哈希摘要分毫不改。
- 本轮浏览器端 29 项交互断言（含真实触摸滚动）全部通过；物理 Android 手机上的安装与触控体验待真机核验。
- 本地新版 APK 归档于 `/Volumes/OneTHUBuild/artifacts/release-0.11/mobile-board-edit/installers/OneTHU_0.11.0_arm64.apk`，并已同步复制至桌面 `OneTHU-builds/OneTHU_0.11.0_arm64.apk`。
- 官网下载元数据快照已提交刷新，线上最终状态以对应 Pages run 部署完成为准。
