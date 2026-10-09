/**
 * IM 通道注册表与核心策略层。
 *
 * 职责切分（照 openclaw 契约，docs/im-cloud/00 §3）：**策略都在 core**——
 * 绑定/白名单/命令/OH 对接在这里；适配器只做平台翻译，不能自判放行。
 *
 * P0 单主人模型：一台机器每通道只绑定一个发送者（/bind 限时码，借鉴 zcode）。
 * 未绑定者收到限频的引导回复（防骚扰放大），已绑定者进 OH 单飞队列。
 */
import { useSyncExternalStore } from "react";
import { loadImConfig, patchImConfig, configSnapshot, type ImConfig } from "./store.js";
import { askOh } from "./oh.js";
import { logLine } from "../lib/clients.js";
import type { ChannelAdapter, ChannelId, ChannelStatus, InboundMessage } from "./types.js";

/* ── 适配器注册（feishu/wechat 由 boot.ts 装配注册——避免设置页打开即
 *    拉起全部协议代码；registry 不反向 import 任何适配器） ── */
const adapters = new Map<ChannelId, ChannelAdapter>();

export function registerAdapter(a: ChannelAdapter): void {
  adapters.set(a.id, a);
}

export function getAdapter(id: ChannelId): ChannelAdapter | undefined {
  return adapters.get(id);
}

/* ── 状态存储（UI 订阅源） ── */
const statuses = new Map<ChannelId, ChannelStatus>();
const statusListeners = new Set<() => void>();

const offStatus = (): ChannelStatus => ({ phase: "off", note: "", lastInboundAt: 0, lastOutboundAt: 0, at: 0 });

function setStatus(id: ChannelId, patch: Partial<ChannelStatus>): void {
  const prev = statuses.get(id) ?? offStatus();
  statuses.set(id, { ...prev, ...patch, at: Date.now() });
  for (const l of statusListeners) l();
}

export function channelStatus(id: ChannelId): ChannelStatus {
  return statuses.get(id) ?? offStatus();
}

function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function statusSnapshot(): Map<ChannelId, ChannelStatus> {
  return statuses;
}

export function useChannelStatus(id: ChannelId): ChannelStatus {
  const snap = useSyncExternalStore(subscribeStatus, statusSnapshot);
  return snap.get(id) ?? offStatus();
}

/* ── 生命周期 ── */

const running = new Set<ChannelId>();

/** 启动一个通道（幂等：已在跑则先停再启——配置变更路径复用同一入口） */
export async function startChannel(id: ChannelId): Promise<void> {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`通道未注册：${id}`);
  const cfg = await loadImConfig();
  if (!cfg.enabled[id]) throw new Error("通道未启用");
  const probe = adapter.probe();
  if (!probe.configured) throw new Error(`配置不完整：缺 ${probe.missing}`);
  await stopChannel(id);
  running.add(id);
  setStatus(id, { phase: "connecting", note: "" });
  try {
    await adapter.start((msg) => void handleInbound(msg));
    setStatus(id, { phase: "online", note: "" });
    void logLine(`[IM] ${id} 已连接`);
  } catch (e) {
    running.delete(id);
    const note = e instanceof Error ? e.message : String(e);
    setStatus(id, { phase: "error", note });
    throw e;
  }
}

export async function stopChannel(id: ChannelId): Promise<void> {
  const adapter = adapters.get(id);
  if (adapter && running.has(id)) {
    running.delete(id);
    try {
      await adapter.stop();
    } catch (e) {
      void logLine(`[IM] ${id} 停止异常：${String(e).slice(0, 120)}`);
    }
  }
  setStatus(id, { phase: "off", note: "" });
}

/** 适配器内部状态上报（重连/暂停/错误——不改变 running 语义，仅反映连接健康度） */
export function reportChannelStatus(id: ChannelId, phase: ChannelStatus["phase"], note = ""): void {
  setStatus(id, { phase, note });
}

export function isChannelRunning(id: ChannelId): boolean {
  return running.has(id);
}

/* ── 会话菜单（/sessions 列表 → /switch 序号映射；会话级，10 分钟过期） ── */
const sessionMenu = new Map<string, string[]>();

/* ── 附件待确认暂存（per 通道+发送者；10 分钟过期；两段式：确认后才上云盘） ── */
interface PendingAtt {
  staged: Array<import("./mediaPipe.js").StagedAttachment>;
  at: number;
}
const pendingAtt = new Map<string, PendingAtt>();
const PENDING_TTL_MS = 10 * 60_000;
const pkOf = (channel: string, sender: string): string => `${channel}:${sender}`;

/* ── 待确认写操作（预约/取消/发信等；IM 侧加固：模糊肯定词不执行，防误触） ── */
interface PendingConfirm {
  summary: string;
  at: number;
}
const pendingConfirm = new Map<string, PendingConfirm>();
const PENDING_CONFIRM_TTL_MS = 10 * 60_000;

/* ── 最近入库记录（30 分钟；用户回「要链接」时按需生成公开分享——默认绝不分享） ── */
interface LastStored {
  repoId: string;
  path: string;
  at: number;
}
const lastStored = new Map<string, LastStored>();
const LAST_STORED_TTL_MS = 30 * 60_000;

/* ── 绑定码（内存态，10 分钟有效；设置页生成，IM 内发送 /bind 码完成绑定） ── */
let bindCode: { code: string; expiresAt: number } | null = null;

export function newBindCode(): string {
  // 去混淆字符集（无 0/O/1/I/L），6 位
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  const rand = new Uint8Array(6);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 6; i++) code += alphabet[rand[i]! % alphabet.length];
  bindCode = { code, expiresAt: Date.now() + 10 * 60 * 1000 };
  return code;
}

export function bindCodeInfo(): { code: string; expiresAt: number } | null {
  return bindCode;
}

export async function unbind(channel: ChannelId): Promise<void> {
  await patchImConfig((cfg) => {
    delete cfg.bindings[channel];
  });
}

/* ── 入站策略（core 唯一入口） ── */

/** 未绑定发送者的引导回复限频：每发送者 60 秒最多一条 */
const noticeAt = new Map<string, number>();

async function handleInbound(msg: InboundMessage): Promise<void> {
  const cfg = configSnapshot() ?? (await loadImConfig());
  setStatus(msg.channel, { lastInboundAt: Date.now() });
  const text = msg.text.trim();
  if (!text && msg.attachments.length === 0) return;

  /* 命令层：/bind、/status（core 终结，不进 OH） */
  /* ── 会话管理（与 ChatDock 同一套 core 命令；1 号主对话永久保留） ── */
  {
    const t0 = text.trim();
    const pk0 = pkOf(msg.channel, msg.sender);
    const { ohRun } = await import("./oh.js");
    const menu = () => sessionMenu.get(pk0) ?? [];

    if (t0 === "/help" || t0 === "/帮助" || t0 === "/?") {
      await replyTo(
        msg,
        [
          "📖 指令清单：",
          "/list · /new · /switch N · /detail N [x-y] · /delete N · /search 关键词",
          "/bind 码（绑定主人）· /status（通道状态）",
          "",
          "· /list —— 列出会话（1=主对话，永久保留不可删；←当前）",
          "· /new —— 新建会话并切换",
          "· /switch N —— 切换到编号 N 的会话",
          "· /detail N [x-y] —— 查看编号 N 会话的第 x 到 y 轮（默认 1-5）",
          "· /delete N —— 删除编号 N 的会话（1 号主对话不可删）",
          "· /search 关键词 —— 查找关键词出现在哪些会话（含轮次定位）",
          "",
          "📎 发文件/图片给我：自动读取内容、建议云盘目录，回「存」确认转存（默认不出公开链接，回「要链接」再生成）。",
          "⚠️ 预约/取消等写操作：出现确认提示后回「确认执行」才执行（省略回复不认，防误触）。",
        ].join("\n"),
      );
      return;
    }

    if (t0 === "/list" || t0 === "/sessions" || t0 === "/会话") {
      const r = (await ohRun("list_sessions")) as
        | { active?: string; sessions?: Array<{ id: string; title: string; updatedAt: number; messages: number }> }
        | null;
      const list = r?.sessions ?? [];
      if (!list.length) {
        await replyTo(msg, "还没有会话。");
        return;
      }
      sessionMenu.set(pk0, list.map((x) => x.id));
      const lines = list.slice(-10).reverse().map((x, i) => {
        const no = list.length - Math.min(list.length, 10) + i + 1;
        const cur = x.id === r?.active ? " ←当前" : "";
        const main = no === 1 ? "① 主对话 · " : "";
        const tm = new Date(x.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return `${no}. ${main}${x.title || "（未命名）"} · ${x.messages} 轮 · ${tm}${cur}`;
      });
      await replyTo(msg, `会话（最近 10 条，1 号为主对话）：\n${lines.join("\n")}\n/detail N 看内容 · /switch N 切换 · /delete N 删除`);
      return;
    }

    if (t0 === "/new" || t0 === "/新会话") {
      const r = (await ohRun("new_session")) as { ok?: boolean } | null;
      await replyTo(msg, r?.ok ? "已开新会话（1 号主对话仍保留，/switch 1 可回）。" : "新建失败。");
      return;
    }

    if (t0.startsWith("/switch")) {
      const arg = t0.slice(7).trim();
      const id = /^\d+$/.test(arg) ? menu()[Number(arg) - 1] : arg;
      if (!id) {
        await replyTo(msg, "先回 /list 看编号，再「/switch 编号」。");
        return;
      }
      const r = (await ohRun("switch_session", id)) as { ok?: boolean } | null;
      await replyTo(msg, r?.ok ? "已切换。/detail 1 5-8 可直接看第 5-8 轮。" : "切换失败（编号过期？回 /list 重看）。");
      return;
    }

    if (t0.startsWith("/detail")) {
      const m = /^\/detail\s+(\d+)(?:\s+(\d+)-(\d+))?/.exec(t0);
      if (!m) {
        await replyTo(msg, "用法：/detail 编号 [起始轮-结束轮]，如 /detail 2 或 /detail 1 5-8（默认 1-5）。");
        return;
      }
      const id = menu()[Number(m[1]) - 1];
      if (!id) {
        await replyTo(msg, "编号不存在（先 /list）。");
        return;
      }
      const from = Math.max(1, Number(m[2] ?? 1));
      const to = Math.min(from + 19, Number(m[3] ?? from + 4));
      const ex = (await ohRun("export_session", id)) as { ok?: boolean; json?: string } | null;
      if (!ex?.ok || !ex.json) {
        await replyTo(msg, "读取失败。");
        return;
      }
      const sess = JSON.parse(ex.json) as { title?: string; messages?: Array<{ role: string; content: string }> };
      // 分轮：user 消息开新轮，轮内聚合其后的 assistant 消息
      const rounds: Array<{ u: string; a: string[] }> = [];
      for (const mm of sess.messages ?? []) {
        if (mm.role === "user") rounds.push({ u: mm.content ?? "", a: [] });
        else if (rounds.length > 0 && mm.role === "assistant") rounds[rounds.length - 1]!.a.push(mm.content ?? "");
      }
      if (!rounds.length) {
        await replyTo(msg, "该会话没有可显示的对话轮。");
        return;
      }
      const clamp = (str: string, n: number): string => {
        const flat = str.replace(/\s+/g, " ").trim();
        return flat.length > n ? flat.slice(0, n) + "…" : flat || "（空）";
      };
      const out: string[] = [`《${sess.title || "未命名"}》共 ${rounds.length} 轮，显示第 ${from}-${Math.min(to, rounds.length)} 轮：`];
      for (let i = from; i <= Math.min(to, rounds.length); i++) {
        const rr = rounds[i - 1]!;
        out.push(`〔${i}〕用户：${clamp(rr.u, 120)}`);
        out.push(`     OH：${clamp(rr.a.join(" "), 400)}`);
      }
      await replyTo(msg, out.join("\n"));
      return;
    }

    if (t0.startsWith("/delete")) {
      const arg = t0.slice(7).trim();
      if (!/^\d+$/.test(arg) || !menu()[Number(arg) - 1]) {
        await replyTo(msg, "用法：/delete 编号（先 /list 查看）。");
        return;
      }
      if (Number(arg) === 1) {
        await replyTo(msg, "1 号主对话永久保留，不可删除（用户定案）。想清空就 /switch 1 后 /new 新开。");
        return;
      }
      const id = menu()[Number(arg) - 1]!;
      const r = (await ohRun("delete_session", id)) as { ok?: boolean; error?: string; active?: string } | null;
      if (r?.ok) {
        // 菜单同步（去掉被删项）
        sessionMenu.set(pk0, menu().filter((x) => x !== id));
        await replyTo(msg, `已删除编号 ${arg} 的会话。`);
      } else {
        await replyTo(msg, r?.error ?? "删除失败。");
      }
      return;
    }

    if (t0.startsWith("/search")) {
      const kw = t0.slice(7).trim();
      if (!kw) {
        await replyTo(msg, "用法：/search 关键词（搜会话标题与内容）。");
        return;
      }
      const r = (await ohRun("list_sessions")) as { sessions?: Array<{ id: string; title: string }> } | null;
      const list = (r?.sessions ?? []).slice(-20); // 最近 20 条防慢
      sessionMenu.set(pk0, (r?.sessions ?? []).map((x) => x.id));
      const hits: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const ex = (await ohRun("export_session", list[i]!.id)) as { ok?: boolean; json?: string } | null;
        if (!ex?.ok || !ex.json) continue;
        const sess = JSON.parse(ex.json) as { title?: string; messages?: Array<{ role: string; content: string }> };
        const rounds: Array<number> = [];
        let ri = 0;
        for (const mm of sess.messages ?? []) {
          if (mm.role === "user") ri++;
          if ((mm.content ?? "").includes(kw)) {
            if (!rounds.includes(ri)) rounds.push(ri);
          }
        }
        const inTitle = (sess.title ?? "").includes(kw);
        if (inTitle || rounds.length) {
          const no = (r?.sessions ?? []).indexOf(list[i]!) + 1;
          hits.push(`${no}. 《${sess.title || "未命名"}》${inTitle ? "（标题命中）" : `（第 ${rounds.slice(0, 6).join("、")} 轮）`}`);
        }
      }
      await replyTo(
        msg,
        hits.length
          ? `「${kw}」命中 ${hits.length} 个会话：\n${hits.join("\n")}\n/detail 编号 查看（/list 重取编号）。`
          : `「${kw}」没有命中（搜了最近 20 条会话的标题与内容）。`,
      );
      return;
    }
  }

  /* 云盘自动连接（兜底引导：无 token 时用户一条指令完成 SSO 爬取填充） */
  if (text.trim() === "/连云盘" || text.trim() === "连云盘" || text.trim() === "连接云盘") {
    const { autoConnectSeafile } = await import("../state/seafileAuto.js");
    const r = await autoConnectSeafile();
    await replyTo(
      msg,
      r.ok
        ? `✅ 云盘已自动连接（${r.account?.name}）——现在可以转存文件了。`
        : `连接失败：${r.error ?? "未知原因"}。也可在电脑端 OneTHU 的「云盘」页手动粘贴 token。`,
    );
    return;
  }

  if (text.startsWith("/bind")) {
    const code = text.slice(5).trim().toUpperCase();
    if (!bindCode || Date.now() > bindCode.expiresAt) {
      await replyTo(msg, "绑定码已过期：请在电脑端重新生成后发送「/bind 码」。");
      return;
    }
    if (code !== bindCode.code) {
      await replyTo(msg, "绑定码不正确，请核对后重发「/bind 码」。");
      return;
    }
    bindCode = null;
    await patchImConfig((c) => {
      c.bindings[msg.channel] = msg.sender;
    });
    await replyTo(msg, "绑定成功，这台电脑的 OneTHU 现在听你指挥。发送 /status 查看状态。");
    void logLine(`[IM] ${msg.channel} 完成绑定 sender=${msg.sender.slice(0, 10)}…`);
    return;
  }
  if (text === "/status") {
    const bound = cfg.bindings[msg.channel] === msg.sender ? "已绑定" : "未绑定";
    await replyTo(msg, `[OneTHU] ${msg.channel} 通道在线，${bound}。电脑保持开机与 OneTHU 运行，我才会回复。`);
    return;
  }

  /* 白名单：仅绑定者可驱动 OH（默认 allowlist——R2 安全红线，docs/im-cloud/00 §8） */
  if (cfg.bindings[msg.channel] !== msg.sender) {
    const key = `${msg.channel}:${msg.sender}`;
    const last = noticeAt.get(key) ?? 0;
    if (Date.now() - last > 60_000) {
      noticeAt.set(key, Date.now());
      await replyTo(msg, "这台电脑的 OneTHU 未与你绑定：请让机主在 设置 → IM 机器人 生成绑定码，再发送「/bind 码」。");
    }
    return;
  }

  /* 附件（M3 转存云盘管线上线前的占位回复） */
  if (msg.attachments.length > 0) {
    const { stageAttachment } = await import("./mediaPipe.js");
    const adapter = adapters.get(msg.channel);
    const staged: Array<import("./mediaPipe.js").StagedAttachment> = [];
    const errs: string[] = [];
    for (const att of msg.attachments) {
      try {
        let ref = att.ref as import("./mediaPipe.js").AttachmentRef | null;
        if (adapter?.resolveAttachment) {
          ref = await adapter.resolveAttachment(att.ref, att.messageId);
        }
        if (!ref?.fetchUrl) {
          errs.push(`- ${att.name}：该类型暂不支持（首版支持图片/文件/视频）`);
          continue;
        }
        staged.push(await stageAttachment(msg.channel as "wechat" | "feishu", att.name, ref));
      } catch (e) {
        errs.push(`- ${att.name}：读取失败（${e instanceof Error ? e.message : String(e)}）`);
      }
    }
    if (!staged.length) {
      await replyTo(msg, `附件处理失败：\n${errs.join("\n")}`);
      return;
    }
    pendingAtt.set(pkOf(msg.channel, msg.sender), { staged, at: Date.now() });
    // 库状态提示：已配置→写出库名；未配置→列候选让用户选（不猜）
    let repoHint = "";
    try {
      const { configuredRepo, listRepos } = await import("./mediaPipe.js");
      const repo = await configuredRepo();
      if (repo) {
        repoHint = `（转存将放入你的资料库《${repo.repoName}》）`;
      } else {
        const repos = await listRepos();
        repoHint = repos.length
          ? `你还没指定存到哪个资料库。你的资料库：\n${repos.map((r, i) => `  ${i + 1}. ${r.name}`).join("\n")}\n回复「存 <序号>」选定并存到建议目录。`
          : "（你云盘里还没有资料库，先在网页端建一个）";
      }
    } catch (e) {
      repoHint = `（云盘未连接或读取失败：${e instanceof Error ? e.message : String(e)}）`;
    }
    const parts: string[] = [];
    // 兜底：云盘未连接时如实告知（只能看内容不能转存，给一键连接指令）
    try {
      const { getSeafileToken, ensureSeafileLoaded } = await import("../state/seafile.js");
      await ensureSeafileLoaded();
      if (!getSeafileToken()) {
        parts.push("⚠️ 云盘未连接：现在只能看内容，不能转存。回「连云盘」我自动获取凭证。");
      }
    } catch {
      /* 状态读取失败不拦流程 */
    }
    for (let i = 0; i < staged.length; i++) {
      const s = staged[i]!;
      parts.push(`${staged.length > 1 ? `${i + 1}. ` : ""}《${s.name}》${s.sizeNote ? `（${s.sizeNote}）` : ""}`);
      if (s.preview) {
        const content = s.preview.replace(/\s+/g, " ").trim().slice(0, 400);
        parts.push(`  内容开头：${content}${s.preview.length > 400 ? "…" : ""}`);
        parts.push("  （想了解更多直接问我「里面讲了什么」）");
      } else {
        parts.push("  （非文本文件，我读不出文字内容）");
      }
      parts.push(`  要存云盘的话建议放 ${s.suggest.dir || `默认位置（/IM/${s.channel}）`}（${s.suggest.reason}）`);
    }
    parts.push(repoHint);
    parts.push("回「存」按建议转存 /「存到 <目录>」自定义 /「不」忽略（不存也没关系）。");
    if (errs.length) parts.push(...errs);
    await replyTo(msg, parts.join("\n"));
    return;
  }
  if (!text) return;

  /* 附件待确认层：先解析对「上一个文件」的处置意图，再走正常流程 */
  {
    const pk = pkOf(msg.channel, msg.sender);
    const pend = pendingAtt.get(pk);
    if (pend && Date.now() - pend.at > PENDING_TTL_MS) pendingAtt.delete(pk);
    const cur = pendingAtt.get(pk);
    if (cur && text) {
      const t = text.trim();
      // 整句确认词 / 「存 N」选库并存 / 含「转存/存到云盘」明示意向；避免「要查课表」这类误判
      const seqStore = /^(?:存|转存|存到|放到|存入|存在|放进)\s*\d+\s*$/.test(t);
      const isStore =
        /^(存|存吧|要|好|可以|确认|转存|好呀|ok)$/i.test(t) || /转存|存到云盘/.test(t) || seqStore;
      const custom = /(?:存到|放到|存入|存在|存进|放进)\s*[《"'“]?([^》"'”\n]+)/.exec(t);
      const isSkip = /^(不|不用|算了|忽略|取消|别存)/.test(t);
      if (isStore || custom) {
        const { commitStored, configuredRepo, listRepos, setRepo } = await import("./mediaPipe.js");
        let target = custom?.[1]?.trim();

        // ① 未指定资料库：先引导选库（**绝不自动猜**——用户实测曾被存进「OneTHU 发布」发布库）
        let repo = await configuredRepo();
        if (!repo) {
          try {
            const { getSeafileToken, ensureSeafileLoaded } = await import("../state/seafile.js");
            await ensureSeafileLoaded();
            if (!getSeafileToken()) {
              await replyTo(msg, "云盘还没连接——回「连云盘」我自动获取（或去电脑端云盘页手动配置）。");
              return;
            }
          } catch {
            /* 落到原选库引导 */
          }
          const repos = await listRepos().catch(() => [] as Array<{ id: string; name: string }>);
          if (!repos.length) {
            await replyTo(msg, "云盘里没有资料库（先在 cloud.tsinghua.edu.cn 建一个再回「存」）。");
            return;
          }
          const seq = /(?:存|转存|存到|放在|放到|存入|存在|放进)\s*(\d+)\s*$/.exec(t)?.[1];
          let pick = seq ? repos[Number(seq) - 1] : undefined;
          if (!pick && target) {
            pick = repos.find((r) => r.name === target) ?? repos.find((r) => target!.includes(r.name));
            if (pick && target === pick.name) target = "";
          }
          if (!pick) {
            await replyTo(
              msg,
              `还没指定存到哪个资料库。你的资料库：\n${repos.map((r, i) => `${i + 1}. ${r.name}`).join("\n")}\n回复「存 <序号>」选定并存到建议目录（也可回「存到 <库名>」）。`,
            );
            return; // pending 保留，等用户选库
          }
          await setRepo(pick.id, pick.name);
          repo = { repoId: pick.id, repoName: pick.name };
        }

        // ② 库已定：执行转存
        pendingAtt.delete(pk);
        const out: string[] = [];
        let storedAny = false;
        for (const s of cur.staged) {
          try {
            const r = await commitStored(s, target);
            lastStored.set(pk, { repoId: r.repoId, path: r.path, at: Date.now() });
            storedAny = true;
            const size =
              r.size > 0
                ? r.size > 1048576
                  ? `，${(r.size / 1048576).toFixed(1)}MB`
                  : `，${Math.max(1, Math.round(r.size / 1024))}KB`
                : "";
            out.push(`· 《${s.name}》已存入云盘《${r.repoName}》${r.path}${size}`);
          } catch (e) {
            out.push(`· 《${s.name}》转存失败：${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const tail = storedAny
          ? "\n（只存在你自己的资料库里，未生成任何公开链接；需要公开分享链接回「要链接」。）"
          : "";
        await replyTo(msg, `转存完成：\n${out.join("\n")}${tail}`);
        return;
      }
      if (isSkip) {
        pendingAtt.delete(pk);
        await replyTo(msg, "已忽略，未上传。");
        return;
      }
      // 「问内容」：读文件正文交给 OH 回答（不消费待确认，用户还能继续存）
      const isAsk = /(里面|内容|讲的?什么|是什么|啥内容|看一?下|看看|读一?下|读读|详情|介绍|概括|总结|摘要)/.test(t);
      if (isAsk) {
        const { readAttachmentText } = await import("./mediaPipe.js");
        const s0 = cur.staged[0]!;
        const content = await readAttachmentText(s0.localPath, 12_000);
        if (!content) {
          await replyTo(
            msg,
            `《${s0.name}》不是可读文本（二进制/图片等），我读不出文字内容。回「存」转存 /「不」忽略。`,
          );
          return;
        }
        const q =
          `（文件问答：用户刚通过 IM 发来文件《${s0.name}》，正文如下；请只基于它回答，不要猜）\n` +
          `---BEGIN ${s0.name}---\n${content}\n---END---\n` +
          `用户问：${t}`;
        const r = await askOh(q);
        const ans = r.error ? `读取失败：${r.error}` : r.answer ?? "（没有回答）";
        await replyTo(msg, `${ans}\n\n（文件仍在待确认：回「存」转存 /「存到 <目录>」/「不」忽略）`);
        return;
      }
      // 其他意图：保留待确认，提示后继续正常流程（可能是在问别的）
      await replyTo(msg, "（刚才的文件还在待确认：「存」转存 /「不」忽略 /「存到 <目录>」自定义）");
    }
  }

  /* 待确认写操作拦截（安全核心）：core 的确认词很宽（好/是/ok/同意…都能触发执行），
   * 桌面端有确认按钮无妨，IM 里必须收紧——只有明确指令才执行；模糊肯定词只提示不执行
   * （且不透传：core 侧 pending 保留，用户可再明确回复）。 */
  {
    const pk2 = pkOf(msg.channel, msg.sender);
    const pc = pendingConfirm.get(pk2);
    if (pc && Date.now() - pc.at > PENDING_CONFIRM_TTL_MS) pendingConfirm.delete(pk2);
    const cur2 = pendingConfirm.get(pk2);
    if (cur2 && text) {
      const t2 = text.trim();
      if (/^(确认执行|确认预约|确认预订|确认取消|确认提交|确认|执行)$/.test(t2)) {
        pendingConfirm.delete(pk2);
        const r = await askOh("确认");
        await replyTo(msg, r.error ? `⚠ ${r.error}` : r.answer ?? "(无响应)");
        return;
      }
      if (/^(取消|不|不用|算了|放弃|不了|不要)$/.test(t2)) {
        pendingConfirm.delete(pk2);
        const r = await askOh("取消");
        await replyTo(msg, r.error ? `⚠ ${r.error}` : r.answer ?? "(已取消)");
        return;
      }
      if (/^(好|好的|好呀|是|是的|ok|OK|同意|确定|行|对|y|Y|yes|嗯)$/.test(t2)) {
        // 不透传：避免 core 的宽匹配直接执行
        await replyTo(
          msg,
          `这条是省略回复，IM 里不认（防你手快误触执行）。\n待确认操作：${cur2.summary}\n要执行请回「确认执行」；不需要请回「取消」。`,
        );
        return;
      }
      pendingConfirm.delete(pk2); // 用户显然在说别的：交给正常流程（core 会清自身 pending）
    }
  }

  /* 按需公开分享：用户明确说「要链接/分享」时，对最近入库文件生成 7 天链接 */
  {
    const pk = pkOf(msg.channel, msg.sender);
    const ls = lastStored.get(pk);
    if (ls && Date.now() - ls.at < LAST_STORED_TTL_MS && /(要|给|生成|发)(个|一个)?(公开)?(分享)?链接|分享链接|要分享/.test(text)) {
      try {
        const { shareLast } = await import("./mediaPipe.js");
        const link = await shareLast(ls.repoId, ls.path);
        await replyTo(msg, `公开分享链接（7 天有效，拿到链接的人都能访问）：\n${link}\n文件：${ls.path}`);
      } catch (e) {
        await replyTo(msg, `生成分享链接失败：${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
  }

  /* OH 单飞队列（两段式确认：confirm 卡片 → 回复「确认/取消」即下一轮 chat 输入，
   * 与 ChatDock 的确认按钮同一映射） */
  const r = await askOh(text);
  const parts: string[] = [];
  if (r.error) parts.push(`⚠ ${r.error}`);
  if (r.answer) parts.push(r.answer);
  if (r.confirm?.summary) {
    pendingConfirm.set(pkOf(msg.channel, msg.sender), { summary: r.confirm.summary, at: Date.now() });
    parts.push(
      `⚠️ 待确认操作\n${r.confirm.summary}\n回「确认执行」执行，或回「取消」放弃。\n（IM 里不认「好/ok」等省略回复，防误触；10 分钟内有效）`,
    );
  }
  await replyTo(msg, parts.join("\n\n") || "(空响应)");
}

/** core 内部回复（命令/引导语/OH 应答统一走适配器出口） */
async function replyTo(orig: InboundMessage, text: string): Promise<void> {
  const adapter = adapters.get(orig.channel);
  if (!adapter) return;
  try {
    await adapter.send(orig, text);
    setStatus(orig.channel, { lastOutboundAt: Date.now() });
  } catch (e) {
    void logLine(`[IM] ${orig.channel} 回复失败：${String(e).slice(0, 120)}`);
  }
}

/* ── boot：App 启动恢复已启用通道（设置开关驱动启停） ── */
export async function bootChannels(): Promise<void> {
  const cfg: ImConfig = await loadImConfig();
  for (const id of Object.keys(cfg.enabled) as ChannelId[]) {
    if (!cfg.enabled[id]) continue;
    const adapter = adapters.get(id);
    if (!adapter || !adapter.probe().configured) continue;
    void startChannel(id).catch((e: unknown) => {
      void logLine(`[IM] ${id} 启动失败：${String(e).slice(0, 120)}`);
    });
  }
}
