# OneTHU SDK

[English](README.en.md)

OneTHU 的独立 Node.js 运行时。命令行、MCP、插件和个人助手共用学校会话、服务接口、授权边界及调度器。运行 SDK 无需启动桌面 App。

需要 **Node.js 20.19.x 或 22.12+（推荐 Node.js 22 LTS）**。公开类型已通过 TypeScript 5.9 的严格 NodeNext 检查。本仓库当前提供本地构建的 `.tgz`，尚未发布到 npm。

## 构建与安装

在仓库根目录运行：

```sh
pnpm install
pnpm --filter @onethu/sdk pack:standalone
```

将生成的 `packages/sdk/artifacts/onethu-sdk-0.11.4.tgz` 交给使用方。在另一个项目里安装：

```sh
npm install /absolute/path/onethu-sdk-0.11.4.tgz
```

压缩包包含运行代码、公开声明及依赖许可证；没有指向本仓库的 `workspace:*` 依赖。`.sha256` 文件用于校验。`node packages/sdk/scripts/pack.mjs --out /absolute/output` 可指定产物目录。该脚本只打包，不执行 npm 发布。

分发包内含标准 Node 类型依赖；安装时无需另外下载学校 SDK 或工作区包。可用 `node packages/sdk/scripts/test-pack.mjs /absolute/path/sdk.tgz` 在临时目录离线安装，并验收运行时和公开 TypeScript 类型。

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

数据目录属于当前操作系统用户；SDK 在运行期间持有排他锁。同一进程使用一个活动运行时，退出时调用 `close()` 释放锁和连接。每个设备应使用各自的私有目录。

## 登录与二次验证

宿主从终端隐藏输入或安全输入组件获得密码，调用 `app.auth.login({ username, password })`。结果为 `ready` 或 `need-2fa`。后者包含学校提供的验证方式，依次调用 `app.auth.twoFactor.chooseMethod(type)`、按需 `sendCode(type)`、`verify(type, code)`。整个交互在同一进程内完成；`cancel()` 结束待验证流程。

密码保留在进程内存中，Cookie 和稳定设备标识写入私有目录。新进程可以恢复已建立的会话，无法恢复上个进程的密码或尚未完成的验证码交互。只有明确传入 `trustDevice: true` 才请求记住该设备。宿主日志应排除密码、Cookie、验证码和访问令牌。

## 操作发现与授权

`app.list()` 返回当前实现的操作及参数 schema、权限、读写属性。以该列表为可调用范围。调用方式为：

```ts
await app.call({ operation: 'learn.courses', args: [] });
await app.call({
  operation: 'cal.add',
  args: ['学习计划', '2026-10-25', '10:00', '11:00', { local: true }],
  confirm: true,
});
```

写操作默认需要本地确认。`confirm: true` 适用于已向用户核对操作的本机宿主；MCP、插件和模型调用不能借此绕过本地策略。配置凭据、安装插件、修改模型和 IM 绑定属于本机配置操作。`setAutomatic(true, { confirm: true })` 会显式启用自动执行策略，宿主需要先说明影响。

调用可附 `deadlineUnixMs`；宿主还可以通过第二个参数传入 `signal`、`permissions` 和提交前核验函数 `beforeWrite`。账号、权限或截止时间变化会阻止后续提交。下载保留成功项和逐项失败结果，部分完成不能当成整门课程完整归档。

## 能力与边界

- 网络学堂、信息门户、预约、邮件、CalDAV、选课查询等复用共享学校客户端。实际可用项以 `list()` 为准。
- 邮件/CalDAV、云盘和外部作业源使用当前账号单独配置的凭据。外部源目前采用会话导入；首次登录及学校验证要求仍取决于上游。
- `memory.*` 只读当前账号的 `accounts/<账号 SHA-256>/memory` Markdown 文件。OH 云端记忆和桌面镜像单独管理。
- 通知、IM、任务和插件通过 Node 运行。已启用的本地原生插件代码拥有用户进程权限，应由用户明确安装和启用。
- GUI 导航、白板和系统窗口由桌面宿主提供。公开安装包面向 Node；仓库内 `learn`、`tasks` 等 browser 条件出口保留给桌面工作区复用。
- 学校服务兼容性、Windows DACL 和真实双账号场景需按发布验收记录核实；合成测试通过不等于完成所有设备和真实服务验收。

## 许可

请完整阅读 [LICENSE](LICENSE) 中的项目许可与附加使用条件，以及 `LICENSES/` 和 `dist/THIRD_PARTY_NOTICES.txt` 中的来源与第三方许可。分发包保留这些说明。
