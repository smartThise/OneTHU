/**
 * 邮箱页 —— 复用云日历凭据（IMAP 收 / SMTP 发，Rust 直连）。
 *
 * 布局：宽屏两栏（列表 + 阅读），窄屏（灵动岛面板/手机竖屏）单栏推入。
 * 正文：text/plain 直排；html-only 走 sandbox iframe（禁脚本/禁跳转，外链
 * 只能手动复制——学生邮件场景够用且安全）。写信：弹层表单（to/cc/主题/正文）。
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/context.js";
import { MAIL_FOLDERS, useMail, useMailCounts, useMailBody, sendMail, mailSearch, type MailHead } from "../state/mail.js";
import { IconMail, IconRefresh, IconPen, IconChevron } from "../components/Icons.js";
import { CollectStar } from "../components/Collect.js";
import { showToast } from "../state/toast.js";

/** 邮件时间：今天 14:05 / 昨天 / 9月5日 / 2025年12月3日 */
function fmtMailDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yd)) return "昨天";
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 发件人头像底色：名字哈希 → 稳定色相 */
function avatarHue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

function senderName(from: string): string {
  const m = /^"?([^"<]*)"?\s*</.exec(from);
  const name = m?.[1]?.trim();
  if (name) return name;
  return from.split("@")[0] || from || "(无发件人)";
}

function Row({ h, folder, active, onClick }: { h: MailHead; folder: string; active: boolean; onClick: () => void }): React.ReactNode {
  const name = senderName(h.from);
  return (
    <div
      className={`mail-row${active ? " active" : ""}${h.seen ? "" : " unread"}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      <span className="mail-avatar" style={{ background: `hsl(${avatarHue(name)} 55% 45%)` }}>
        {[...name][0]?.toUpperCase() ?? "?"}
      </span>
      <span className="mail-row-main">
        <span className="mail-row-top">
          <span className="mail-row-from">{name}</span>
          <span className="mail-row-date">{fmtMailDate(h.dateMs)}</span>
        </span>
        <span className="mail-row-subject">{h.subject}</span>
      </span>
      <CollectStar atom={{ kind: "mail", key: `${folder}#${h.uid}` }} title={h.subject} />
      {!h.seen && <span className="mail-dot" aria-label="未读" />}
    </div>
  );
}

function Compose({ onClose, onSent }: { onClose: () => void; onSent: (msg: string) => void }): React.ReactNode {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (): Promise<void> => {
    if (sending) return;
    setSending(true);
    setErr(null);
    try {
      await sendMail(to, cc, subject, body);
      onSent("已发送");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="mail-compose-mask" onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className="mail-compose">
        <div className="mail-compose-head">
          <h2>写信</h2>
          <button className="btn btn-ghost" onClick={onClose} disabled={sending}>取消</button>
        </div>
        <div className="mail-compose-fields">
          <label>
            收件人
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="user@mails.tsinghua.edu.cn（多个用逗号分隔）" autoFocus />
          </label>
          <label>
            抄送
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="可选" />
          </label>
          <label>
            主题
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="邮件主题" />
          </label>
          <label>
            正文
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="正文（纯文本）" />
          </label>
        </div>
        {err && <div className="mail-compose-err">{err}</div>}
        <div className="mail-compose-foot">
          <button className="btn btn-primary" onClick={() => void send()} disabled={sending || to.trim().length === 0}>
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({ folder, uid, onBack }: { folder: string; uid: number; onBack: () => void }): React.ReactNode {
  const { body, loading, error } = useMailBody(folder, uid);
  const head = useMail(folder).heads.find((h) => h.uid === uid);
  // html 邮件：sandbox iframe + 暗色适配样式注入；禁脚本/禁顶层跳转（外链复制手动开）
  const srcDoc = useMemo(() => {
    if (!body?.html) return null;
    return `<!doctype html><html><head><meta charset="utf-8">
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.65 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 14px; word-break: break-word; }
img { max-width: 100%; height: auto; }
a { color: #2f6df6; }
@media (prefers-color-scheme: dark) { body { color: #e8e8ea; background: transparent; } a { color: #7ba2ff; } }
</style></head><body>${body.html}</body></html>`;
  }, [body?.html]);
  return (
    <div className="mail-detail">
      <div className="mail-detail-head">
        <button className="btn btn-ghost mail-back" onClick={onBack}>
          <IconChevron style={{ transform: "rotate(180deg)" }} /> 返回
        </button>
        {head && (
          <span className="mail-detail-headside">
            <span className="mail-detail-date">{fmtMailDate(head.dateMs)}</span>
            <CollectStar atom={{ kind: "mail", key: `${folder}#${uid}` }} title={head.subject} />
          </span>
        )}
      </div>
      {loading && <div className="mail-empty">读取中…</div>}
      {error && <div className="mail-empty">读取失败：{error}</div>}
      {body && !loading && (
        <>
          <h2 className="mail-detail-subject">{body.subject}</h2>
          <div className="mail-detail-meta">
            <span className="mail-avatar" style={{ background: `hsl(${avatarHue(senderName(body.from))} 55% 45%)` }}>
              {[...senderName(body.from)][0]?.toUpperCase() ?? "?"}
            </span>
            <span className="mail-detail-meta-main">
              <span className="mail-detail-from">{body.from || "(无发件人)"}</span>
              {body.to && <span className="mail-detail-to">收件人：{body.to}</span>}
            </span>
          </div>
          {srcDoc ? (
            <iframe
              className="mail-detail-html"
              sandbox=""
              srcDoc={srcDoc}
              title="邮件正文"
            />
          ) : (
            <pre className="mail-detail-text">{body.text || "(正文为空)"}</pre>
          )}
        </>
      )}
    </div>
  );
}

export function MailPage(): React.ReactNode {
  const { navParams, navigate } = useApp();
  const [folder, setFolder] = useState<string>(navParams?.mailFolder ?? "INBOX");
  const [openUid, setOpenUid] = useState<number | null>(navParams?.mailUid ?? null);
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MailHead[] | null>(null);
  const [searching, setSearching] = useState(false);
  const mail = useMail(folder);
  const unreadCounts = useMailCounts();

  // 原子深链：写信 / 邮件实体（先弹层再落位，双触发幂等）
  useEffect(() => {
    if (navParams?.mailCompose) setComposing(true);
    if (navParams?.mailFolder) setFolder(navParams.mailFolder);
    if (navParams?.mailUid !== undefined && navParams.mailUid !== null) setOpenUid(navParams.mailUid);
    if (navParams?.mailCompose || navParams?.mailFolder) setResults(null);
  }, [navParams?.mailCompose, navParams?.mailFolder, navParams?.mailUid]);

  const doSearch = async (): Promise<void> => {
    if (searching) return;
    setSearching(true);
    try {
      setResults(await mailSearch(folder, q));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  if (!mail.configured) {
    return (
      <div className="card mail-guide">
        <IconMail style={{ width: 40, height: 40 }} />
        <h2>邮箱待配置</h2>
        <p>邮箱 tab 与云日历共用同一个清华邮箱 + 授权码。先在「设置 → 云同步」配置，即可在这里收发邮件。</p>
        <button className="btn btn-primary" onClick={() => navigate("settings")}>去设置</button>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>邮箱</h1>
          <div className="page-head-meta">{mail.email} · IMAP/SMTP 直连</div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={() => void mail.refresh()} disabled={mail.loading}>
            <IconRefresh /> {mail.loading ? "同步中…" : "刷新"}
          </button>
          <button className="btn" onClick={() => setComposing(true)}>
            <IconPen /> 写信
          </button>
        </div>
      </div>
      <div className="mail-toolbar">
        <div className="segmented">
          {MAIL_FOLDERS.map((f) => (
            <button
              key={f.id}
              className={folder === f.id ? "is-active" : ""}
              onClick={() => { setFolder(f.id); setOpenUid(null); setResults(null); setQ(""); }}
            >
              {f.label}
              {(unreadCounts[f.id] ?? 0) > 0 && <span className="tab-count" title="未读">{unreadCounts[f.id]}</span>}
            </button>
          ))}
        </div>
        <span className="mail-toolbar-search">
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) void doSearch(); }}
            placeholder="搜索邮件（回车全箱搜）"
          />
          {results !== null ? (
            <button className="btn btn-ghost" title="退出搜索" onClick={() => { setResults(null); setQ(""); }}>×</button>
          ) : (
            <button className="btn btn-ghost" title="全箱搜索" onClick={() => void doSearch()} disabled={!q.trim() || searching}>{searching ? "…" : "搜"}</button>
          )}
        </span>
        {mail.error && <span className="mail-error">{mail.error}</span>}
      </div>
      <div className={`mail-layout${openUid !== null ? " detail-open" : ""}`}>
        <div className="mail-list">
          {results === null && mail.loading && mail.heads.length === 0 && <div className="mail-empty">加载中…</div>}
          {results !== null && results.length === 0 && <div className="mail-empty">没有匹配「{q}」的邮件</div>}
          {results === null && !mail.loading && mail.heads.length === 0 && <div className="mail-empty">没有邮件</div>}
          {(results ?? mail.heads).map((h) => (
            <Row key={h.uid} h={h} folder={folder} active={openUid === h.uid} onClick={() => setOpenUid(h.uid)} />
          ))}
          {results === null ? (
            <div className="mail-more">
              <span className="mail-more-meta">
                {mail.loading ? "加载中…" : `已显示最新 ${mail.heads.length} / 共 ${mail.total} 封`}
              </span>
              {mail.canMore && !mail.loading && (
                <button className="btn btn-ghost" onClick={() => void mail.loadMore()}>加载更早</button>
              )}
            </div>
          ) : (
            <div className="mail-more"><span className="mail-more-meta">搜索结果 {results.length} 封</span></div>
          )}
        </div>
        {openUid !== null ? (
          <Detail folder={folder} uid={openUid} onBack={() => setOpenUid(null)} />
        ) : (
          <div className="mail-detail mail-detail-empty">
            <IconMail style={{ width: 36, height: 36, opacity: 0.4 }} />
            <span>选择一封邮件阅读</span>
          </div>
        )}
      </div>
      {composing && (
        <Compose
          onClose={() => setComposing(false)}
          onSent={(m) => {
            showToast(m);
            void mail.refresh();
          }}
        />
      )}
    </>
  );
}
