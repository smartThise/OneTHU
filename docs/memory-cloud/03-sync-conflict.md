# 03 · 同步、冲突与缓存层设计（OH-Memory + Files Hub 公共底座）

> 状态：设计稿（原型级，未实现） · 分支 dev-memory-cloud · 2026-10-09
> 姊妹篇：[01-memory-system.md](./01-memory-system.md)、[02-files-hub.md](./02-files-hub.md)
> 本文回答一个问题：**在没有原子写、没有锁、没有实时通知的 Seafile Web API 上，三端怎么安全地共享一棵会变的树。**

## 1. 问题定义

三个写者（手机 OH / 桌面 OH / 云端 bot OH）+ 一个人类用户（网页端手改文件），四个角色在无协调的情况下读写同一目录树。API 层可用原语（全部经 seafile.rs 或 thufs 验证）：

| 原语 | 语义 | 缺什么 |
|---|---|---|
| `list dir` | name/kind/size/**mtime（秒级）** | 无 ETag、无变更序号（seafile_dir，seafile.rs:135） |
| `read file` | 整文件下载（支持 Range） | 无条件读（If-None-Match） |
| `upload`（replace=0/1） | 上传，同名可选覆盖 | **无 CAS**：replace=1 是无条件覆盖 |
| `update-link` | 覆写指定文件（thufs 验证） | 同上，无条件 |
| `mkdir -p` | 幂等建目录 | — |
| （待验证）rename/delete | 移动/删除 | 清华实例未实测 |

推论：**任何「读-改-写」都存在丢更新窗口**；任何「写」都无法表达「仅当版本未变时写入」。设计必须承认这一点，而不是假装它不存在。

## 2. 设计原则（按优先级）

1. **云盘文件是唯一权威**（local mirror 只是缓存；任何时候可 `reindex` 全量重建，同 basic-memory doctor 哲学）。
2. **写操作尽量 append 化**：append 型变更（追加 observation）冲突破坏性最小，可做 union 合并；结构性重写（memory_edit/memory_write 覆盖）才是高危，走完整协议（§4）。
3. **冲突不静默**：检测到不可合并冲突时，败者的完整内容归档进 `.conflict/`，绝不丢弃。
4. **人类写的优先**：与用户手改冲突时，agent 侧让步（用户手改 = 有意的编辑，哪怕时间戳更旧也让步并记录）。
5. **每一步幂等可重放**：进程在任意一步被杀，重启后按待办清单收敛到一致状态。

## 3. 缓存与指纹

### 3.1 本地镜像结构（每端一份）

```
…/app-data/onethu-memory-mirror/     （桌面：app 数据目录；Android：App 沙盒同构；bot：容器卷）
├── OH-Memory/…                      # 与云盘 1:1 的 markdown 镜像（utf-8 原样字节）
└── .meta.json                       # 缓存账本：{ path → {size, mtime, sha1, origin_seen_at} }
```

- 指纹 = `sha1(文件字节)`。**不用 mtime 做判等**（秒级粒度 + 各端时钟偏差），mtime 只做「变更候选」粗筛（§3.2），判等永远用内容哈希。
- `.meta.json` 是账本不是数据库：损坏/丢失 = 冷启动全量拉取，代价可控（§7 量级评估）。

### 3.2 变更检测（refresh 算法）

```
refresh():
  for dir in 一级子目录:                       # OH-Memory 固定 6 个，见 01 文档 §3.1
    entries = fs.list(dir)
    for e in entries:
      prev = meta[dir/e.name]
      if prev == null:                        # 新文件
        plan_pull(dir/e.name)
      elif e.size != prev.size:               # 大小必变（内容变了）
        plan_pull(dir/e.name)
      elif e.mtime != prev.mtime:             # 秒级时间变了但大小没变 → 疑似
        plan_pull(dir/e.name)                 #   （宁可多拉，内容小）
      # else: 三元组未变 → 跳过（同大小同 mtime 内容变了的概率忽略不计）
    for p in meta 里属于 dir 但 entries 没有的:  # 远端删除/改名
      plan_tombstone(p)                       #   标记墓碑（本地移入镜像的 .trash 视图，不删账本前先提示 agent）
  for p in plan_pull:
    bytes = fs.read(p)
    if sha1(bytes) == meta[p].sha1:           # mtime 抖动，内容没变
      meta[p].mtime = 新 mtime                 #   只刷新账本
    else:
      落镜像 + 更新账本 + 记入 RefreshReport{changed, added, removed}
```

成本：无变更的例行刷新 = 6 次 list；有变更时每个变更文件 +1 次 read（记忆文件 KB 级）。

> 「待验证」：`GET /api/v2.1/repos/{id}/dir/detail/` 若在清华实例可用且子孙变更会传播到目录 mtime，则可先查 6 个目录的 detail，未变则跳过 list——省一点请求；**不可用也不影响正确性**（它是优化项不是依赖项）。

### 3.3 读己之写

写路径完成后立即回读该文件（+1 次 read），更新镜像与账本。不依赖服务端任何「写入即可见」的保证——实测 Seafile 自己的文件内容是立即可见的（下载不走搜索索引），只有**搜索索引**有延迟（seafile.rs:539 注释）。

## 4. 写协议（read-merge-write + 回读校验）

以 `memory_append` / `memory_edit` / `memory_write` 为例（Files Hub 的 files_commit 同构，只是合并函数不同）：

```
write(path, new_bytes, mode):
  base   = 镜像中该文件的账本指纹          # 我上次见过的版本
  remote = fs.read(path)                   # ① 不信缓存，拿远端真身（文件不存在则 None）

  if remote is None:                       # 新建
      fs.write(path, new_bytes, replace=false)   # replace=false：撞名则报错重命名再试
      verify(path, new_bytes); return

  if sha1(remote) == base.sha1:            # ② 远端还是我认识的那个版本
      fs.write(path, new_bytes, replace=true)    #    安全覆写（update-link / upload replace=1）
      verify(path, new_bytes); return

  # ③ 远端被别人改过了（base 之后有别端/人类的写入）
  theirs = parse(remote); mine_base = parse(镜像); mine_new = parse(new_bytes)

  if mode == append:                       # append 型：union 合并
      merged = merge_union(theirs, mine_base, mine_new)
      #   observations/relation 行级并集：他们新增的行 ∪ 我新增的行（按行文本去重），
      #   他们删除的行尊重删除（在 theirs 中消失且不在我新增集 → 不复活）
      fs.write(path, render(merged), replace=true)
      verify(path, render(merged)); return

  if mode == edit and theirs 可重放（edit 的 find/replace 可应用到 theirs）:
      theirs_applied = apply_edit(theirs, find, replace)
      fs.write(path, render(theirs_applied), replace=true)
      verify(path, ...); return            #    编辑操作可重放 = 天然可合并

  # ④ 不可合并的结构性冲突 → last-write-wins + 败者归档
  if is_human_edit(remote, base):          # 人类改的（启发式：origin 字段缺失/非 OH 格式变更）
      让步：本地放弃写入，返回「用户手改过，未覆盖；新内容已存 .conflict」
  else:
      fs.write(path, new_bytes, replace=true)     # 我方胜
  archive(.conflict/{path}__{loser_origin}__{ts}.md, remote)   # 败者完整归档
  verify(path, new_bytes)

verify(path, expect):                      # ⑤ 回读校验（防无锁窗口内再被覆盖）
  got = fs.read(path)
  if sha1(got) != sha1(expect):
      回到 ③ 重走（最多 2 次；仍失败则放弃并报告冲突，内容已安全归档）
```

### 4.1 为什么这套在无锁世界里够用

- 真实并发度：单用户三端，写频率 = 每次对话零~几条 append。两端同秒写同一文件是**极小概率事件**，协议的目标不是「永不丢」而是「丢了可恢复 + 不常发生」。
- append 占绝大多数（设计上引导 LLM 用 memory_append 而非反复 memory_write 重写整文），union 合并覆盖了最常见冲突面。
- verify 的回读窗口极窄（毫秒级），连续两次撞车才升级为用户可见冲突。
- 败者永远有全量归档 → 最坏情况是「多了一条 .conflict 文件需要人裁决」，不是「数据没了」。

### 4.2 明确不做的

- 不做 Seafile 桌面客户端协议（seaf-daemon 信道）——那是官方客户端专用，Web API 不可用。
- 不做 CRDT/操作日志——markdown 行级 union 已覆盖 append 场景，引入 CRDT 等于重建数据库，违背「弱智架构」。
- 不做定时双向后台同步——刷新只在会话驱动（01 文档 §5.3），避免无人值守写。

## 5. tombstone（远端删除）与人类编辑的识别

- 远端文件消失：镜像文件移入本地 `.trash-view/`（不删账本），下次 agent 相关 memory_read 命中时提示「该记忆曾被远端删除（可能是您在网页端删的）」。**不自动重新上传**（尊重删除）。
- `memory_delete` 的实现（软删除）：把文件移动到 `/OH-Memory/.trash/{date}-{原路径编码}.md`。rename API 待验证期间，退化实现 = 上传副本到 .trash + 原文件 frontmatter 加 `status: trashed`（不真删）。硬删（DELETE 端点）验证通过后再切。
- 人类编辑识别启发式：frontmatter 的 `modified` 字段被改但 `origin` 字段不是任何 OH 端值 / 或 OH 结构（三段式）被破坏 → 视为人类编辑，触发让步规则。

## 6. 时钟与时间戳纪律

- 所有写入的时间戳 = **本端生成 + 显式 +08:00 偏移**（ISO 8601）。不比较跨端时钟：排序用 modified 字段（各端自报，偏差可容忍——记忆场景没有「毫秒级定序」的需求）；**版本判定只看内容哈希，从不看时间**（§3.1）。
- 云端 bot 若跑 UTC 容器：显示层换算，存储层统一 +08:00（校园场景单一时区）。

## 7. 量级评估（这套设计的适用边界）

| 规模 | 刷新成本 | 检索成本 | 结论 |
|---|---|---|---|
| ≤300 文件（典型，1~2 年使用） | 6 list + 变更文件几个 read | 顺序扫描 <10ms | 完全够用 |
| ~1000 文件 | 同上（list 响应变大，单目录仍 <500 项因分片） | 扫描 ~30ms | 够用 |
| ~3000 文件（重度+journal 不清） | 冷启动全量拉 ~10MB | 需换倒排（JSON 索引文件，启动重建） | 分界点：启用 01 文档 §6.2 退化路径 ② |
| ≥1 万文件 | — | — | 超出个人记忆场景，届时应重新评估架构（也意味着该给记忆做归档清理了） |

## 8. 风险清单（与 01/02 互补，聚焦同步层）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| S1 | `replace=false` 上传撞名时的服务端行为（报错？自动改名？）未实测 | 中 | live 冒烟先行验证；实现侧按「报错即重命名重试」编码 |
| S2 | union 合并遇到「同一行被两端不同修改」 | 低 | 行级判等（整行文本），不同即双双保留（重复一行好过丢一行）；日志提示 |
| S3 | 镜像与云盘长期失同步（如端休眠一个月） | 低 | refresh 本来就是全量三元组比对，不存在增量状态腐化 |
| S4 | `.conflict/` 堆积 | 低 | 单文件、低频；agent 会话开场 refresh 报告里有冲突数，超 10 条提示用户清理 |
| S5 | tombstone 误判（用户在网页端把文件移到别的目录 = 删除+新增） | 低 | 前提是 permalink 寻址：文件在新路径被 refresh 拉回时按 permalink 反查账本识别为移动，恢复关联 |
| S6 | 云端 bot 与 App 同时在线高频互刷 | 低 | 刷新由会话驱动且 5 分钟阈值；无后台轮询，天然低频 |

## 9. 实现清单（同步层）

1. `MirrorCache`（镜像目录 + `.meta.json` 账本 + sha1）与 `refresh()`——可独立单测（对 CloudFs mock）。
2. `write()` 协议状态机（含 verify 重试）——对 mock CloudFs 注入并发写，全路径覆盖测试。
3. `.conflict/` 与 `.trash-view/` 的展示（agent 提示语 + 设置页只读列表）。
4. live 冒烟（复用 seafile.rs live 测试模式）：autotest 目录里双「端」交替写，验证 union 与归档。
