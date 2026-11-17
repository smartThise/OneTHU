# 反馈修复验收（2026-10-18）


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../../README.md)（[English overview](../../en/index.md)）。


针对用户 8 页 PDF 中的 30 条反馈与长 Segment 指示条完成集中修复，逐项验收记录见 `docs/plans/2026-10-18-feedback-repairs.md`。

## 怎么复跑

```bash
# 1) 起 dev server（浏览器预览要用真实组件，不另造 mock 页面）
pnpm --filter @onethu/desktop dev            # 默认 5180
# 2) 跑验收（会写回本目录的截图与 report.json）
node tools/feedback-repairs-browser-test.mjs
# 可选：换地址
ONETHU_TEST_URL=http://127.0.0.1:5199 node tools/feedback-repairs-browser-test.mjs
```

`report.json` 记录逐项断言结果：`checks` 为通过项数，`errors` 应为空（纯浏览器预览环境未挂载 Tauri 原生桥，`reading 'invoke'` 等环境提示已由脚本过滤，桌面端运行无此提示）。

## 产物

| 文件 | 说明 |
| --- | --- |
| `desktop-home.png` | 桌面首页：三栏（标签条/底栏/OneGO）互不重叠、白板工具栏带文字 |
| `vertical-rail.png` | 竖版标签栏 30 个标签：底部操作仍在屏内、OneGO 完整可见 |
| `oh-composer.png` | OH 面板底部 composer 可见、与胶囊共享草稿 |
| `segments.png` | 长 Segment 拖动指示条 + Surface 内边距 + 按钮行高 + 胶囊几何 |
| `home-390.png` / `home-320.png` | 手机两档：无横向溢出、白板工具与硬刷新按钮互不遮挡 |
| `glass-blur.png` | glass 皮肤下设置浮层真模糊（backdrop-filter 生效） |
| `wallpaper-ink.png` | 深色壁纸下前景标题自动转亮 |

## 本轮根因治理

- **导航三栏排布**：底栏与顶栏原先都固定在 `top:0`，层级更高的底栏盖住了整条标签栏，现已改为上下两行排布。
- **`.og-surface` 内边距恢复**：修复此前全站 `pad` 属性未生效的问题，清小搭气泡与各类卡片同步恢复正常内边距。
- **backdrop root 修正**：遮罩入场动画原本使用 `forwards`，结束后残留 backdrop root 导致 `backdrop-filter` 失效，现已改为 `backwards`。
- **卡片点击热区**：`Card` 默认将子元素包入带内边距的 `.og-card-body`，导致入口按钮点击区域缩水，`stat-click/course-card` 现改为 flush 铺满。
- **滚动条视觉降噪**：组件卡体原先使用 `overflow:auto`，轻微溢出 2px 也会出现滚动条滑块，现改为保留滚动能力的隐藏式滚动条。
- **拖动实时边界**：画布尺寸改按实时 rect 计算，取代原先仅按落库 rect 计算的做法，拖动卡片时画布边界实时跟随。
- **壁纸前景色采样**：亮度采样截断到 `.explorer-shell` 为止，避免外层不透明画布冲淡壁纸采样结果。
- **取色开关与昼夜调度解耦**（护栏回归）：此前 `deactivateTheme/activateTheme` 会一并清空 `followSystem`，进出动态取色后「跟随昼夜」设置随之丢失；现拆出 `detachAppliedTheme()`（仅卸下当前主题）与 `setFallbackTheme()`（仅切换视觉表现，保留用户偏好）。

## 环境范围与后续安排

- 纯浏览器预览环境未接入 Tauri 原生命令与校园网服务，因此登录、OH 模型与清小搭技能接口在浏览器侧重点验证错误分流与交互反馈，完整服务联调通过桌面端实测完成。
- 清小搭技能广场与 OH 技能的互通（OH 侧技能注册与管理）作为独立专题推进，按计划暂缓，本轮先行补齐前端交互反馈。
- 此前遗留的 7 项旧类名护栏报错已在基线复现，与本轮改动相互独立，后续单独排期清理。
