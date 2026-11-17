# 03 · 同步、冲突与缓存层设计（OH-Memory + Files Hub 公共底座）


> 归档说明：本文记录当时的设计稿与方案论证；0.11 当前功能与使用说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。


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

由此可见，基于现有 Web API 的「读-改-写」天然存在并发覆盖窗口，写请求本身也无法附带「仅当版本未变时写入」的条件断言。因此同步层直接围绕无锁现实设计冲突收敛与兜底归档。

## 2. 设计原则（按优先级）

1. **以云盘文件为唯一数据源**（本地镜像仅作缓存，随时可通过 `reindex` 全量重建，延续 basic-memory doctor 的思路）。
2. **写操作尽量采用追加语义**：追加型变更（append observation）冲突破坏性最小，可直接做行级并集（union）合并；结构性改写（`memory_edit` 或 `memory_write` 覆盖）则走完整的读-合-写校验协议（§4）。
3. **冲突显式留档**：遇到无法自动合并的冲突时，将落败版本的完整内容归档至 `.conflict/`，确保原始记录零丢失。
4. **人工编辑优先**：一旦检测到与用户在网页端手动修改发生冲突，agent 侧主动让步（即便用户改动时间戳更早也予以保留，并将待写内容转存冲突归档）。
5. **每步幂等可重放**：进程在任意步骤中断后，重启时均可依据待办清单收敛回一致状态。

## 3. 缓存与指纹

### 3.1 本地镜像结构（每端一份）

```
…/app-data/onethu-memory-mirror/     （桌面：app 数据目录；Android：App 沙盒同构；bot：容器卷）
├── OH-Memory/…                      # 与云盘 1:1 的 markdown 镜像（utf-8 原样字节）
└── .meta.json                       # 缓存账本：{ path → {size, mtime, sha1, origin_seen_at} }
```

- 指纹 = `sha1(文件字节)`。由于 `mtime` 仅有秒级粒度且各端存在时钟偏差，`mtime` 仅用于「变更候选」粗筛（§3.2），版本判等一律以内容哈希为准。
- `.meta.json` 仅作轻量缓存账本：一旦损坏或丢失，触发冷启动全量拉取即可重建，恢复开销完全可控（见 §7 量级评估）。

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

> 「待验证」：若 `GET /api/v2.1/repos/{id}/dir/detail/` 在清华实例可用且子孙变更会向上更新目录 mtime，可先查 6 个一级目录的 detail，未变时直接跳过 `list` 以节省请求；该端点属于纯性能优化，缺省回退逐目录 `list` 即可保证正确性。

### 3.3 读己之写

每次写入完成后立即回读该文件（增加 1 次 `read`），用实际落盘内容更新本地镜像与账本。实测 Seafile 文件下载直接读取存储内容，写入后立即可见，仅服务端**搜索索引**存在更新延迟（见 `seafile.rs:539` 注释）。

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

### 4.1 为什么这套方案在无锁环境下够用

- 真实并发度低：单用户跨三端使用时，每次对话通常只产生零到数条追加写入，两端在同一秒修改同一文件的概率极低。写协议重点保障低冲突率与冲突后的完整可恢复性。
- 追加操作占绝大多数（设计上引导 LLM 优先调用 `memory_append`，避免频繁调用 `memory_write` 重写全文），行级 union 合并覆盖了最常见的并发写入场景。
- `verify` 的回读校验窗口极窄（毫秒级），连续两次并发撞车才会升级为用户可见冲突。
- 冲突落败方始终有全量归档，极端并发下的结果也只是在 `.conflict/` 目录多出一份待人工裁决的副本，原始记录完整保留。

### 4.2 范围边界（本期不纳入）

- 跳过 Seafile 桌面客户端同步协议（`seaf-daemon` 专用信道仅供官方桌面客户端使用，Web API 环境无此通道）。
- 省略 CRDT 或复杂操作日志——Markdown 行级 union 已满足追加合并需求，保持纯文本无数据库的轻量形态。
- 默认关闭定时双向后台同步——刷新统一由会话按需触发（见 `01-memory-system.md` §5.3），避免后台静默写入。

## 5. tombstone（远端删除）与人类编辑的识别

- 远端文件消失：本地镜像将其移入 `.trash-view/`（保留账本记录），下次 agent 调用 `memory_read` 命中该条目时提示「该记忆已在云盘远端删除（可能由网页端手动移除）」，并尊重删除结果，避免自动重新上传。
- `memory_delete` 的实现（软删除）：将文件移入 `/OH-Memory/.trash/{date}-{原路径编码}.md`。在 rename API 完成清华实例验证前，先行采用「上传副本至 `.trash` + 原文件 frontmatter 标注 `status: trashed`」的兼容路径；待硬删除（`DELETE` 端点）验证通过后再切换。
- 人类编辑识别启发式：若文件内容或 `modified` 字段已变动，而 frontmatter 的 `origin` 未标识为已知 OH 端，或标准三段式结构被改写，即判定为用户手动编辑并触发让步保留规则。

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
