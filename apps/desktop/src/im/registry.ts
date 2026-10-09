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

/* ── 附件待确认暂存（per 通道+发送者；10 分钟过期；两段式：确认后才上云盘） ── */
interface PendingAtt {
  staged: Array<import("./mediaPipe.js").StagedAttachment>;
  at: number;
}
const pendingAtt = new Map<string, PendingAtt>();
const PENDING_TTL_MS = 10 * 60_000;
const pkOf = (channel: string, sender: string): string => `${channel}:${sender}`;

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
  if (r.confirm?.summary) parts.push(`${r.confirm.summary}\n（回复「确认」执行，「取消」放弃）`);
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
