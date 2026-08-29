# OneTHU

**清华万物，汇合于一体。**

OneTHU 是对 thuapp 系列（thu-app / thu-info-app fork / learnX fork / NextTHUxk）的完全重构：
一个统一身份、统一数据层、统一界面的清华校园套件。

## 设计原则

1. **一个身份** —— 统一认证（CAS）登录一次，网络学堂、信息服务门户共享会话
2. **一层核心** —— `@onethu/core` 收敛全部 API、加密（SM2 / WebVPN AES）、凭证管理
3. **一付面孔** —— 纸面墨线的编辑排版风格，信息密度真实，没有 AI 味
4. **诚实** —— 不造数据：网络不可用时给出明确错误与重试，演示模式需显式进入

## 结构

```
OneTHU/
├── packages/
│   ├── core/        @onethu/core   统一 API 客户端：CAS 登录、网络学堂、信息门户、
│   │                               WebVPN AES-128-CFB 编解码、SM2 国密、凭证存储
│   └── ui/          @onethu/ui     设计令牌（纸/墨/清华紫）与基础样式
├── apps/
│   └── desktop/     @onethu/desktop  桌面端（Vite + React，Tauri 2 就绪）
└── docs/
    ├── ARCHITECTURE.md             架构与端上路线
    └── API-NOTES.md                API / 解密 / 授权 —— 全部已验证结论
```

## 快速开始

```bash
pnpm install
pnpm dev          # 桌面端 Web 预览（登录页可进"演示模式"先行体验）
```

## 路线

- [x] 脚手架：core / ui / desktop
- [x] CAS 登录（SM2 加密 + ticket 漫游 + 设备指纹）
- [x] WebVPN URL 编解码（动态生成，不再硬编码 hex 前缀）
- [x] 网络学堂：课程 / 作业 / 通知 / 文件
- [x] 信息门户：个人信息 / 课表 / 成绩 / 倒计时 / 新闻
- [ ] Tauri 2 壳与系统钥匙串凭证存储
- [ ] 移动端（RN）复用 core
- [ ] 选课（zhjwxk，SM2 密码 + 2FA）、饭卡 / 宿舍电费 / 图书馆

## 血脉与致谢

核心 API 结论分别验证自 [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib)、
[thu-info-app](https://github.com/thu-info-community/thu-info-app)、[learnX](https://github.com/robertying/learnX)，
向以上项目的长期维护者致敬。OneTHU 为个人使用的整合重构。

## 版本

当前版本 0.1.0。

已知问题：网络学堂（learn）模块功能存在缺陷（作业提交等链路尚不稳定），其余模块可用。
