<div align="center">

<img src="docs/logo-banner.png" alt="(One / THU) — One THUer should have OneTHU." width="640"/>

**One THUer should have OneTHU.**

`One App · One Identity · One Campus`

</div>

---

> **⚠️ 稳定性提示（0.6.x）**：项目仍在快速迭代，部分校内服务（体育场馆预约、公共空间预约等）链路尚不稳定。**遇到页面报错或数据为空，请先点击右下角的硬刷新按钮**；若刷新后仍复现，再带着 `/tmp/onethu-debug.log` 反馈 Issue。

OneTHU 是对 thuapp 系列（thu-app / thu-info-app fork / learnX fork / NextTHUxk）的完全重构：
一个统一身份、统一数据层、统一界面的清华校园套件。

## 设计原则

1. **一个身份** —— 统一认证（CAS）登录一次，网络学堂、信息服务门户共享会话
2. **一层核心** —— `@onethu/core` 收敛全部 API、加密（SM2 / WebVPN AES）、凭证管理
3. **一付面孔** —— 纸面墨线的编辑排版风格，信息密度真实，没有 AI 味
4. **诚实** —— 不造数据：网络不可用时给出明确错误与重试，演示模式需显式进入

## 功能总览（0.7.11）

- **统一身份**：CAS 登录一次（SM2 加密 + ticket 漫游 + 设备指纹），全模块共享会话；双因素认证（邮箱 / TOTP）
- **网络学堂**：课程 / 作业 / 通知 / 文件下载
- **信息门户**：个人信息 / 课表 / 成绩（中英文成绩单）/ 学年汇总 / 倒计时 / 新闻 / 校历 / 空教室 / 教学评估 / 体测 / 卫生成绩
- **生活服务**：饭卡流水 / 网费 / 宿舍电费（充值）/ 校园网 / 电子发票 / 银行代发 / 研究生收入
- **图书馆**：馆藏检索 / 借阅 / 预约（cab 验证链）
- **体育场馆**：场馆/场次/余量查询 + 我的预约 + 退订（应用内不做预约提交——见下方「使用边界与声明」，预约跳转官方网页；维护窗口 01:00-02:00 自动识别）
- **学生宿舍公共空间预约**：空间 / 房间 / 日期 / 场次全链路（WebForms 回传链 + 协议自动同意）
- **移动端**：Android APK（arm64 / universal），窄屏布局适配
- **兜底**：错误先自动硬刷新（防循环上限），上游维护显示友好倒计时卡，绝不无脑红条

## 快速开始

环境要求：Node ≥ 20、pnpm、Rust toolchain（桌面/移动壳需 Rust 编译）；Android 构建另需 Android SDK + NDK。

```bash
pnpm install      # workspace 全量装依赖
```

### 日常开发

```bash
pnpm dev                                  # 纯浏览器预览（Vite dev server，登录页可进"演示模式"先行体验）
pnpm --filter @onethu/desktop tauri:dev   # 原生桌面壳开发模式（Tauri 2，改前端即时热更）
```

### 生产构建

```bash
pnpm build                                # 构建全部包；web 资产产出到 apps/desktop/dist
pnpm --filter @onethu/desktop tauri:build # 桌面安装包（macOS DMG / Windows EXE / Linux 包；会自动先跑 pnpm build）
pnpm --filter @onethu/desktop exec tauri android build --apk   # Android APK（arm64 / universal，需 SDK+NDK）
```

- 桌面产物：`apps/desktop/src-tauri/target/release/bundle/`
- Android 产物：`apps/desktop/src-tauri/gen/android/.../build/outputs/apk/`
- CI（`.github/workflows/release.yml`）的打包命令与上面一致，打 tag 推送即出全平台安装包

下载安装包见 [Releases](https://github.com/smartThise/OneTHU/releases)（macOS DMG / Windows EXE / Android APK）。

## 结构

```
OneTHU/
├── packages/
│   ├── core/        @onethu/core   统一 API 客户端：CAS 登录、网络学堂、信息门户、
│   │                               WebVPN AES-128-CFB 编解码、SM2 国密、凭证存储
│   └── ui/          @onethu/ui     设计令牌与基础样式
├── apps/
│   └── desktop/     @onethu/desktop  桌面端 + Android（Tauri 2，Vite + React）
└── docs/
    └── logo-banner.png             品牌横幅
```

## 使用边界与声明

- **体育场馆模块仅提供查询**（场馆 / 场次 / 余量 / 我的预约 / 退订），不提供应用内预约提交。依据清华大学体育部场馆中心 2025 年 12 月 3 日发布的公告第七条第 12 款：如有用户通过脚本软件或插件等非正常途径预定场地，一经发现并核实，对该用户封禁预订权限 6 个月，并函告相关院系或单位。预约请通过应用内按钮前往官方网页完成。
- **严禁将本项目源码用于任何形式的自动预约 / 抢场**。该行为既违反体育部场馆中心预约须知，也违反本项目开源准则；由此产生的一切后果由使用者自行承担。
- 本项目为非官方的个人效率工具，与清华大学无关；所有数据均来自学校公开系统的网页接口，仅供个人学习与日常使用。

## 血脉与致谢

核心 API 结论分别验证自 [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib)、
[thu-info-app](https://github.com/thu-info-community/thu-info-app)、[learnX](https://github.com/robertying/learnX)，
向以上项目的长期维护者致敬。OneTHU 为个人使用的整合重构。

## 版本

当前版本 **0.7.11**（详见 [Releases](https://github.com/smartThise/OneTHU/releases)）。
