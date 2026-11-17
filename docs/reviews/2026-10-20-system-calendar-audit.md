# 系统日历同步审查与修复（2026-10-20）


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

基线为 `exp / 493378e4`，审查与修复范围聚焦于 `state/systemCal.ts` 及 `onethu-calendar` 原生插件（邮箱、CalDAV 协议与模式设置由本轮其他专项跟进）。全过程在本地隔离环境完成，未请求学校接口，也未读写本机真实系统日历。

## 已确认的问题及修复

| 问题 | 修复与实际行为 |
| --- | --- |
| 配置读取尚未完成就标记 loaded；停止/开启可能被迟到读取覆盖；同步结束未广播 idle | 配置读取共用同一个 Promise，成功完成后才标记 ready；采用严格文件 I/O，文件读取异常直接上报错误。同步开始与结束均广播状态。 |
| 冷启动缺校历/学堂/外部源，或云镜像尚未恢复时生成半量载荷 | 等待 `ensureCloudCalMirrorReady()` 完成（含在途云写入结束及旧缓存账号校验）。当前学期校历、学堂快照、已配置外部作业源须全部就绪；历史学期快照、外部源失败或非法时段均会中止本次覆盖。 |
| 周窗局部数据覆盖完整学期；二级课表失败后以一级结果覆盖完整缓存 | 新增 `syscal-sem-v3:<semesterId>` 缓存，仅在一级与二级课表均成功获取且起始日、周数匹配时写入；拉取失败时回退至该学期的完整缓存，合法的空学期结果也可正常缓存，彻底隔离旧版局部缓存碎片。 |
| 已上云的课程/考试/作业又与实时源重复写入 | 系统镜像过滤云端与本地列表中的 `onethuSource=course/exam/homework`，交由实时源统一生成；普通手动创建的云端与本地日程保留原有提醒。 |
| 作业事件已提前 N 分钟开始，闹钟又相对开始时间再提前 N 分钟 | 作业事件块保留原起止时间语义，原生闹钟改为在事件开始时（提前 `0` 分钟）触发；Android 端同步支持零分钟提醒。非法提前量自动回退或夹紧至有效范围，长提前量一并纳入同步时间窗口。 |
| 忽略、旁听与重复作业仍可能生成提醒 | 排除已提交、已忽略及旁听课程作业，并按作业 ID 去重；实时订阅忽略/恢复状态及外部 audited 变化。 |
| 移除与在途写入并行，删除后可能被重建；停止后的 enable 完成可能重新开启 | 同步采用单飞队列：触发停止时立即作废尚未进入原生层的任务，已进入原生层的任务则等待其执行完毕；移除日历时先停止并等待在途同步结束再执行删除，且阻止后续自动任务重新创建。同步期间的数据源变更仅合并安排一次补充同步。 |
| macOS 按标题清理或删除所有账户下的同名日历 | 通过私有文件 `system-calendar-binding.json` 保存原生日历 ID，仅针对该专属 ID 执行查询、清理与移除，避免按同名匹配影响其他日历。每次同步取新旧时间窗口的并集，跨度超过四年的查询分段执行。 |
| Android 先删旧事件再分批插入，中途失败会留下残缺日历 | 改为先分批插入全部替代事件：若插入失败则回滚本次已插入 ID 并保留旧镜像；全部写入成功后才按旧 ID 清理。若清理旧事件失败则保留完整新集合并报错，后续重试可自动去重收敛。删除操作严格限定于绑定 ID 与 OneTHU 本地账户。 |
| Android 全天事件直接写校园零点 epoch，与 CalendarProvider 的 UTC 零点规范存在偏差 | 全天事件的起止时间统一转换为对应校园日期的 UTC 零点，原生时区标记为 UTC；普通定时事件继续使用真实 epoch 与校园时区。 |

主要实现位置：

- `apps/desktop/src/state/systemCal.ts`：数据屏障、完整载荷、状态生命周期、`exportSystemCalendarIcs()`。
- `apps/desktop/src/state/hwIgnore.ts`：新增共用订阅导出，保持既有存档格式不变。
- `apps/desktop/src-tauri/plugins/onethu-calendar/src/ownership.rs`：绑定文件、范围并集、原生入口载荷校验。
- `apps/desktop/src-tauri/plugins/onethu-calendar/src/macos.rs`：绑定 ID 过滤与 EventKit 提交。
- `apps/desktop/src-tauri/plugins/onethu-calendar/android/src/main/java/app/onethu/calendar/CalendarMirror.kt`：独立可测的先写后删与失败恢复策略、全天日期转换。

## 保留行为与迁移说明

- `exportSystemCalendarIcs()` 与系统日历同步共用同一份完整数据载荷，包含当前学期课程与考试、未提交且开启提醒的学堂及外部作业，以及手动创建的云端或本地日程。导出 ICS 无需申请系统日历权限，若前置数据源尚未加载完整则会明确提示失败。
- 停止自动同步后，系统日历中已有的事件会原样保留。切换极简、实用、完整三种模式时，系统日历的配置与数据均保持不变，入口展示由模式设置层控制。
- Android 端日历使用 OneTHU 专用本地账户存储；macOS 端按顺序选择 iCloud、本地及其他可写系统日历源，若所选系统账户开启了云服务，日历事件也会随系统账户同步至云端。
- 旧版 macOS 客户端未记录持久化的专属日历 ID。升级后应用会新建并绑定独立的专属日历，同时保留原有的同名日历并提示用户核对后自行清理旧副本，首次迁移期间可能会看到两个同名日历，以此避免误删用户在同名日历中添加的个人日程。
- 当学期缓存或数据源读取出错时，应用会保留系统日历中的既有事件并提示错误；若当前学期课表或外部作业源尚未加载，先在日程或网络学堂页面刷新恢复数据后即可重试同步。
- Android 原生 CalendarProvider 批量插入的底层表现、各厂商系统的闹钟实际唤醒，以及 macOS 账户权限弹窗体验，后续仍需在已授权的真机上实测确认。
- Android 端采用分批写入策略：若清理旧事件时中途失败，应用会完整保留新写入的事件集合并报告异常，避免回滚导致数据缺失；短暂留存的重复项在下一次重试同步时即可自动清理收敛。

## 本地验证

1. `node --import ./tools/ts-resolve-register.mjs tools/system-calendar-state-test.mjs`：27 组通过。直接执行 `systemCal.ts` 与真实 ICS 编解码，学校请求、文件读写与原生调用注入隔离夹具，覆盖完整来源屏障、历史学期拦截、冷启动、停止/移除并发、完整缓存回退、失败重试、重复过滤、忽略恢复、提醒计算及无权限副作用的 ICS 导出。
2. `CARGO_TARGET_DIR=/Volumes/OneTHUBuild/oh-desktop cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p tauri-plugin-onethu-calendar --lib --locked`：2 个 Rust 测试通过，macOS 生产代码编译通过。测试聚焦载荷校验与临时绑定文件读写，隔离了底层 EventKit 调用。
3. Android `:onethu-calendar:testDebugUnitTest`：纯 Kotlin 策略共 6 个测试通过，覆盖分批写入顺序、第二批失败回滚、回滚异常兜底、旧项部分删除、空集合与全天日期转换。测试文件位于插件的 `src/test/java/app/onethu/calendar/CalendarMirrorTest.kt`。
4. `pnpm --filter @onethu/desktop typecheck`：通过。

Android 验证使用 `/tmp/onethu-systemcal-android-check` 下的隔离 Gradle 根项目，引用仓库内的 `onethu-calendar/android` 与 Cargo 锁定的 Tauri Android 库，在本地完成策略单元测试（无需打包 APK 或连接真机）。该根项目复用仓库 `gen/android/build.gradle.kts` 的依赖版本，`settings.gradle.kts` 仅挂载 `:tauri-android` 与 `:onethu-calendar`，SDK 路径为 `/Volumes/OneTHUBuild/oh-android-sdk`。复跑命令：

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
GRADLE_USER_HOME=/Volumes/OneTHUBuild/gradle-home \
bash apps/desktop/src-tauri/gen/android/gradlew \
  --project-dir /tmp/onethu-systemcal-android-check \
  :onethu-calendar:testDebugUnitTest --offline --no-daemon
```

首次独立编译 Rust 插件时，exFAT 分区生成的 AppleDouble 隐藏文件曾导致 Tauri 构建脚本读取报错；将构建目标切至 APFS 目录后顺利通过，插件目录内临时生成的 `target/` 与 `Cargo.lock` 均已清理。Android 单元测试首次离线运行时缺少本地 JUnit 缓存，补齐测试依赖后再执行离线验证通过，原有测试断言全程保持不变。
