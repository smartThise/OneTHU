import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn, Field, Input, Modal, Stack, TextArea } from "@onethu/gui";
/**
 * 邮箱页 —— 复用云日历凭据（IMAP 收 / SMTP 发，Rust 直连）。
 *
 * 布局：宽屏两栏（列表 + 阅读），窄屏（灵动岛面板/手机竖屏）单栏推入。
 * 正文：text/plain 直排；html-only 走 sandbox iframe（禁脚本/禁跳转，外链
 * 只能手动复制——学生邮件场景够用且安全）。写信：弹层表单（to/cc/主题/正文）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/context.js";
import { MAIL_FOLDERS, useMail, useMailCounts, useMailBody, sendMail, mailSearch, type MailHead } from "../state/mail.js";
import { ConnectGate } from "../components/ConnectGate.js";
import { SegmentedOverflow } from "../components/Layout.js";
import { IconMail, IconRefresh, IconPen, IconChevron } from "../components/Icons.js";
import { CollectStar } from "../components/Collect.js";
import { showToast } from "../state/toast.js";
import { vaultCatchAttr } from "../components/vault/vaultDrag.js";

/** 邮件时间：今天 14:05 / 昨天 / 9月5日 / 2025年12月3日 */
function fmtMailDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yd)) return i18n("pages.mailpage.0c184871f658");
  if (d.getFullYear() === now.getFullYear()) return i18n("pages.mailpage.1c6fcf296dce", { value: String(d.getMonth() + 1), value2: String(d.getDate()) });
  return i18n("pages.mailpage.b92d3082a65a", { value: String(d.getFullYear()), value2: String(d.getMonth() + 1), value3: String(d.getDate()) });
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
  return from.split("@")[0] || from || i18n("pages.mailpage.51c306bd3174");
}

function Row({ h, folder, active, onClick }: { h: MailHead; folder: string; active: boolean; onClick: () => void }): React.ReactNode {
  const uiLocale = useUiLocale();

  const name = senderName(h.from);
  return (
    <div
      className={`mail-row${active ? " active" : ""}${h.seen ? "" : " unread"}`}
      data-vault-catch={vaultCatchAttr({ type: "atom", title: h.subject, sub: senderName(h.from), atom: { kind: "mail", key: `${folder}#${h.uid}` }, source: "邮箱" })}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      }}
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
      {!h.seen && <span className="mail-dot" aria-label={i18n("pages.mailpage.4d0680f9efae")} />}
    </div>
  );
}

function Compose({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (msg: string) => void }): React.ReactNode {
  const uiLocale = useUiLocale();

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (open) { setTo(""); setCc(""); setSubject(""); setBody(""); setErr(null); }
  }, [open]);
  const send = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setErr(null);
    try {
      await sendMail(to, cc, subject, body);
      if (!active.current) return;
      onSent(i18n("pages.mailpage.60823aaec73b"));
      onClose();
    } catch (e) {
      if (active.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      if (active.current) setSending(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => { if (!inFlight.current) onClose(); }}
      title={i18n("pages.mailpage.ed80f9723a5a")}
      className="mail-compose-dialog"
      closeButton={!sending}
      maskClose={!sending}
      foot={<>
        <Btn variant="ghost" onClick={onClose} disabled={sending}>{i18n("pages.mailpage.2cd0f3be8738")}</Btn>
        <Btn variant="solid" tone="brand" onClick={() => void send()} disabled={sending || to.trim().length === 0}>{sending ? i18n("pages.mailpage.364970d8168c") : i18n("pages.mailpage.edecf0ae6e51")}</Btn>
      </>}
    >
      <Stack gap={3}>
        <Field label={i18n("pages.mailpage.c237b665a6d8")}>
          <Input value={to} onChange={setTo} disabled={sending} placeholder={i18n("pages.mailpage.56a81f01d218")} />
        </Field>
        <Field label={i18n("pages.mailpage.2934c3ab3025")}>
          <Input value={cc} onChange={setCc} disabled={sending} placeholder={i18n("pages.mailpage.537352400c49")} />
        </Field>
        <Field label={i18n("pages.mailpage.788db1cfec2a")}>
          <Input value={subject} onChange={setSubject} disabled={sending} placeholder={i18n("pages.mailpage.d626dbe6715e")} />
        </Field>
        <Field label={i18n("pages.mailpage.d661c3d96d53")}>
          <TextArea value={body} onChange={setBody} disabled={sending} rows={8} placeholder={i18n("pages.mailpage.6b437e170641")} />
        </Field>
        {err && <div role="alert" className="mail-error">{err}</div>}
      </Stack>
    </Modal>
  );
}

function Detail({ folder, uid, onBack }: { folder: string; uid: number; onBack: () => void }): React.ReactNode {
  const uiLocale = useUiLocale();

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
  }, [uiLocale, body?.html]);
  return (
    <div className="mail-detail">
      <div className="mail-detail-head">
        <Btn variant="ghost" onClick={onBack}><IconChevron style={{ transform: "rotate(180deg)" }} />{i18n("pages.mailpage.572cf45ba436")}</Btn>
        {head && (
          <span className="mail-detail-headside">
            <span className="mail-detail-date">{fmtMailDate(head.dateMs)}</span>
            <CollectStar atom={{ kind: "mail", key: `${folder}#${uid}` }} title={head.subject} />
          </span>
        )}
      </div>
      {loading && <div className="mail-empty">{i18n("pages.mailpage.346ff60e6c7c")}</div>}
      {error && <div className="mail-empty">{i18nRich("pages.mailpage.c38db86e9aab", { error: error })}</div>}
      {body && !loading && (
        <>
          <h2 className="mail-detail-subject">{body.subject}</h2>
          <div className="mail-detail-meta">
            <span className="mail-avatar" style={{ background: `hsl(${avatarHue(senderName(body.from))} 55% 45%)` }}>
              {[...senderName(body.from)][0]?.toUpperCase() ?? "?"}
            </span>
            <span className="mail-detail-meta-main">
              <span className="mail-detail-from">{body.from || i18n("pages.mailpage.51c306bd3174")}</span>
              {body.to && <span className="mail-detail-to">{i18nRich("pages.mailpage.54c015dde43f", { to: body.to })}</span>}
            </span>
          </div>
          {srcDoc ? (
            <iframe
              className="mail-detail-html"
              sandbox=""
              srcDoc={srcDoc}
              title={i18n("pages.mailpage.9aa24002fe73")}
            />
          ) : (
            <pre className="mail-detail-text">{body.text || i18n("pages.mailpage.57209d3256b5")}</pre>
          )}
        </>
      )}
    </div>
  );
}

export function MailPage(): React.ReactNode {
  const uiLocale = useUiLocale();

  const { navParams, navigate } = useApp();
  const [folder, setFolder] = useState<string>(navParams?.mailFolder ?? "INBOX");
  const [openUid, setOpenUid] = useState<number | null>(navParams?.mailUid ?? null);
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState("");
  const [searchResult, setSearchResult] = useState<{ account: number; folder: string; query: string; heads: MailHead[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const mail = useMail(folder);
  const searchGeneration = useRef(0);
  const previousAccount = useRef<{ email: string; revision: number } | null>(null);
  const results = searchResult?.account === mail.accountRevision && searchResult.folder === folder ? searchResult.heads : null;
  const clearSearch = (): void => {
    searchGeneration.current++;
    setSearchResult(null);
    setSearching(false);
    setQ("");
  };
  const [bindOpen, setBindOpen] = useState(false); // §4.3：未配置时在原地绑，不必先去设置
  const unreadCounts = useMailCounts();

  // 原子深链：写信 / 邮件实体（先弹层再落位，双触发幂等）
  useEffect(() => {
    if (navParams?.mailCompose) setComposing(true);
    if (navParams?.mailFolder) setFolder(navParams.mailFolder);
    if (navParams?.mailUid !== undefined && navParams.mailUid !== null) setOpenUid(navParams.mailUid);
    if (navParams?.mailCompose || navParams?.mailFolder) clearSearch();
  }, [navParams?.mailCompose, navParams?.mailFolder, navParams?.mailUid]);

  useEffect(() => {
    searchGeneration.current++;
    setSearchResult(null);
    setSearching(false);
    setQ("");
    return () => { searchGeneration.current++; };
  }, [folder, mail.accountRevision]);
  useEffect(() => {
    const previous = previousAccount.current;
    if (previous && (previous.email !== mail.email || previous.revision !== mail.accountRevision)) {
      setOpenUid(null);
      setComposing(false);
    }
    if (mail.email && mail.accountRevision > 0) previousAccount.current = { email: mail.email, revision: mail.accountRevision };
  }, [mail.email, mail.accountRevision]);

  const doSearch = async (): Promise<void> => {
    const query = q.trim();
    if (!query || searching) return;
    const generation = ++searchGeneration.current;
    setSearching(true);
    try {
      const heads = await mailSearch(folder, query);
      if (generation === searchGeneration.current) setSearchResult({ account: mail.accountRevision, folder, query, heads });
    } catch (e) {
      if (generation === searchGeneration.current) showToast(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };

  if (!mail.configured) {
    return (
      <div className="card mail-guide">
        <IconMail style={{ width: 40, height: 40 }} />
        <h2>{i18n("pages.mailpage.307333307c28")}</h2>
        <p>{i18n("pages.mailpage.2dee7a19b009")}</p>
        {mail.error ? <p role="alert">{mail.error}</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="solid" tone="brand" onClick={() => setBindOpen(true)}>{i18n("pages.mailpage.6d4b7dce1ee6")}</Btn>
          {mail.error ? <Btn variant="ghost" onClick={() => void mail.refresh()}>{i18n("pages.mailpage.df7392cc96be")}</Btn> : null}
          <Btn variant="outline" onClick={() => navigate("settings")}>{i18n("pages.mailpage.93112c231d6a")}</Btn>
        </div>
        <ConnectGate need="mail" open={bindOpen} onClose={() => setBindOpen(false)} />
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{i18n("pages.mailpage.73075237fd0f")}</h1>
          <div className="page-head-meta">{i18nRich("pages.mailpage.208e09900504", { email: mail.email })}</div>
        </div>
        <div className="page-head-actions">
          <Btn variant="ghost" onClick={() => void mail.refresh()} disabled={mail.loading}><IconRefresh />{mail.loading ? i18n("pages.mailpage.4e2238b74ec7") : i18n("pages.mailpage.aee887434131")}</Btn>
          <Btn variant="outline" onClick={() => setComposing(true)}><IconPen />{i18n("pages.mailpage.ed80f9723a5a")}</Btn>
        </div>
      </div>
      <div className="mail-toolbar">
        <SegmentedOverflow ariaLabel={i18n("pages.mailpage.73075237fd0f")}>
          {MAIL_FOLDERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={folder === f.id}
              className={folder === f.id ? "is-active" : ""}
              onClick={() => { setFolder(f.id); setOpenUid(null); clearSearch(); }}
            >
              {f.label}
              {(unreadCounts[f.id] ?? 0) > 0 && <span className="tab-count" title={i18n("pages.mailpage.4d0680f9efae")}>{unreadCounts[f.id]}</span>}
            </button>
          ))}
        </SegmentedOverflow>
        <span className="mail-toolbar-search">
          <Input value={q} onChange={(value) => setQ(value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) void doSearch(); }} placeholder={i18n("pages.mailpage.3d4a72366c0e")} />
          {results !== null || searching ? (
            <Btn variant="ghost" titleAttr={searching ? i18n("pages.mailpage.8aaa866240c3") : i18n("pages.mailpage.5ee87e65261b")} onClick={clearSearch}>×</Btn>
          ) : (
            <Btn variant="ghost" titleAttr={i18n("pages.mailpage.4ee153002e7b")} onClick={() => void doSearch()} disabled={!q.trim() || searching}>{searching ? "…" : i18n("pages.mailpage.c96e7731f214")}</Btn>
          )}
        </span>
        {mail.error && <span className="mail-error">{mail.error}</span>}
      </div>
      <div className={`mail-layout${openUid !== null ? " detail-open" : ""}`}>
        <div className="mail-list">
          {results === null && mail.loading && mail.heads.length === 0 && <div className="mail-empty">{i18n("pages.mailpage.4927a53bcc88")}</div>}
          {searching && <div className="mail-empty">{i18n("pages.mailpage.cc50237edca2")}</div>}
          {results !== null && results.length === 0 && <div className="mail-empty">{i18nRich("pages.mailpage.88a5ec063718", { query: searchResult?.query })}</div>}
          {results === null && !mail.loading && !mail.error && mail.heads.length === 0 && <div className="mail-empty">{i18n("pages.mailpage.7c930c7b544e")}</div>}
          {(results ?? mail.heads).map((h) => (
            <Row key={h.uid} h={h} folder={folder} active={openUid === h.uid} onClick={() => setOpenUid(h.uid)} />
          ))}
          {results === null ? (
            <div className="mail-more">
              <span className="mail-more-meta">
                {mail.loading ? i18n("pages.mailpage.4927a53bcc88") : i18n("pages.mailpage.ad9a65f0c351", { length: String(mail.heads.length), total: String(mail.total) })}
              </span>
              {mail.canMore && !mail.loading && (
                <Btn variant="ghost" onClick={() => void mail.loadMore()}>{i18n("pages.mailpage.c3266e411ea3")}</Btn>
              )}
            </div>
          ) : (
            <div className="mail-more"><span className="mail-more-meta">{i18nRich("pages.mailpage.e26a7fcdf47b", { length: results.length })}</span></div>
          )}
        </div>
        {openUid !== null ? (
          <Detail folder={folder} uid={openUid} onBack={() => setOpenUid(null)} />
        ) : (
          <div className="mail-detail mail-detail-empty">
            <IconMail style={{ width: 36, height: 36, opacity: 0.4 }} />
            <span>{i18n("pages.mailpage.13c8b1be20e8")}</span>
          </div>
        )}
      </div>
      <Compose
          key={mail.accountRevision}
          open={composing}
          onClose={() => setComposing(false)}
          onSent={(m) => {
            showToast(m);
            void mail.refresh();
          }}
      />
    </>
  );
}
