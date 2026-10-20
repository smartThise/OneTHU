import { useOrgs, orgIdentityCard } from "../state/org.js";
import { openTab } from "../state/explorer.js";
/**
 * 通讯录与名片：我的名片、名片夹（好友 / 组织）、组织名片。
 *
 * 数据仍在 state/nameCard.ts，共享云盘 / 留言 / 传文件走 lib/cloudFolder 与 state/friendChannel；
 * 本文件只做展示层重组：拟物纸卡（IdentityCard）+ 卡片夹网格 + Modal 大卡。
 * - 我的名片：settings 浮层「我的 → 我的名片」与通讯录页共用同一套编辑入口；
 * - 名片夹：搜索 / 全部·好友·组织 筛选 / 星标 / 卡片堆叠 / 点击弹出大卡；
 * - 组织名片：建卡、进暂存箱、复制加入方式；组织成员与邀请口令在 OrganizationSection。
 */
import { personalNfcCode, personalShareCode } from "../lib/contentExchange.js";
import { useNfcExchange } from "../lib/useNfcExchange.js";
import { useVaultReceive } from "../lib/useVaultReceive.js";
import { IdentityCard } from "./IdentityCard.js";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Btn, Card, Chip, EmptyState, IconBtn, IconCamera, IconCloud, IconFile, IconIn, IconMail, IconPen,
  IconPlus, IconStar, IconTrash, Inline, KeyValue, List, Modal, Row, SearchField, Section, Segment,
  Stack, Text,
} from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { getCampusSnapshot, subscribeCampusData } from "../state/data.js";
import {
  ensureSeafileLoaded, refreshSeafileAccount, useSeafile,
} from "../state/seafile.js";
import { goEntry } from "./Layout.js";
import { openFormModal } from "../lib/formModal.js";
import { confirmOk } from "../lib/confirm.js";
import { showToast } from "../state/toast.js";
import { pickFile, fileToBytes } from "../lib/attach.js";
import { bytesToBase64 } from "../lib/imageSave.js";
import { addToVault, vaultSnapshot, type VaultCatch } from "../state/vault.js";
import {
  CARD_LIMITS, addContact, orgCardCatch, personalCardCatch, removeContact,
  resolveCloudEmail, savePersonalCard, setContactShare, upsertOrgCard, useCards,
  type CardCover, type ContactCard, type OrgCard, type PersonalCard,
} from "../state/nameCard.js";
import { prepareAndShareFolder } from "../lib/cloudFolder.js";
import { deleteCardCover, uploadCardCover } from "../lib/cardCover.js";
import { CardCoverEditor } from "./CardCoverEditor.js";
import {
  openBidirectionalShare, sendFriendFile, sendFriendText, useFriendMessages,
} from "../state/friendChannel.js";
import { stageFromPicker } from "../lib/fileChannel.js";
import { t as i18n } from "../i18n/index.js";


defineSearchRows([
  {
    id: "set-namecard", tab: "账号", section: "我的名片", title: "我的名片",
    aliases: ["名片", "头像", "个人简介", "社交媒体", "个人网址"], desc: "头像、网址、社交、手机号、简介",
    breadcrumb: ["设置", "账号", "我的名片", "我的名片"],
    go: () => goEntry("profile"),
  },
]);

type ContactFilter = "all" | ContactCard["kind"];

/** 星标好友（纯界面偏好）：与人名片数据解耦，不进同步。 */
const STAR_KEY = "onethu.contacts.starred.v1";

function readStars(): string[] {
  try {
    const raw = localStorage.getItem(STAR_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeStars(ids: string[]): void {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify(ids));
  } catch {
    /* 配额满：星标只留内存态 */
  }
}

function contactBrief(c: ContactCard): string {
  return c.kind === "organization"
    ? (c.card as OrgCard).brief || "组织邀请"
    : (c.card as PersonalCard).bio || "还没有写简介";
}

function contactLink(c: ContactCard): string {
  return c.kind === "organization"
    ? (c.card as OrgCard).joinUrl
    : [(c.card as PersonalCard).website, (c.card as PersonalCard).social, (c.card as PersonalCard).phone]
      .filter(Boolean)
      .join(" · ");
}

function contactCatch(c: ContactCard): VaultCatch {
  return {
    type: "payload",
    title: c.name,
    payload: { kind: "namecard", card: c.card, org: c.kind === "organization" },
    source: "通讯录",
  };
}

/**
 * 云盘账号探测只做一次（整个会话）：ensureSeafileLoaded 已缓存配置，refresh 取一次 email 即可。
 * 浏览器 dev 下没有 Tauri 命令，失败按"未配置"降级，不阻塞名片。
 */
let seafileEmailProbe: Promise<void> | null = null;
function probeSeafileEmail(): Promise<void> {
  seafileEmailProbe ??= ensureSeafileLoaded()
    .then(() => refreshSeafileAccount())
    .catch(() => undefined);
  return seafileEmailProbe;
}

/**
 * 本人清华云盘邮箱：应用本来就能识别（名片已存 → 云盘账号 → 校园数据 → 已配置的 CalDAV），
 * 不再让用户手填。resolveCloudEmail 只读快照；两个订阅只负责在数据到达后触发重渲染。
 */
function useCloudEmail(): string {
  const seafile = useSeafile();
  const [campusEmail, setCampusEmail] = useState(() => (getCampusSnapshot()?.user?.email ?? "").trim());
  useEffect(() => {
    const sync = (): void => setCampusEmail((getCampusSnapshot()?.user?.email ?? "").trim());
    sync();
    return subscribeCampusData(sync);
  }, []);
  useEffect(() => {
    void probeSeafileEmail();
  }, []);
  return resolveCloudEmail() || seafile.account?.email?.trim() || campusEmail;
}

/** 云盘邮箱只自动补一次（整个会话）：用户自己清空后不再覆盖。 */
let autoCloudEmailFilled = false;

/** 我的名片：编辑资料 / 换头像 / 放进暂存箱（浮层与通讯录共用）。 */
function usePersonalActions() {
  const doc = useCards();
  const p = doc.personal;
  const [busy, setBusy] = useState(false);
  const cloudEmail = useCloudEmail();
  useEffect(() => {
    if (autoCloudEmailFilled || !cloudEmail) return;
    autoCloudEmailFilled = true;
    if (!p.cloudEmail) savePersonalCard({ cloudEmail });
  }, [cloudEmail, p.cloudEmail]);

  const edit = useCallback(async (): Promise<void> => {
    const f = await openFormModal("编辑我的名片", [
      { key: "name", label: i18n("auto.components.NameCardSection.p1"), required: true, default: p.name },
      { key: "website", label: i18n("auto.components.NameCardSection.p2"), default: p.website },
      { key: "social", label: i18n("auto.components.NameCardSection.p3"), default: p.social },
      { key: "phone", label: i18n("auto.components.NameCardSection.p4"), default: p.phone },
      {
        key: "cloudEmail",
        label: i18n("auto.components.NameCardSection.p5"),
        placeholder: i18n("auto.components.NameCardSection.p6"),
        default: p.cloudEmail || cloudEmail || "",
      },
      { key: "bio", label: i18n("auto.components.NameCardSection.p7"), kind: "textarea", default: p.bio },
    ]);
    if (f) savePersonalCard(f);
  }, [p, cloudEmail]);

  const pickAvatar = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const f = await pickFile();
      if (!f) return;
      if (!f.mime.startsWith("image/")) throw new Error("只支持图片");
      if (f.size > 200 * 1024) throw new Error("头像请控制在 200KB 以内");
      const bytes = await fileToBytes(f, 200 * 1024);
      savePersonalCard({ avatar: `data:${f.mime};base64,${bytesToBase64(bytes)}` });
      showToast(i18n("auto.components.NameCardSection.msg1"));
    } catch (e) {
      showToast(`头像设置失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const toVault = useCallback((): void => {
    const r = addToVault(personalCardCatch());
    if (r.ok) showToast(i18n("auto.components.NameCardSection.msg2"));
    else showToast(r.reason === "duplicate" ? "暂存箱里已经有这张名片了" : "暂存箱暂时不可用，稍后再试");
  }, []);

  return { personal: p, edit, pickAvatar, toVault, busy, cloudEmail };
}

/* ══════════════ 我的名片 ══════════════ */

function cloudEmailText(email: string): string {
  return email || "未识别 · 好友互传时需要";
}

function PersonalCardBlock(): ReactNode {
  const { personal, edit, pickAvatar, toVault, busy, cloudEmail } = usePersonalActions();
  const nfc = useNfcExchange();
  /* 通讯录也应当能直接收名片：粘贴对方的名片口令（或扫码）就进名片夹，不必绕去暂存箱。 */
  const receive = useVaultReceive();
  const [copying, setCopying] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const copyCard = async (): Promise<void> => {
    if (copying) return;
    setCopying(true);
    try { await navigator.clipboard.writeText(await personalShareCode(personal)); showToast(i18n("auto.components.NameCardSection.msg3")); }
    catch (e) { showToast(e instanceof Error ? e.message : "复制失败，请重试"); }
    finally { setCopying(false); }
  };
  const saveCover = (cover: CardCover): void => {
    savePersonalCard({ cover });
    showToast(i18n("auto.components.NameCardSection.msg4"));
    /* 云盘备份异步进行：失败只说备份失败，本地卡面不受影响。 */
    void (async () => {
      try {
        const cloud = await uploadCardCover(cover.src);
        savePersonalCard({ cover: { ...cover, cloud } });
        showToast(i18n("auto.components.NameCardSection.msg5"));
      } catch {
        showToast(i18n("auto.components.NameCardSection.msg6"));
      }
    })();
  };
  const removeCover = (): void => {
    const old = personal.cover?.cloud;
    savePersonalCard({ cover: null });
    if (old) void deleteCardCover(old);
    showToast(i18n("auto.components.NameCardSection.msg7"));
  };

  return (
    <div className="identity-panel">
      <div className="identity-panel-show">
        <IdentityCard card={personal} variant="hero" />
        {/* 两排等宽按钮：编辑一排、分享一排；手机端各自两列，桌面端各四列，排版一致不参差 */}
        <div className="identity-panel-actions identity-panel-actions--edit">
          <Btn variant="solid" tone="brand" icon={<IconPen size="sm" />} onClick={() => void edit()}>
            {i18n("auto.components.NameCardSection.1")}</Btn>
          <Btn variant="outline" icon={<IconCamera size="sm" />} disabled={busy} onClick={() => void pickAvatar()}>
            {i18n("auto.components.NameCardSection.2")}</Btn>
          <Btn variant="outline" onClick={() => setCoverOpen(true)}>{personal.cover ? "换卡面" : "自定义卡面"}</Btn>
          <Btn variant="ghost" onClick={toVault}>
            {i18n("auto.components.NameCardSection.3")}</Btn>
        </div>
        <div className="identity-panel-exchange">
          <div className="identity-panel-actions identity-panel-actions--share">
            <Btn variant="outline" disabled={copying || nfc.busy} onClick={() => void copyCard()}>{copying ? "正在生成…" : "复制名片口令"}</Btn>
            <Btn variant="outline" disabled={receive.busy || nfc.busy} onClick={() => void receive.paste()}>{i18n("auto.components.NameCardSection.4")}</Btn>
            <Btn variant="solid" disabled={!nfc.available || nfc.busy || copying} onClick={() => void nfc.send(() => personalNfcCode(personal))}>{i18n("auto.components.NameCardSection.5")}</Btn>
            <Btn variant="ghost" disabled={receive.busy || nfc.busy} onClick={() => void receive.scan()}>{i18n("auto.components.NameCardSection.6")}</Btn>
          </div>
          <Text slot="micro" tone="faint">{nfc.hint}</Text>
        </div>
      </div>
      {nfc.feedback}
      <CardCoverEditor
        open={coverOpen}
        card={personal}
        onClose={() => setCoverOpen(false)}
        onSave={saveCover}
        onRemove={removeCover}
      />
      <Card className="identity-panel-meta">
        <Section title={i18n("auto.components.NameCardSection.7")} hint={i18n("auto.components.NameCardSection.8")} />
        <KeyValue
          rows={[
            { k: "名字", v: personal.name || "未填写" },
            { k: "个人网址", v: personal.website || "未填写" },
            { k: "社交媒体", v: personal.social || "未填写" },
            { k: "手机号", v: personal.phone || "未填写" },
            { k: "清华云盘邮箱", v: cloudEmailText(cloudEmail) },
          ]}
        />
        <Text slot="micro" tone="faint">
          {i18n("auto.components.NameCardSection.9")}</Text>
      </Card>
    </div>
  );
}

/* ══════════════ 组织名片 ══════════════ */

/** 自己创建的组织 + 历史独立组织名片（并集，新组织优先）。 */
export function myOrgCards(legacy: OrgCard[], organizations: ReturnType<typeof useOrgs>): OrgCard[] {
  return [...organizations.orgs.map(orgIdentityCard), ...legacy.filter((c) => !organizations.orgs.some((o) => o.id === c.id))];
}

export function OrgCardsSection(): ReactNode {
  const legacy = useCards();
  const organizations = useOrgs();
  const orgs = myOrgCards(legacy.orgs, organizations);
  return (
    <div className="org-cards">
      <Section
        className="org-cards-head"
        title={i18n("auto.components.NameCardSection.10")}
        hint={i18n("auto.components.NameCardSection.11")}
        aside={<Btn size="sm" variant="outline" onClick={() => openTab("contacts", { section: "orgs" } as never)}>{i18n("auto.components.NameCardSection.12")}</Btn>}
      />
      {orgs.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title={i18n("auto.components.NameCardSection.13")}
          hint={i18n("auto.components.NameCardSection.14")}
        />
      ) : (
        <div className="contact-deck">
          {orgs.map((o) => (
            <div className="contact-slot" key={o.id}>
              <Btn
                className="contact-card-pick"
                aria-label={`打开${o.name}的组织主页`}
                data-vault-catch={JSON.stringify(orgCardCatch(o))}
                onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
              >
                <IdentityCard card={o} organization />
              </Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════ 名片夹 ══════════════ */

export function ContactCabinet(): ReactNode {
  const doc = useCards();
  const organizations = useOrgs();
  /** 名片夹同一个牌堆里还有自己的组织名片（2026-10-19 用户点名「应该和其他名片夹在一起」）。 */
  const myOrgs = myOrgCards(doc.orgs, organizations);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [starred, setStarred] = useState<ReadonlySet<string>>(() => new Set(readStars()));
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selfOpen, setSelfOpen] = useState(false);
  /** 「接收名片」小面板：粘贴口令 / 扫码 / 从暂存箱收 —— 三个收名片入口收成一个按钮，工具条不拥挤。 */
  const [recvOpen, setRecvOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const focused = doc.contacts.find((c) => c.id === focusedId) ?? null;
  const shownRef = useRef<ContactCard | null>(null);
  useEffect(() => {
    if (focused) shownRef.current = focused;
  }, [focused]);
  const shown = focused ?? shownRef.current;
  const channelMessages = useFriendMessages(channelId ?? "");

  const toggleStar = useCallback((id: string): void => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStars([...next]);
      return next;
    });
  }, []);

  const importContacts = useCallback((): void => {
    let ok = 0;
    let dup = 0;
    for (const box of vaultSnapshot().boxes) {
      for (const it of box.items) {
        const payload = it.payload as { kind?: string; card?: Record<string, unknown>; org?: boolean } | undefined;
        if (payload?.kind !== "namecard" || !payload.card) continue;
        const r = addContact(payload.org ? "organization" : "personal", payload.card as never, it.sub ?? "");
        if (r.ok) ok++;
        else if (r.reason === "duplicate") dup++;
      }
    }
    if (ok) showToast(`已加入通讯录：${ok} 张`);
    else showToast(dup ? "这些名片已经在通讯录里了" : "暂存箱里还没有名片：先把名片放进暂存箱");
  }, []);

  const shareCloud = useCallback(async (contactId: string, name: string): Promise<void> => {
    setSharingId(contactId);
    try {
      const share = await prepareAndShareFolder(`/Friends/${contactId}`, `${name} 与我的共享云盘`);
      setContactShare(contactId, {
        repoId: share.repoId, path: share.path, shareUrl: share.shareUrl, shareToken: share.shareToken,
        expiresAt: share.expiresAt, createdAt: Date.now(),
      });
      await navigator.clipboard.writeText(share.shareUrl).catch(() => undefined);
      const twoWay = await openBidirectionalShare(contactId);
      showToast(twoWay.ok ? "共享云盘已创建，并已开通好友双向写入" : "共享云盘已创建：链接已复制；对方填云盘邮箱后可开通双向");
    } catch (e) {
      showToast(`共享云盘创建失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharingId(null);
    }
  }, []);

  const sendMessage = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    const f = await openFormModal("给好友留言", [{ key: "text", label: i18n("auto.components.NameCardSection.p8"), kind: "textarea", required: true }]);
    if (!f?.text) return;
    const r = await sendFriendText(channelId, f.text);
    showToast(r.ok ? "留言已写入共享云盘" : `留言只留在本机：${r.reason}`);
  }, [channelId]);

  const sendFile = useCallback(async (): Promise<void> => {
    if (!channelId) return;
    try {
      const staged = await stageFromPicker(true);
      let ok = 0;
      for (const f of staged) {
        const r = await sendFriendFile(channelId, { name: f.name, localPath: f.localPath, size: f.size });
        if (r.ok) ok++;
        else showToast(`「${f.name}」上传失败：${r.reason}`);
      }
      if (ok) showToast(`已把 ${ok} 个文件放进共享云盘`);
    } catch (e) {
      showToast(`文件选择失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [channelId]);

  const { personal, edit, pickAvatar, toVault, busy, cloudEmail } = usePersonalActions();
  /* 通讯录里直接收名片：粘贴对方的名片口令或扫码，不用先绕去暂存箱。 */
  const receive = useVaultReceive();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return doc.contacts
      .filter((c) => filter === "all" || c.kind === filter)
      .filter((c) => !onlyStarred || starred.has(c.id))
      .filter((c) => !q || `${c.name} ${c.note} ${contactBrief(c)} ${contactLink(c)}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id)) || b.addedAt - a.addedAt);
  }, [doc.contacts, filter, onlyStarred, query, starred]);

  const starButton = useCallback(
    (c: ContactCard, round = true): ReactNode => (
      <IconBtn
        className={round ? "contact-star" : undefined}
        label={`${starred.has(c.id) ? "取消星标：" : "星标："}${c.name}`}
        selected={starred.has(c.id)}
        size="sm"
        icon={<IconStar size="sm" />}
        onClick={(e) => {
          e.stopPropagation();
          toggleStar(c.id);
        }}
      />
    ),
    [starred, toggleStar],
  );

  const closeDetail = useCallback((): void => {
    setFocusedId(null);
    setChannelId(null);
  }, []);

  const filterActive = query.trim() !== "" || onlyStarred || filter !== "all";
  /* 筛选/搜索/只看星标时，自己的名片让位给搜索结果 */
  const showMine = !filterActive;
  /* 组织名片同理：搜索/星标时让位；按「好友」筛选时不出现，按「组织」或「全部」时出现。 */
  const showOrgs = !query.trim() && !onlyStarred && (filter === "all" || filter === "organization");

  return (
    <div className="contact-cabinet">
      <div className="contact-toolbar">
        <SearchField
          className="contact-search"
          value={query}
          onChange={setQuery}
          placeholder={i18n("auto.components.NameCardSection.15")}
          aria-label={i18n("auto.components.NameCardSection.16")}
        />
        <Inline gap={2} wrap>
          <Segment
            value={filter}
            onChange={(v) => setFilter(v as ContactFilter)}
            options={[
              { value: "all", label: i18n("auto.components.NameCardSection.p9") },
              { value: "personal", label: i18n("auto.components.NameCardSection.p10") },
              { value: "organization", label: i18n("auto.components.NameCardSection.p11") },
            ]}
          />
          <Chip icon={<IconStar size="sm" />} selected={onlyStarred} onClick={() => setOnlyStarred((v) => !v)}>
            {i18n("auto.components.NameCardSection.17")}</Chip>
          <Btn variant="outline" icon={<IconIn size="sm" />} onClick={() => setRecvOpen(true)}>{i18n("auto.components.NameCardSection.18")}</Btn>
        </Inline>
      </div>

      <div className="contact-deck">
        {showMine ? (
          <div className="contact-slot is-mine">
            <Btn
              className="contact-card-pick"
              aria-label={i18n("auto.components.NameCardSection.19")}
              data-vault-catch={JSON.stringify(personalCardCatch())}
              onClick={() => setSelfOpen(true)}
            >
              <IdentityCard card={personal} variant="hero" />
            </Btn>
          </div>
        ) : null}
        {showOrgs
          ? myOrgs.map((o) => (
              <div className="contact-slot" key={o.id}>
                <Btn
                  className="contact-card-pick"
                  aria-label={`打开${o.name}的组织主页`}
                  data-vault-catch={JSON.stringify(orgCardCatch(o))}
                  onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
                >
                  <IdentityCard card={o} organization />
                </Btn>
              </div>
            ))
          : null}
        {list.map((c) => (
          <div className="contact-slot" key={c.id}>
            <Btn
              className="contact-card-pick"
              aria-label={`打开${c.name}的名片`}
              data-vault-catch={JSON.stringify(contactCatch(c))}
              onClick={() => setFocusedId(c.id)}
            >
              <IdentityCard card={c.card} organization={c.kind === "organization"} />
            </Btn>
            {starButton(c)}
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title={filterActive ? "没有匹配的名片" : "还没有收到别人的名片"}
          hint={
            filterActive
              ? "换个关键词或切回「全部」；星标好友会排在卡片夹最前面。"
              : "现在只有你的名片和组织名片；别人的名片收进来后会排在这里。"
          }
          action={
            <Inline gap={2} wrap>
              <Btn variant="solid" tone="brand" icon={<IconIn size="sm" />} onClick={() => setRecvOpen(true)}>
                {i18n("auto.components.NameCardSection.18")}</Btn>
              {filterActive ? (
                <Btn variant="ghost" onClick={() => { setQuery(""); setOnlyStarred(false); setFilter("all"); }}>
                  {i18n("auto.components.NameCardSection.20")}</Btn>
              ) : null}
            </Inline>
          }
        />
      ) : null}

      <Modal open={recvOpen} onClose={() => setRecvOpen(false)} title={i18n("auto.components.NameCardSection.18")} size="sm">
        <Stack gap={3}>
          <Text slot="micro" tone="faint">{i18n("auto.components.NameCardSection.21")}</Text>
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={receive.busy} onClick={() => { setRecvOpen(false); void receive.paste(); }}>{i18n("auto.components.NameCardSection.4")}</Btn>
            <Btn variant="outline" disabled={receive.busy} onClick={() => { setRecvOpen(false); void receive.scan(); }}>{i18n("auto.components.NameCardSection.22")}</Btn>
            <Btn variant="ghost" onClick={() => { setRecvOpen(false); importContacts(); }}>{i18n("auto.components.NameCardSection.23")}</Btn>
          </Inline>
        </Stack>
      </Modal>

      {/* 我的名片大卡 */}
      <Modal open={selfOpen} onClose={() => setSelfOpen(false)} title={i18n("auto.components.NameCardSection.24")} className="contact-detail-modal" size="md">
        <div className="contact-detail">
          <div className="contact-detail-stage">
            <IdentityCard card={personal} variant="detail" />
          </div>
          <Stack gap={4}>
            <KeyValue
              rows={[
                { k: "名字", v: personal.name || "未填写" },
                { k: "简介", v: personal.bio || "未填写" },
                { k: "联系方式", v: [personal.website, personal.social, personal.phone].filter(Boolean).join(" · ") || "未填写" },
                { k: "清华云盘邮箱", v: cloudEmailText(cloudEmail) },
              ]}
            />
            <Inline gap={2} wrap>
              <Btn size="sm" variant="solid" tone="brand" icon={<IconPen size="sm" />} onClick={() => void edit()}>
                {i18n("auto.components.NameCardSection.1")}</Btn>
              <Btn size="sm" variant="outline" icon={<IconCamera size="sm" />} disabled={busy} onClick={() => void pickAvatar()}>
                {i18n("auto.components.NameCardSection.2")}</Btn>
              <Btn size="sm" variant="ghost" icon={<IconIn size="sm" />} onClick={toVault}>
                {i18n("auto.components.NameCardSection.3")}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setSelfOpen(false); goEntry("profile"); }}>
                {i18n("auto.components.NameCardSection.25")}</Btn>
            </Inline>
          </Stack>
        </div>
      </Modal>

      {/* 联系人大卡：详情一律弹出，不塞回页面 */}
      <Modal
        open={Boolean(focused)}
        onClose={closeDetail}
        title={shown ? `${shown.name} · 名片` : "名片"}
        className="contact-detail-modal"
        size="md"
      >
        {shown ? (
          <div className="contact-detail">
            <div className="contact-detail-stage">
              <IdentityCard card={shown.card} organization={shown.kind === "organization"} variant="detail" />
            </div>
            <Stack gap={4}>
              <KeyValue
                rows={[
                  { k: "类型", v: shown.kind === "organization" ? "组织" : "好友" },
                  { k: "备注", v: shown.note || "未填写" },
                  { k: "简介", v: contactBrief(shown) },
                  { k: shown.kind === "organization" ? "加入方式" : "联系方式", v: contactLink(shown) || "未填写" },
                  { k: "共享云盘", v: shown.shared?.shareUrl ? "已创建（链接可复制）" : "未创建" },
                ]}
              />
              <Inline gap={2} wrap>
                <Btn size="sm" variant="solid" tone="brand" icon={<IconIn size="sm" />} onClick={() => {
                  const r = addToVault(contactCatch(shown));
                  showToast(r.ok ? "名片已放进暂存箱" : r.reason === "duplicate" ? "暂存箱里已经有这张名片了" : "暂存箱暂时不可用，稍后再试");
                }}>
                  {i18n("auto.components.NameCardSection.3")}</Btn>
                {shown.shared?.shareUrl ? (
                  <Btn size="sm" variant="outline" icon={<IconCloud size="sm" />} onClick={() => {
                    void navigator.clipboard.writeText(shown.shared!.shareUrl!).then(
                      () => showToast(i18n("auto.components.NameCardSection.msg8")),
                      () => showToast(i18n("auto.components.NameCardSection.msg9")),
                    );
                  }}>
                    {i18n("auto.components.NameCardSection.26")}</Btn>
                ) : (
                  <Btn size="sm" variant="outline" icon={<IconCloud size="sm" />} disabled={sharingId === shown.id} onClick={() => void shareCloud(shown.id, shown.name)}>
                    {sharingId === shown.id ? "创建中…" : "共享云盘"}
                  </Btn>
                )}
                {shown.shared && !shown.shared.sharedWith && (shown.card as { cloudEmail?: string }).cloudEmail ? (
                  <Btn size="sm" variant="ghost" onClick={() => void openBidirectionalShare(shown.id).then((r) => showToast(r.ok ? "已开通双向写入" : `开通失败：${r.reason}`))}>
                    {i18n("auto.components.NameCardSection.27")}</Btn>
                ) : null}
                <Btn size="sm" variant="ghost" icon={<IconMail size="sm" />} onClick={() => setChannelId(channelId === shown.id ? null : shown.id)}>
                  {channelId === shown.id ? "收起通道" : "好友通道"}
                </Btn>
                {shown.kind === "organization" && (shown.card as OrgCard).joinUrl ? (
                  <Btn size="sm" variant="ghost" onClick={() => {
                    void navigator.clipboard.writeText((shown.card as OrgCard).joinUrl).then(
                      () => showToast(i18n("auto.components.NameCardSection.msg10")),
                      () => showToast(i18n("auto.components.NameCardSection.msg11")),
                    );
                  }}>
                    {i18n("auto.components.NameCardSection.28")}</Btn>
                ) : null}
                {starButton(shown, false)}
                <Btn size="sm" variant="ghost" tone="error" icon={<IconTrash size="sm" />} onClick={() => {
                  void confirmOk(`从通讯录删除「${shown.name}」？`).then((ok) => {
                    if (!ok) return;
                    removeContact(shown.id);
                    closeDetail();
                  });
                }}>
                  {i18n("auto.components.NameCardSection.29")}</Btn>
              </Inline>

              {channelId === shown.id ? (
                <div className="contact-channel">
                  <Inline justify="between" gap={2}>
                    <Text slot="label" weight="semibold">{i18n("auto.components.NameCardSection.30")}</Text>
                    <Btn variant="plain" onClick={() => setChannelId(null)}>{i18n("auto.components.NameCardSection.31")}</Btn>
                  </Inline>
                  {channelMessages.length === 0 ? (
                    <Text slot="micro" tone="faint">
                      {i18n("auto.components.NameCardSection.32")}</Text>
                  ) : (
                    <List divided>
                      {channelMessages.map((m) => (
                        <Row
                          key={m.id}
                          flush
                          leading={m.kind === "file" ? <IconFile size="sm" /> : <IconMail size="sm" />}
                          title={m.kind === "file" ? "文件：" + m.text : m.text}
                          sub={m.cloudPath ? "已写入共享云盘" : "仅本机"}
                        />
                      ))}
                    </List>
                  )}
                  <Inline gap={2} wrap>
                    <Btn variant="solid" tone="brand" icon={<IconMail size="sm" />} onClick={() => void sendMessage()}>{i18n("auto.components.NameCardSection.33")}</Btn>
                    <Btn variant="ghost" icon={<IconFile size="sm" />} onClick={() => void sendFile()}>{i18n("auto.components.NameCardSection.34")}</Btn>
                  </Inline>
                </div>
              ) : null}
            </Stack>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ══════════════ 对外入口 ══════════════ */

export function NameCardSection({ view = "all" }: { view?: "all" | "personal" | "contacts" }): ReactNode {
  if (view === "personal") {
    return (
      <Stack gap={6}>
        <PersonalCardBlock />
        <OrgCardsSection />
      </Stack>
    );
  }
  return (
    <Stack gap={6}>
      {view === "all" ? <PersonalCardBlock /> : null}
      <ContactCabinet />
      {view === "all" ? <OrgCardsSection /> : null}
    </Stack>
  );
}
