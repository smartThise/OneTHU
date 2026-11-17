# 0.11 官网、文档与导览更新验收


> 归档说明：本文记录 0.11 官网、双语文档与导览更新的源码实现及隔离浏览器验收情况；校园双账号实时联调与物理真机性能实测另行跟进。

## 交付范围

- README 提供独立的中文与英文版本及双向语言切换入口，展示原版上下结构 Logo。
- 官网为概览、下载、插件、开发者、交流五类页面均提供完整的中英文版本，并在视觉呈现中展现主题、壁纸与白板布局的自由定制能力。
- 手机竖屏、横屏与桌面端展示素材均采集自真实 React/OneGUI 视图与本地隔离模拟数据，素材清单附带完整 SHA-256 校验值。
- 首页采用本地打包的 Three.js 设备模型与滚动驱动视角；在系统开启“减少动态效果”、禁用 JavaScript 或缺乏 WebGL 支持时自动切换为静态画面回退，保持页面原生顺畅滚动。
- 插件市场保留目录加载、分类筛选、关键词搜索与网络异常重试入口，远端插件描述统一按纯文本安全渲染；社区公开 QQ 群入口继续保留。
- 开发者页集中梳理了本地构建、插件开发、Harness、技能运行边界、API 参考、OneGUI 设计规范与项目贡献者。贡献者名单根据可追溯的 Git 提交历史自动生成并合并已确认的账号别名，公开页面隐去作者邮箱以保护隐私。
- 贡献者统计在剔除合并提交重复项、自动生成文件、第三方依赖、词典、测试夹具与非代码文件后，将累计新增代码严格超过 10,000 行的作者列为主要贡献者（当前为 smartThise、xiao-dreamr），其余署名共同作者同样完整收录展示；代码行数仅作为划分页面展示分组的客观统计口径。
- 现行使用与开发指南提供中英文双语版，API 文档直接从类型定义与门面源码自动生成，两种语言均完整列出 36 个命名空间与 255 个方法入口。过往工程记录保留原始语种并附上清晰的归档说明，可通过全量文档目录统一查阅。
- 文档同步脚本按源文件位置解析相对链接，准确处理根目录 README 更名、跨语种路径跳转与仓库外部链接；全量 Markdown 文档均纳入站点发布，同时自动剔除未被正文引用的测试转储、临时素材与提取目录（主仓库内的历史证据文件原样保留）。

## 导览修复

三种模式的首节导览均完整介绍全局搜索、OneTHU Harness 与插件体系，并清晰说明极简与实用模式的功能侧重；点击导览内的体验按钮即可直接打开真实的搜索面板、OH 窗口及插件/模式设置，体验结束后可一键回到导览进度。

暂存箱演示更新为基于真实拖拽管线的完整实录画面：长按作业、提起卡片、拖入高亮目标区、松手完成收纳，随后打开暂存箱核对条目，画面中仅叠加触控指针以便看清手势轨迹。配套文案详细列出了当前已接入收纳能力的来源模块，包括白板组件、标签页、工作区、作业、文件、搜索、日程、名片、邮件、云盘、GitLab 及设置项。

录屏采集改用经过外窗坐标校准的 CDP compositor 帧捕获方案，消除了早期录屏右侧与底部的多余留白。单手机演示舞台采用竖屏构图，在 1280 与 390 视口下设备主体投影分别约占舞台宽度的 80% 与高度的 89%，模型外框完整清晰。当视频暂停、页面切入后台、组件滚出视口或系统开启“减少动态效果”时，媒体播放与渲染帧调度均会自动挂起以节省资源。

## 验证

- `pnpm test:onboarding`：导览课程结构、目标导航、模式策略与实践后返回逻辑全部通过。
- `tools/onboarding-browser-test.mjs`：桌面与手机端全模式及扩展课程的真实页面跳转共 66 项断言通过，测试结束后正常回收浏览器进程。
- `tools/onboarding-real-screens-test.mjs`：31 张导览屏幕截图、54 种选项与设备模型组合，共 1141 项断言全部通过。
- `tools/onboarding-basics-vault-browser-test.mjs`：三种模式下的搜索/OH/设置跳转、真实视频播放与暂停、画面主体占比及减少动态效果回退全部通过，浏览器正常清理。
- `tools/public-site-browser-test.mjs`：覆盖 1440、390、320、844 四种视口下的语言切换、键盘可达性、模式切换、贡献者列表、插件分类与搜索、外部描述纯文本安全渲染，以及无 JS/无 WebGL/减少动态效果回退。
- `tools/public-docs-browser-test.mjs`：桌面与手机端的同页中英文切换、完整英文 API 列表、贡献者名单及动效演示素材加载均通过验证。
- 官网静态契约检查：10 个双语页面、本地静态资源、原版上下 Logo、主要贡献者统计阈值及零邮箱泄露检查全部通过。
- 中英文 MkDocs `--strict` 严格构建均零警告通过，全量文档文案规范检查通过；一并修复了部分归档文档中裸写 `<style>` 标签吞没后续正文的问题，并完成全站页面、静态资源与锚点链接核验。
- `pnpm i18n:check`：7516 个词条校验通过，错误 0；62 份 Android 小组件回退模板全部匹配。
- 应用 TypeScript 类型检查与前端生产构建均通过（构建输出中既有的主包体积提示留待后续分包优化）。

复现与维护工具：`tools/docs-api-surface.mjs`、`tools/docs-catalog.mjs`、`tools/contributors-report.py`、`tools/capture-public-preview.mjs`、`tools/record-vault-onboarding.mjs`；官网仓库同步维护页面生成、素材同步、静态契约校验与双语站点构建脚本。

## 发布记录

2026-10-21，主仓 `dev3` 分支实现提交 `9c226574` 与官网仓 `main` 分支提交 `24c87af` 均已推送。GitHub Pages [构建及部署 39551736790](https://github.com/OneTHU/onethu.github.io/actions/runs/39551736790) 顺利完成，新版双语官网、开发者页与中英文文档已上线至 [onethu.github.io](https://onethu.github.io/)。发布流水线会在构建时自动基于完整主仓 Git 历史重算贡献者数据，并校验最终组装站点的全部页面、资源与锚点链接。

最终源码再次通过 TypeScript 检查、导览课程/导航测试与前端生产构建（耗时 8.66 秒，保留既有主包体积提示）。导览浏览器回归还额外确认了进入实践环节前已处于打开状态的 OH 面板在返回导览后依然原样保留。

## English review summary

The public website and current user guides now provide dedicated Chinese and English editions, featuring the original stacked logo while highlighting customizable themes, wallpapers, and board layouts. All public previews are captured directly from the live UI using isolated fictional fixtures. The developer page lists every attributed contributor with a documented source-line threshold for core contributors and omits author email addresses for privacy. Historical technical records remain accessible in their original language with clear archival labels.

Automated browser verification covers desktop, portrait, narrow, and landscape viewports, testing live guide destinations, staging vault playback, keyboard navigation, language switching, plugin search, and graceful fallbacks for reduced motion, disabled JavaScript, and unavailable WebGL. Live two-account campus collaboration and physical-device performance testing are tracked separately.
