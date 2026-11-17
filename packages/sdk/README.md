# OneTHU SDK

[English](README.en.md)

OneTHU 的独立 Node.js 运行时。命令行、MCP、插件与个人助手通过它共用学校会话、校园服务接口、授权校验与任务调度器，无需启动桌面端应用即可独立运行。

运行环境要求 **Node.js 20.19.x 或 22.12+（推荐 Node.js 22 LTS）**，公开类型声明已通过 TypeScript 5.9 的严格 NodeNext 检查。当前通过仓库本地构建的 `.tgz` 压缩包分发（暂未发布至公共 npm 仓库）。

## 构建与安装

在仓库根目录运行：

```sh
pnpm install
pnpm --filter @onethu/sdk pack:standalone
```

将生成的 `packages/sdk/artifacts/onethu-sdk-0.11.4.tgz` 交给使用方，在目标项目中安装：

```sh
npm install /absolute/path/onethu-sdk-0.11.4.tgz
```

压缩包内置运行代码、公开类型声明与第三方依赖许可，已剥离全部指向本仓库的 `workspace:*` 依赖，并附带同目录 `.sha256` 校验文件。该打包脚本仅在本地生成产物；如需更改输出目录，可运行 `node packages/sdk/scripts/pack.mjs --out /absolute/output`。

分发包已内置标准 Node 类型依赖，安装时无需额外拉取学校 SDK 或其他工作区包。可运行 `node packages/sdk/scripts/test-pack.mjs /absolute/path/sdk.tgz` 在临时目录执行离线安装，自动校验运行时导入与公开 TypeScript 类型。

## 创建运行时

```ts
import { createOneThu } from '@onethu/sdk';

const app = await createOneThu({ dataDir: '/absolute/private/profile' });
try {
  // 发现操作列表不会发起学校请求。
  console.log(app.list().operations.map(operation => operation.name));

  // 显式恢复已有 Cookie，会进行只读会话核验。
  const status = await app.auth.restore();
  if (status.authenticated) {
    const semester = await app.call({ operation: 'learn.currentSemester' });
    console.log(semester);
  }
} finally {
  await app.close();
}
```

数据目录归属当前操作系统用户，SDK 运行期间会持有排他锁。每个进程请保持单个活动运行时，退出时调用 `close()` 释放文件锁与网络连接，并在不同设备上各自使用独立的私有目录。

## 登录与二次验证

宿主通过终端隐藏输入或安全密码框获取凭据后，调用 `app.auth.login({ username, password })`。返回值为 `ready` 或 `need-2fa`；当返回 `need-2fa` 时，结果中包含学校提供的验证方式列表，可在同一进程内依次调用 `app.auth.twoFactor.chooseMethod(type)`、按需调用 `sendCode(type)` 以及 `verify(type, code)` 完成验证，或调用 `cancel()` 终止本次登录。

登录过程中密码仅驻留在当前进程内存内，落盘目录只保存会话 Cookie 与稳定设备标识。登录成功后，后续新进程可通过 `app.auth.restore()` 恢复已有会话；未完成的验证码流程与内存密码则仅限发起登录的原进程当次使用。需要让学校记住当前设备时请显式传入 `trustDevice: true`，并在宿主日志中过滤密码、Cookie、验证码与访问令牌。

## 操作发现与授权

`app.list()` 返回当前已实现的操作目录，包含参数 schema、所需权限与读写属性，可作为实际可调用能力的权威清单：

```ts
await app.call({ operation: 'learn.courses', args: [] });
await app.call({
  operation: 'cal.add',
  args: ['学习计划', '2026-10-25', '10:00', '11:00', { local: true }],
  confirm: true,
});
```

写操作默认需要本地确认。本机交互宿主在向用户核对操作详情后可传入 `confirm: true` 放行，来自 MCP、插件与模型的调用则始终遵循本机当前执行策略。凭据配置、插件安装、模型设置与 IM 绑定均限定为本机管理操作。调用 `setAutomatic(true, { confirm: true })` 会开启自动执行策略，建议宿主在启用前向用户说明权限范围。

调用参数支持传入 `deadlineUnixMs`，第二个选项参数支持传入取消信号 `signal`、权限集合 `permissions` 以及提交前校验钩子 `beforeWrite`；一旦检测到账号切换、策略变更或超过截止时间，后续写入将立即中止。批量下载会一并返回已保存文件列表与逐项失败详情，调用方请结合各项状态与完整性标记判断课程资料是否全部归档完毕。

## 能力与边界

- 网络学堂、信息门户、预约、邮件、CalDAV 与选课查询等能力共享底层校园客户端，具体可用操作可通过 `list()` 查询。
- 邮件/CalDAV、云盘与外部作业源按当前账号单独保存凭据；外部作业源目前通过导入已有会话接入，首次登录与验证流程遵循上游站点要求。
- `memory.*` 直接读取当前数据目录下 `accounts/<账号 SHA-256>/memory` 中的 Markdown 笔记，与 OH 云端记忆及桌面端镜像各自独立维护。
- 通知、IM、定时任务与插件均基于 Node 运行；启用后的本地原生插件以当前系统用户进程权限执行，需由用户显式安装并启用。
- GUI 页面导航、白板与系统窗口归属桌面宿主；独立安装包面向 Node 环境，仓库内 `learn`、`tasks` 等模块的 browser 条件导出则供桌面工作区源码构建复用。
- 仓库自动化测试基于本地模拟夹具覆盖核心流程；真实校园服务兼容性、Windows DACL 文件权限与双账号切换场景均在发布前的真机验收中核实。

## 许可

请阅读 [LICENSE](LICENSE) 中的项目许可证与附加使用条件，以及 `LICENSES/` 和 `dist/THIRD_PARTY_NOTICES.txt` 中的代码来源与第三方依赖许可说明；上述文件均随分发包一并附带。
