# 模拟界面与素材来源


中文 · [English](en/screenshots.md)

README、官网与用户文档中的 0.11 界面截图均由真实的 React / OneGUI 前端渲染生成，配合完全隔离的本地模拟数据采集。采集脚本在新建的临时浏览器上下文中运行，自动拦截所有非本地 HTTP 请求，与本机日常浏览器及已登录的 OneTHU 原生应用保持隔离，全程仅读取内置的虚构示例数据。

## 视口

| 类型 | 视口 | 用途 |
|---|---|---|
| 手机竖屏 | 390×844，DPR 2 | 三模式、学习、日程、暂存箱、组织、搜索、OH、清小搭 |
| 手机横屏 | 844×390，DPR 2 | 首页与日程横向排版 |
| 大屏预览 | 1440×900，DPR 2 | 白板与课程布局 |

画面中的课程、人物、文件、组织、作业及校园服务内容均为虚构示例，用于直观展示各尺寸视口下的界面排版与功能入口；真机系统安全区、Android 后台权限交互、Windows WebView2 渲染细节及实体触控手势表现则以各平台原生安装包的实机运行效果为准。

## 重现

```bash
pnpm dev
node tools/capture-public-preview.mjs
node tools/capture-common-tour.mjs
node tools/record-vault-onboarding.mjs
```

运行采集脚本需安装本地 Chromium 与 Playwright，录制动图及转换视频格式另需安装 FFmpeg。开发服务器直接提供生产界面的前端代码，模拟数据适配器仅在采集期间由脚本动态注入页面，正式发行包中保持纯净；录制长按交互动图时，脚本仅在真实产品界面上方叠加一枚圆形指针标记用于指示触控位置。

中文素材存放在 `docs/assets/0.11/`，英文素材独立存放在 `docs/assets/0.11/en-US/`。英文版官网、README、文档与导览均在切换为英文界面与英文虚构数据后原生重采生成；其余非中文语种的导览默认复用英文演示素材。

```bash
ONETHU_CAPTURE_LOCALE=en-US node tools/capture-public-preview.mjs
ONETHU_CAPTURE_LOCALE=en-US node tools/capture-localized-tour.mjs
ONETHU_CAPTURE_LOCALE=en-US node tools/record-vault-onboarding.mjs
```

各目录下的 `manifest.json` 记录了文件名、视口尺寸、生成来源与 SHA-256 摘要，导览动图另由 `apps/desktop/src/assets/tour/real-ui/manifest-vault-drag.json` 维护清单；官网直接同步复用同一批公开素材。每次重新运行采集脚本后，请一并核对界面布局效果与清单摘要。

## 示例

![模拟手机竖屏](assets/0.11/home-practical.png){ width="260" }

![模拟手机横屏](assets/0.11/home-landscape.png)

![模拟大屏工作台](assets/0.11/home-desktop.png)
