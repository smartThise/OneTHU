<div align="center">

<img src="../../docs/logo-banner.png" alt="OneTHU" width="640">

# OneTHU NextTHULearn 0.2.1

[独立仓库与下载](https://github.com/smartThise/NextTHULearn) · [OneTHU](https://github.com/smartThise/OneTHU) · [NextTHUxk](https://github.com/smartThise/NextTHUxk)

</div>

进入网络学堂即启用的学习工作台，使用现有网页登录态。数据读取、附件解析、作业提交与讨论接口复用 OneTHU `LearnClient`。

## 功能

- 首页保留学校提供的未读通知、未读文件、未提交作业计数，并展示待办作业、课程通知、最新文件三个内容栏。
- 每门课程显示教师、课程号、上课时间地点及三类官方计数；支持搜索、学期切换和持久化置顶。
- 课程概览、作业、通知、文件、讨论和分组；深层链接进入对应课程和详情。
- 作业正文、教师/答案/提交/批改附件、成绩与批语；富文本编辑、附件上传、提交及更新提交、移除已提交附件。提交后回读学校状态，拒绝时保留编辑内容。
- 作业进行中/逾期/未交/已交/已批改/忽略筛选，截止日历 ICS 导出；状态筛选带数量；忽略和置顶在当前浏览器本地保存，刷新后保留。已批改作业列表直接显示分数。
- 通知正文和附件、已过期通知；作业/通知/文件支持跨课程筛选，文件支持搜索、下载和 PDF/图片/文本预览。阅读通知后回读学校计数与已读状态。
- 讨论板块、精华/参与筛选、分页、楼层阅读、回复、楼中楼回复和带附件发帖。
- 分组成员查询；课程信息、答疑、问卷、邮件、在线课堂、学校收藏与备注，在工作台内嵌学校功能页，保留学校表单与交互。这些页面由学校页面运行，不是重写的客户端界面。刷新后若学校窗口未载入，会显示重试提示，可用“重新加载”恢复或在独立窗口打开。
- 学堂服务入口可使用原站公开课程、课程搜索、校历等其余服务。
- 官方 OneTHU 双行 Logo、26 枚 OneGUI SVG 图标在构建时从本体源码同步。
- 截止提示：逾期和 24 小时内截止为红色，三天内截止为琥珀色；通知、作业、文件数量分别使用蓝、琥珀、绿，零和未知保持中性。文字说明同时保留。
- 明暗外观、窄屏布局、键盘焦点和减少动态效果。

统计始终区分“未知”和零；单课程读取失败显示部分结果与失败提示。扩展的数据管线最多同时发起 4 个请求。不会自动提交作业或发表回复。

## 安装与构建

Chrome / Edge 的扩展管理页开启开发者模式，加载此目录（含 `manifest.json`）即可。Firefox 正式签名包见[独立仓库发布页](https://github.com/smartThise/NextTHULearn/releases/latest)，也可以在 `about:debugging` 临时加载本目录。扩展只处理 `learn.tsinghua.edu.cn` 页面，不需要启动 OneTHU、CLI 或本机服务。页面上的“原版网站”可临时回到学校原界面。

在 OneTHU 仓库根目录安装依赖后运行：

```sh
plugins/NextTHULearn/build.sh
node --import tsx plugins/NextTHULearn/test/core.mts
node plugins/NextTHULearn/test/browser.cjs
```

构建先同步 OneTHU 官方 Logo 与 OneGUI SVG，再将 `packages/core` 中的学习客户端与依赖打包为 `extension/content.js`，扩展运行时不需要 Node.js。测试使用 Playwright 和本机 Chrome，课程、附件与提交内容均为虚构数据。详见 `docs/verification.md`。

浏览器登录、Cookie 由学校网站管理。扩展不保存密码、Cookie、课程正文或附件；主题和置顶/忽略的条目 ID 保存在本站 localStorage，置顶/忽略按网页用户标识的哈希分区。外部平台（如雨课堂）的账号与作业不在这个 Learn 网站扩展的读取范围内。

许可见 `LICENSE` 和 `THIRD_PARTY_NOTICES.txt`。
