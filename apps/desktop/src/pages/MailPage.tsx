import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 邮箱页 —— 复用云日历凭据（IMAP 收 / SMTP 发，Rust 直连）。
 *
 * 布局：宽屏两栏（列表 + 阅读），窄屏（灵动岛面板/手机竖屏）单栏推入。
 * 正文：text/plain 直排；html-only 走 sandbox iframe（禁脚本/禁跳转，外链
 * 只能手动复制——学生邮件场景够用且安全）。写信：弹层表单（to/cc/主题/正文）。
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/context.js";
import { MAIL_FOLDERS, useMail, useMailCounts, useMailBody, sendMail, mailSearch, type MailHead } from "../state/mail.js"
import { ConnectGate } from "../components/ConnectGate.js";;
import { IconMail, IconRefresh, IconPen, IconChevron } from "../components/Icons.js";
import { CollectStar } from "../components/Collect.js";
import { showToast } from "../state/toast.js";
import { useExitHold, useSegPill } from "../lib/motion.js";
import { vaultCatchAttr } from "../components/vault/vaultDrag.js";
import { t as i18n } from "../i18n/index.js";


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
      data-vault-catch={vaultCatchAttr({ type: "atom", title: h.subject, sub: senderName(h.from), atom: { kind: "mail", key: `${folder}#${h.uid}` }, source: "邮箱" })}
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
      {!h.seen && <span className="mail-dot" aria-label={i18n("auto.pages.MailPage.1")} />}
    </div>
  );
}

function Compose({ closing, onClose, onSent }: { closing: boolean; onClose: () => void; onSent: (msg: string) => void }): React.ReactNode {
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
    <div className={"mail-compose-mask" + (closing ? " is-closing" : "")} onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className={"mail-compose" + (closing ? " is-closing" : "")}>
        <div className="mail-compose-head">
          <h2>{i18n("auto.pages.MailPage.2")}</h2>
          <Btn variant="ghost" onClick={onClose} disabled={sending}>{i18n("auto.pages.MailPage.3")}</Btn>
        </div>
        <div className="mail-compose-fields">
          <label>
            {i18n("auto.pages.MailPage.4")}<input value={to} onChange={(e) => setTo(e.target.value)} placeholder={i18n("auto.pages.MailPage.5")} autoFocus />
          </label>
          <label>
            {i18n("auto.pages.MailPage.6")}<input value={cc} onChange={(e) => setCc(e.target.value)} placeholder={i18n("auto.pages.MailPage.7")} />
          </label>
          <label>
            {i18n("auto.pages.MailPage.8")}<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={i18n("auto.pages.MailPage.9")} />
          </label>
          <label>
            {i18n("auto.pages.MailPage.10")}<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder={i18n("auto.pages.MailPage.11")} />
          </label>
        </div>
        {err && <div className="mail-compose-err">{err}</div>}
        <div className="mail-compose-foot">
          <Btn variant="solid" tone="brand" onClick={() => void send()} disabled={sending || to.trim().length === 0}>{sending ? "发送中…" : "发送"}</Btn>
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
/* 滚动条：iframe 是独立文档，父页面的 ::-webkit-scrollbar 进不来（用户报「预览滑动条还是旧版」）。
   这里按 base.css §滚动条 的语言重写一份：10px 命中区 + 3px 透明边 → 视觉 4px 细拇指、透明轨道、
   去两端箭头。颜色沿用本文件既有的硬编码方案（iframe 取不到父页面 CSS 变量）。 */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(47, 109, 246, 0.22);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover { background: rgba(47, 109, 246, 0.34); }
::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
@media (prefers-color-scheme: dark) {
  body { color: #e8e8ea; background: transparent; }
  a { color: #7ba2ff; }
  ::-webkit-scrollbar-thumb { background: rgba(123, 162, 255, 0.24); }
  ::-webkit-scrollbar-thumb:hover { background: rgba(123, 162, 255, 0.36); }
}
</style></head><body>${body.html}</body></html>`;
  }, [body?.html]);
  return (
    <div className="mail-detail">
      <div className="mail-detail-head">
        <Btn variant="ghost" onClick={onBack}><IconChevron style={{ transform: "rotate(180deg)" }} />{i18n("auto.pages.MailPage.12")}</Btn>
        {head && (
          <span className="mail-detail-headside">
            <span className="mail-detail-date">{fmtMailDate(head.dateMs)}</span>
            <CollectStar atom={{ kind: "mail", key: `${folder}#${uid}` }} title={head.subject} />
          </span>
        )}
      </div>
      {loading && <div className="mail-empty">{i18n("auto.pages.MailPage.13")}</div>}
      {error && <div className="mail-empty">{i18n("auto.pages.MailPage.14")}{error}</div>}
      {body && !loading && (
        <>
          <h2 className="mail-detail-subject">{body.subject}</h2>
          <div className="mail-detail-meta">
            <span className="mail-avatar" style={{ background: `hsl(${avatarHue(senderName(body.from))} 55% 45%)` }}>
              {[...senderName(body.from)][0]?.toUpperCase() ?? "?"}
            </span>
            <span className="mail-detail-meta-main">
              <span className="mail-detail-from">{body.from || "(无发件人)"}</span>
              {body.to && <span className="mail-detail-to">{i18n("auto.pages.MailPage.15")}{body.to}</span>}
            </span>
          </div>
          {srcDoc ? (
            <iframe
              className="mail-detail-html"
              sandbox=""
              srcDoc={srcDoc}
              title={i18n("auto.pages.MailPage.16")}
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
  const [bindOpen, setBindOpen] = useState(false); // §4.3：未配置时在原地绑，不必先去设置
  const unreadCounts = useMailCounts();
  const [segRef, pillRef] = useSegPill();
  /* 写信弹层：关闭时多挂 220ms 播完退场，而不是瞬间消失 */
  const composeHold = useExitHold(composing ? "compose" : null, 220);

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
        <h2>{i18n("auto.pages.MailPage.17")}</h2>
        <p>{i18n("auto.pages.MailPage.18")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="solid" tone="brand" onClick={() => setBindOpen(true)}>{i18n("auto.pages.MailPage.19")}</Btn>
          <Btn variant="outline" onClick={() => navigate("settings")}>{i18n("auto.pages.MailPage.20")}</Btn>
        </div>
        <ConnectGate need="mail" open={bindOpen} onClose={() => setBindOpen(false)} />
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{i18n("auto.pages.MailPage.21")}</h1>
          <div className="page-head-meta">{mail.email} {i18n("auto.pages.MailPage.22")}</div>
        </div>
        <div className="page-head-actions">
          <Btn variant="ghost" onClick={() => void mail.refresh()} disabled={mail.loading}><IconRefresh />{mail.loading ? "同步中…" : "刷新"}</Btn>
          <Btn variant="outline" onClick={() => setComposing(true)}><IconPen />{i18n("auto.pages.MailPage.2")}</Btn>
        </div>
      </div>
      <div className="mail-toolbar">
        <div className="segmented" ref={segRef}>
          <span className="seg-pill" ref={pillRef} aria-hidden="true" />
          {MAIL_FOLDERS.map((f) => (
            <button
              key={f.id}
              className={folder === f.id ? "is-active" : ""}
              onClick={() => { setFolder(f.id); setOpenUid(null); setResults(null); setQ(""); }}
            >
              {f.label}
              {(unreadCounts[f.id] ?? 0) > 0 && <span className="tab-count" title={i18n("auto.pages.MailPage.1")}>{unreadCounts[f.id]}</span>}
            </button>
          ))}
        </div>
        <span className="mail-toolbar-search">
          <Input value={q} onChange={(value) => setQ(value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) void doSearch(); }} placeholder={i18n("auto.pages.MailPage.23")} />
          {results !== null ? (
            <Btn variant="ghost" titleAttr={i18n("auto.pages.MailPage.24")} onClick={() => { setResults(null); setQ(""); }}>×</Btn>
          ) : (
            <Btn variant="ghost" titleAttr={i18n("auto.pages.MailPage.25")} onClick={() => void doSearch()} disabled={!q.trim() || searching}>{searching ? "…" : "搜"}</Btn>
          )}
        </span>
        {mail.error && <span className="mail-error">{mail.error}</span>}
      </div>
      <div className={`mail-layout${openUid !== null ? " detail-open" : ""}`}>
        <div className="mail-list">
          {results === null && mail.loading && mail.heads.length === 0 && <div className="mail-empty">{i18n("auto.pages.MailPage.26")}</div>}
          {results !== null && results.length === 0 && <div className="mail-empty">{i18n("auto.pages.MailPage.27")}{q}{i18n("auto.pages.MailPage.28")}</div>}
          {results === null && !mail.loading && mail.heads.length === 0 && <div className="mail-empty">{i18n("auto.pages.MailPage.29")}</div>}
          {(results ?? mail.heads).map((h) => (
            <Row key={h.uid} h={h} folder={folder} active={openUid === h.uid} onClick={() => setOpenUid(h.uid)} />
          ))}
          {results === null ? (
            <div className="mail-more">
              <span className="mail-more-meta">
                {mail.loading ? "加载中…" : `已显示最新 ${mail.heads.length} / 共 ${mail.total} 封`}
              </span>
              {mail.canMore && !mail.loading && (
                <Btn variant="ghost" onClick={() => void mail.loadMore()}>{i18n("auto.pages.MailPage.30")}</Btn>
              )}
            </div>
          ) : (
            <div className="mail-more"><span className="mail-more-meta">{i18n("auto.pages.MailPage.31")}{results.length} {i18n("auto.pages.MailPage.32")}</span></div>
          )}
        </div>
        {openUid !== null ? (
          <Detail folder={folder} uid={openUid} onBack={() => setOpenUid(null)} />
        ) : (
          <div className="mail-detail mail-detail-empty">
            <IconMail style={{ width: 36, height: 36, opacity: 0.4 }} />
            <span>{i18n("auto.pages.MailPage.33")}</span>
          </div>
        )}
      </div>
      {composeHold.mounted && composeHold.held ? (
        <Compose
          closing={composeHold.closing}
          onClose={() => setComposing(false)}
          onSent={(m) => {
            showToast(m);
            void mail.refresh();
          }}
        />
      ) : null}
    </>
  );
}
