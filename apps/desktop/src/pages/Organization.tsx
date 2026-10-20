import { useEffect, useMemo, useState, type ReactNode } from "react";
/**
 * 组织主页（page=org，navParams.orgId）：组织是完整页面，不是一张卡片。
 *
 * 结构：页头（名字/简介/邀请/编辑）→ 概览 / 成员 / 资料库 / GitLab / 项目 / 公告。
 * 口径（2026-10-19 用户拍板）：
 * - 成员是真实清华云盘邮箱，不只是名字（资料库共享按邮箱发）；
 * - 资料库是清华云盘「资料库（repo）」，不是组织里的文件夹；
 * - GitLab 仓库只存引用（id/path），可关联已有仓库或直接新建；
 * - 邀请口令可起名、可限定接收邮箱。
 */
import { Btn, Card, EmptyState, IconIn, Inline, KeyValue, List, Modal, Row, Section, Segment, Select, Stack, Text } from "@onethu/gui";
import { QRCodeSVG } from "qrcode.react";
import { IdentityCard } from "../components/IdentityCard.js";
import { PageHead } from "../components/Layout.js";
import { confirmOk } from "../lib/confirm.js";
import { openFormModal } from "../lib/formModal.js";
import { showToast } from "../state/toast.js";
import { useApp } from "../state/context.js";
import { openTab } from "../state/explorer.js";
import {
  acceptOrgInvite, addOrgLibrary, addOrgMember, createOrg, currentOrgEmail, deleteOrg, deleteOrgAnnouncement, deleteOrgProject,
  linkOrgGitlab, markOrgLibraryShared, orgIdentityCard, orgInviteCode, orgSnapshot, removeOrgLibrary, removeOrgMember,
  revokeOrgInvite, saveOrgAnnouncement, saveOrgProject, setOrgGitlabGroup, setOrgMemberRole, unlinkOrgGitlab,
  updateOrg, updateOrgMember,
  useOrgs, type Org, type OrgAnnouncement, type OrgProject, type OrgRole,
} from "../state/org.js";
import {
  ensureSeafileLoaded, getSeafileToken, openDir, refreshRepos, seafileCreateRepo, seafileDownload,
  seafilePreview, seafileShareRepo, seafileShareRepoToUser, useSeafile,
  type SeafileEntry, type SeafilePreview,
} from "../state/seafile.js";
import {
  gitlabAddGroupMember, gitlabAddProjectMember, gitlabCreateGroup, gitlabCreateProject, gitlabProject,
  gitlabProjectByPath, gitlabSearchUsers,
} from "../state/gitlab.js";
import { openExternal } from "./info/openExternal.js";
import { addToVault } from "../state/vault.js";
import { orgCardCatch } from "../state/nameCard.js";
import { t as i18n } from "../i18n/index.js";


const ROLE_LABEL: Record<OrgRole, string> = { owner: "负责人", member: "成员", guest: "访客" };

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const INVITE_EXPIRES = [
  { value: "1", label: "1 天" },
  { value: "7", label: "7 天" },
  { value: "30", label: "30 天" },
  { value: "0", label: "不过期" },
];

/** 当前邀请口令的有效期 → 表单默认值（尽量取最接近的档位）。 */
function inviteExpireDays(invite?: { expiresAt?: number }): string {
  if (!invite) return "7";
  if (!invite.expiresAt) return "0";
  const days = Math.max(1, Math.round((invite.expiresAt - Date.now()) / 86400_000));
  const nearest = [1, 7, 30].reduce((a, b) => (Math.abs(b - days) < Math.abs(a - days) ? b : a), 7);
  return String(nearest);
}

function expireText(at?: number): string {
  if (!at) return "不过期";
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** GitLab path 规则：小写字母/数字/_/-/.；中文名转不出就退回 org-<时间>。 */
function gitlabSlug(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_.-]/g, "");
  return slug || "org-" + Date.now().toString(36);
}

/* ══════════ 选择组织（深链没带 orgId 时的落地页） ══════════ */

function OrgPicker(): ReactNode {
  const doc = useOrgs();
  const create = async (): Promise<void> => {
    const email = await currentOrgEmail();
    const f = await openFormModal("新建组织", [
      { key: "name", label: i18n("auto.pages.Organization.p1"), required: true },
      { key: "brief", label: i18n("auto.pages.Organization.p2"), kind: "textarea" },
      { key: "joinUrl", label: i18n("auto.pages.Organization.p3") },
    ]);
    if (!f?.name) return;
    const org = createOrg({ name: f.name, brief: f.brief, joinUrl: f.joinUrl, ownerEmail: email });
    openTab("org", { orgId: org.id }, { title: org.name });
    showToast(`已创建「${org.name}」`);
  };
  const join = async (): Promise<void> => {
    const f = await openFormModal("用邀请口令加入组织", [
      { key: "code", label: i18n("auto.pages.Organization.p4"), kind: "textarea", required: true },
      { key: "name", label: i18n("auto.pages.Organization.p5"), default: "我" },
    ]);
    if (!f?.code) return;
    const r = await acceptOrgInvite(f.code, f.name || "我");
    if (!r.ok) {
      showToast(r.reason ?? "邀请口令无法识别");
      return;
    }
    showToast(i18n("auto.pages.Organization.msg1"));
    if (r.orgId) openTab("org", { orgId: r.orgId }, { title: i18n("auto.pages.Organization.p6") });
  };
  return (
    <div className="org-page">
      <PageHead
        title={i18n("auto.pages.Organization.1")}
        meta="成员、资料库与 GitLab 仓库，都落在真实账号上。"
        actions={
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void create()}>{i18n("auto.pages.Organization.2")}</Btn>
            <Btn variant="outline" onClick={() => void join()}>{i18n("auto.pages.Organization.3")}</Btn>
          </Inline>
        }
      />
      {doc.orgs.length === 0 ? (
        <EmptyState
          icon={<IconIn size="lg" />}
          title={i18n("auto.pages.Organization.4")}
          hint={i18n("auto.pages.Organization.5")}
          action={
            <Inline gap={2} wrap>
              <Btn variant="solid" tone="brand" onClick={() => void create()}>{i18n("auto.pages.Organization.2")}</Btn>
              <Btn variant="outline" onClick={() => void join()}>{i18n("auto.pages.Organization.3")}</Btn>
            </Inline>
          }
        />
      ) : (
        <List divided>
          {doc.orgs.map((o) => (
            <Row
              key={o.id}
              title={o.name}
              sub={`${o.members.length} 名成员 · ${(o.libraries ?? []).length} 个资料库 · ${(o.gitlabRepos ?? []).length} 个仓库${o.brief ? " · " + o.brief : ""}`}
              onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
              trailing={<Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openTab("org", { orgId: o.id }, { title: o.name }); }}>{i18n("auto.pages.Organization.6")}</Btn>}
            />
          ))}
        </List>
      )}
    </div>
  );
}

/* ══════════ 资料库内联文件浏览 + 文件预览 ══════════ */

function LibraryFiles({ repoId, name }: { repoId: string; name: string }): ReactNode {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SeafileEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ title: string; data: SeafilePreview } | null>(null);
  const [previewing, setPreviewing] = useState("");

  const load = async (next: string): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await ensureSeafileLoaded();
      setEntries(await openDir(repoId, next, true));
      setPath(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const openFile = async (entry: SeafileEntry): Promise<void> => {
    const full = (path === "/" ? "" : path) + "/" + entry.name;
    setPreviewing(entry.name);
    try {
      const data = await seafilePreview(repoId, full);
      setPreview({ title: entry.name, data });
    } catch (e) {
      showToast(`打不开预览：${e instanceof Error ? e.message : String(e)}（可直接下载）`);
    } finally {
      setPreviewing("");
    }
  };

  return (
    <div className="org-files">
      <div className="name-card-actions">
        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void load(path)}>{i18n("auto.pages.Organization.7")}</Btn>
        {path !== "/" ? <Btn size="sm" variant="ghost" onClick={() => void load(path.replace(/\/[^/]+$/, "") || "/")}>{i18n("auto.pages.Organization.8")}</Btn> : null}
        <Text slot="micro" tone="faint">「{name}」{path === "/" ? "根目录" : path}</Text>
      </div>
      {busy && !entries ? <Text slot="micro" tone="faint">{i18n("auto.pages.Organization.9")}</Text> : null}
      {error ? <Text slot="micro" tone="faint">{error}{i18n("auto.pages.Organization.10")}</Text> : null}
      {entries && entries.length === 0 ? <Text slot="micro" tone="faint">{i18n("auto.pages.Organization.11")}</Text> : null}
      {entries && entries.length > 0 ? (
        <List divided>
          {entries.map((entry) => (
            <Row
              key={entry.name}
              title={entry.name}
              sub={entry.kind === "dir" ? "文件夹" : `${Math.max(1, Math.ceil(entry.size / 1024))} KB`}
              onClick={() => {
                if (entry.kind === "dir") void load((path === "/" ? "" : path) + "/" + entry.name);
                else void openFile(entry);
              }}
              trailing={entry.kind === "file" ? <Btn size="sm" variant="ghost" disabled={previewing === entry.name} onClick={(e) => { e.stopPropagation(); void openFile(entry); }}>{previewing === entry.name ? "读取中…" : "预览"}</Btn> : null}
            />
          ))}
        </List>
      ) : null}
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview ? `${name} · ${preview.title}` : name} size="lg">
        {preview?.data.kind === "text" ? (
          <pre className="org-file-text">{preview.data.text}</pre>
        ) : preview?.data.kind === "image" ? (
          <img className="org-file-image" src={preview.data.dataUrl} alt={preview.title} />
        ) : (
          <Stack gap={3}>
            <Text slot="micro" tone="faint">
              {preview?.data.kind === "too-big" ? "文件太大，不适合直接预览" : "这种文件不支持内联预览"}
              {preview?.data.size ? `（约 ${Math.ceil(preview.data.size / 1024)} KB）` : ""}
            </Text>
            <Inline gap={2}>
              <Btn variant="outline" onClick={() => void seafileDownload(repoId, (path === "/" ? "" : path) + "/" + (preview?.title ?? "")).catch((e) => showToast(`下载失败：${e instanceof Error ? e.message : String(e)}`))}>{i18n("auto.pages.Organization.12")}</Btn>
              <Btn variant="ghost" onClick={() => setPreview(null)}>{i18n("auto.pages.Organization.13")}</Btn>
            </Inline>
          </Stack>
        )}
      </Modal>
    </div>
  );
}

/* ══════════ GitLab 仓库内联预览 ══════════ */

function RepoPreview({ projectId }: { projectId: number }): ReactNode {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof gitlabProject>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await gitlabProject(projectId);
        if (alive) setDetail(d);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [projectId]);
  if (error) return <Text slot="micro" tone="faint">{error}{i18n("auto.pages.Organization.14")}</Text>;
  if (!detail) return <Text slot="micro" tone="faint">{i18n("auto.pages.Organization.15")}</Text>;
  const last = detail.last_activity_at ? new Date(detail.last_activity_at).toLocaleString("zh-CN", { hour12: false }) : "未知";
  return (
    <KeyValue
      rows={[
        { k: "描述", v: detail.description || "（空）" },
        { k: "默认分支", v: detail.default_branch || "（空库）" },
        { k: "可见性", v: detail.visibility === "private" ? "私有" : detail.visibility === "internal" ? "内部" : "公开" },
        { k: "Star / Fork", v: `${detail.star_count} / ${detail.forks_count}` },
        { k: "未关闭 Issue", v: String(detail.open_issues_count) },
        { k: "最近活动", v: last },
      ]}
    />
  );
}

/* ══════════ 组织主页 ══════════ */

/** 深链/旧标签指向的组织在本机不存在（已删除/换设备）：给明确出口，不装作空组织页。 */
function OrgMissing(): ReactNode {
  return (
    <div className="org-page">
      <PageHead
        title={i18n("auto.pages.Organization.1")}
        meta="这个组织不在这台设备上了。"
        actions={<Btn variant="outline" onClick={() => openTab("contacts", { section: "orgs" })}>{i18n("auto.pages.Organization.16")}</Btn>}
      />
      <EmptyState
        icon={<IconIn size="lg" />}
        title={i18n("auto.pages.Organization.17")}
        hint={i18n("auto.pages.Organization.18")}
        action={<Btn variant="solid" tone="brand" onClick={() => openTab("contacts", { section: "orgs" })}>{i18n("auto.pages.Organization.19")}</Btn>}
      />
    </div>
  );
}

export function OrganizationPage(): ReactNode {
  const { navParams } = useApp();
  const doc = useOrgs();
  const orgId = (navParams as { orgId?: string } | null)?.orgId;
  const org: Org | null = doc.orgs.find((o) => o.id === orgId) ?? null;
  const [tab, setTab] = useState("overview");
  const [invite, setInvite] = useState<{ code: string; label?: string; allowEmail?: string } | null>(null);
  const [sharing, setSharing] = useState("");
  const [openLib, setOpenLib] = useState<string | null>(null);
  const [openRepo, setOpenRepo] = useState<number | null>(null);
  const seafile = useSeafile();
  /* 云盘配置是懒加载的：进组织页先把 token / 资料库列表拉起来，
     否则「新建资料库」会拿空 token 直接跳云盘页（用户观感=报错）。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      await ensureSeafileLoaded();
      if (!alive || !getSeafileToken()) return;
      await refreshRepos();
    })();
    return () => { alive = false; };
  }, []);
  const noticeList = useMemo(
    () => [...(org?.announcements ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [org?.announcements],
  );

  /* ── 基本资料 ── */
  const editOrg = async (target: Org): Promise<void> => {
    const f = await openFormModal("编辑组织资料", [
      { key: "name", label: i18n("auto.pages.Organization.p7"), required: true, default: target.name },
      { key: "brief", label: i18n("auto.pages.Organization.p8"), kind: "textarea", default: target.brief },
      { key: "joinUrl", label: i18n("auto.pages.Organization.p9"), default: target.joinUrl },
    ]);
    if (!f?.name) return;
    updateOrg(target.id, { name: f.name, brief: f.brief ?? "", joinUrl: f.joinUrl ?? "" });
    showToast(i18n("auto.pages.Organization.msg2"));
  };

  /* ── 邀请 ── */
  const makeInvite = async (target: Org): Promise<void> => {
    const f = await openFormModal("邀请成员", [
      { key: "label", label: i18n("auto.pages.Organization.p10"), default: target.invite?.label ?? "" },
      { key: "allowEmail", label: i18n("auto.pages.Organization.p11"), default: target.invite?.allowEmail ?? "" },
      { key: "expireDays", label: i18n("auto.pages.Organization.p12"), kind: "select", options: INVITE_EXPIRES, default: inviteExpireDays(target.invite) },
    ]);
    if (!f) return;
    const email = (f.allowEmail ?? "").trim();
    if (email && !isEmail(email)) {
      showToast(i18n("auto.pages.Organization.msg3"));
      return;
    }
    const expireDays = Number(f.expireDays ?? "7") === 0 ? 0 : Number(f.expireDays ?? "7");
    try {
      const code = await orgInviteCode(target, "我", { label: f.label ?? "", allowEmail: email, expireDays });
      setInvite({ code, ...(f.label ? { label: f.label } : {}), ...(email ? { allowEmail: email } : {}) });
      const lifetime = expireDays > 0 ? `${expireDays} 天有效` : "不过期";
      await navigator.clipboard.writeText(code).then(() => showToast(`邀请口令已复制（${lifetime}）`)).catch(() => showToast(`邀请口令已生成（${lifetime}）`));
    } catch (e) {
      showToast(`生成邀请失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /* ── 成员 ── */
  const addMember = async (target: Org): Promise<void> => {
    const f = await openFormModal("添加成员", [
      { key: "email", label: i18n("auto.pages.Organization.p13"), required: true, placeholder: i18n("auto.pages.Organization.p14") },
      { key: "name", label: i18n("auto.pages.Organization.p15") },
      { key: "role", label: i18n("auto.pages.Organization.p16"), kind: "select", options: [{ value: "member", label: i18n("auto.pages.Organization.p17") }, { value: "guest", label: i18n("auto.pages.Organization.p18") }, { value: "owner", label: i18n("auto.pages.Organization.p19") }] },
    ]);
    if (!f?.email) return;
    if (!isEmail(f.email)) {
      showToast(i18n("auto.pages.Organization.msg4"));
      return;
    }
    const name = f.name?.trim() || f.email.split("@")[0] || "成员";
    const role = (f.role as OrgRole) ?? "member";
    const email = f.email.trim().toLowerCase();
    const r = addOrgMember(target.id, name, email, role);
    showToast(r.ok ? "成员已加入" : r.reason === "duplicate" ? "这个邮箱已经在组织里了" : "成员信息不合法");
    if (r.ok) autoSyncMember(target.id, email, role);
  };

  const editMember = async (target: Org, memberId: string): Promise<void> => {
    const m = target.members.find((x) => x.id === memberId);
    if (!m) return;
    const f = await openFormModal("编辑成员", [
      { key: "name", label: i18n("auto.pages.Organization.p20"), default: m.name },
      { key: "email", label: i18n("auto.pages.Organization.p21"), default: m.email, placeholder: i18n("auto.pages.Organization.p22") },
    ]);
    if (!f) return;
    const r = updateOrgMember(target.id, memberId, { name: f.name ?? m.name, email: f.email ?? m.email });
    showToast(r.ok ? "成员资料已更新" : r.reason === "duplicate" ? "这个邮箱已经在组织里了" : "邮箱格式不对");
    const nextEmail = (f.email ?? m.email).trim().toLowerCase();
    if (r.ok && nextEmail && nextEmail !== m.email) autoSyncMember(target.id, nextEmail, m.role);
  };

  /* ── 资料库 ── */
  const createLibrary = async (target: Org): Promise<void> => {
    await ensureSeafileLoaded();
    if (!getSeafileToken()) {
      showToast(i18n("auto.pages.Organization.msg5"));
      openTab("cloud");
      return;
    }
    const f = await openFormModal("新建组织资料库", [{ key: "name", label: i18n("auto.pages.Organization.p23"), default: `${target.name} 资料库`, required: true }]);
    if (!f?.name) return;
    setSharing("create-lib");
    try {
      const repoId = await seafileCreateRepo(f.name);
      const r = addOrgLibrary(target.id, { repoId, name: f.name.trim() });
      showToast(r.ok ? `资料库「${f.name}」已建好并挂到组织上` : "这个资料库已经关联过了");
      if (r.ok) void autoShareLibraries(target.id);
    } catch (e) {
      showToast(`建资料库失败：${e instanceof Error ? e.message : String(e)}（可到云盘页确认登录后重试）`);
    } finally {
      setSharing("");
    }
  };

  const linkLibrary = async (target: Org): Promise<void> => {
    const repos = seafile.repos.filter((r) => !(target.libraries ?? []).some((l) => l.repoId === r.id));
    if (!repos.length) {
      showToast(seafile.repos.length ? "云盘里的资料库都已关联" : "云盘里还没有资料库：先新建一个");
      return;
    }
    const f = await openFormModal("关联已有资料库", [
      { key: "repoId", label: i18n("auto.pages.Organization.p24"), kind: "select", options: repos.map((r) => ({ value: r.id, label: r.name })) },
    ]);
    if (!f?.repoId) return;
    const hit = repos.find((r) => r.id === f.repoId);
    const r = addOrgLibrary(target.id, { repoId: f.repoId, name: hit?.name ?? f.repoId });
    showToast(r.ok ? "资料库已关联" : "这个资料库已经关联过了");
    if (r.ok) void autoShareLibraries(target.id);
  };

  const shareLibrary = async (target: Org, repoId: string, name: string): Promise<void> => {
    const targets = target.members.filter((m) => m.email);
    if (!targets.length) {
      showToast(i18n("auto.pages.Organization.msg6"));
      return;
    }
    await ensureSeafileLoaded();
    if (!getSeafileToken()) {
      showToast(i18n("auto.pages.Organization.msg7"));
      openTab("cloud");
      return;
    }
    if (!(await confirmOk(`把资料库「${name}」共享给 ${targets.length} 位成员的云盘账号？`))) return;
    setSharing(repoId);
    let ok = 0;
    const failed: string[] = [];
    for (const m of targets) {
      try {
        await seafileShareRepoToUser(repoId, m.email, m.role === "guest" ? "r" : "rw");
        ok += 1;
      } catch {
        failed.push(m.email);
      }
    }
    if (ok) markOrgLibraryShared(target.id, repoId, targets.filter((m) => !failed.includes(m.email)).map((m) => m.email));
    setSharing("");
    showToast(ok ? `已共享给 ${ok} 位成员${failed.length ? `；${failed.length} 位失败（可在云盘里手动补）` : ""}` : "共享失败：检查云盘登录与成员邮箱");
  };

  const copyLibraryLink = async (repoId: string, name: string): Promise<void> => {
    setSharing(repoId);
    try {
      await ensureSeafileLoaded();
      if (!getSeafileToken()) throw new Error("清华云盘未连接：先到云盘页登录");

      const share = await seafileShareRepo(repoId, 7);
      await navigator.clipboard.writeText(share.shareUrl).catch(() => undefined);
      showToast(`「${name}」的分享链接已复制（7 天有效）`);
    } catch (e) {
      showToast(`生成分享链接失败：${e instanceof Error ? e.message : String(e)}（可在云盘页确认登录后重试）`);
    } finally {
      setSharing("");
    }
  };

  /* ── 自动共享：资料库按邮箱、GitLab 仓库按邮箱查账号加成员 ── */

  /** 把组织的所有资料库共享给这些邮箱（已共享过的不重复发）。 */
  const shareLibrariesToEmails = async (orgId: string, targets: Array<{ email: string; role: OrgRole }>): Promise<{ ok: number; failed: number }> => {
    await ensureSeafileLoaded();
    if (!getSeafileToken() || !targets.length) return { ok: 0, failed: 0 };
    const latest = orgSnapshot().orgs.find((o) => o.id === orgId);
    let ok = 0;
    let failed = 0;
    for (const lib of latest?.libraries ?? []) {
      const pending = targets.filter((m) => m.email && !(lib.sharedWith ?? []).includes(m.email));
      const done: string[] = [];
      for (const m of pending) {
        try {
          await seafileShareRepoToUser(lib.repoId, m.email, m.role === "guest" ? "r" : "rw");
          done.push(m.email);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      if (done.length) markOrgLibraryShared(orgId, lib.repoId, done);
    }
    return { ok, failed };
  };

  /**
   * 按成员邮箱搜 GitLab 账号，先邀请进「GitLab 组织（群组）」，再加进组织的每个仓库。
   * 已是成员（409/400）当作成功；搜不到就记进 skipped 让用户手动加。
   */
  const syncGitlabMembers = async (orgId: string, targets: Array<{ email: string; role: OrgRole }>): Promise<{ ok: number; skipped: string[] }> => {
    const latest = orgSnapshot().orgs.find((o) => o.id === orgId);
    const repos = latest?.gitlabRepos ?? [];
    const group = latest?.gitlabGroup;
    if ((!repos.length && !group) || !targets.length) return { ok: 0, skipped: [] };
    let ok = 0;
    const skipped: string[] = [];
    const tolerate = (e: unknown): boolean => /already|409|400|member/i.test(e instanceof Error ? e.message : String(e));
    for (const m of targets) {
      try {
        const users = await gitlabSearchUsers(m.email);
        const hit = users.find((u) => u.email === m.email.toLowerCase());
        if (!hit) {
          skipped.push(m.email);
          continue;
        }
        const level = m.role === "guest" ? 20 : 30;
        if (group) {
          try {
            await gitlabAddGroupMember(group.id, hit.id, level);
            ok += 1;
          } catch (e) {
            if (tolerate(e)) ok += 1;
            else skipped.push(m.email);
          }
        }
        for (const repo of repos) {
          try {
            await gitlabAddProjectMember(repo.id, hit.id, level);
            if (!group) ok += 1;
          } catch (e) {
            if (!tolerate(e) && !group) skipped.push(m.email);
          }
        }
      } catch {
        skipped.push(m.email);
      }
    }
    return { ok, skipped: Array.from(new Set(skipped)) };
  };

  /** 新成员 / 改邮箱后自动同步两边权限；失败只提示，不挡操作。 */
  const autoSyncMember = (orgId: string, email: string, role: OrgRole): void => {
    void (async () => {
      try {
        const r = await shareLibrariesToEmails(orgId, [{ email, role }]);
        if (r.ok) showToast(`资料库已共享给 ${email}`);
      } catch {
        /* 未连云盘：不打扰 */
      }
      try {
        const g = await syncGitlabMembers(orgId, [{ email, role }]);
        if (g.ok) showToast(`GitLab 仓库权限已给 ${email}`);
      } catch {
        /* GitLab 未登录：不打扰 */
      }
    })();
  };

  /** 新建/关联资料库后自动共享给全体有邮箱的成员。 */
  const autoShareLibraries = (orgId: string): void => {
    void (async () => {
      const latest = orgSnapshot().orgs.find((o) => o.id === orgId);
      const targets = (latest?.members ?? []).filter((m) => m.email).map((m) => ({ email: m.email, role: m.role }));
      if (!targets.length) return;
      try {
        const r = await shareLibrariesToEmails(orgId, targets);
        if (r.ok) showToast(`资料库已自动共享给 ${r.ok} 次`);
        else if (r.failed) showToast(`有 ${r.failed} 次共享失败：可在云盘页确认登录后重试`);
      } catch {
        /* 未连云盘：页面已有提示，不重复打扰 */
      }
    })();
  };

  /** 新建/关联仓库后自动把成员按邮箱加进 GitLab 仓库。 */
  const autoSyncGitlab = (orgId: string): void => {
    void (async () => {
      const latest = orgSnapshot().orgs.find((o) => o.id === orgId);
      const targets = (latest?.members ?? []).filter((m) => m.email).map((m) => ({ email: m.email, role: m.role }));
      if (!targets.length || !(latest?.gitlabRepos ?? []).length) return;
      try {
        const g = await syncGitlabMembers(orgId, targets);
        if (g.ok) showToast(`已把 ${g.ok} 位成员加进 GitLab 仓库`);
        else if (g.skipped.length) showToast(i18n("auto.pages.Organization.msg8"));
      } catch {
        showToast(i18n("auto.pages.Organization.msg9"));
      }
    })();
  };

  /** 「同步权限」：资料库与 GitLab 仓库一起同步给所有有邮箱的成员。 */
  const syncAllPermissions = async (target: Org): Promise<void> => {
    const latest = orgSnapshot().orgs.find((o) => o.id === target.id) ?? target;
    const targets = latest.members.filter((m) => m.email).map((m) => ({ email: m.email, role: m.role }));
    if (!targets.length) {
      showToast(i18n("auto.pages.Organization.msg10"));
      return;
    }
    setSharing("sync-all");
    try {
      const r = await shareLibrariesToEmails(latest.id, targets);
      const g = await syncGitlabMembers(latest.id, targets);
      setSharing("");
      showToast(`资料库 ${r.ok} 次共享；GitLab ${g.ok} 次授权${g.skipped.length ? `；${g.skipped.length} 位在 GitLab 搜不到（可手动加）` : ""}`);
    } catch (e) {
      setSharing("");
      showToast(`同步失败：${e instanceof Error ? e.message : String(e)}（确认云盘与 GitLab 登录）`);
    }
  };

  /* ── GitLab ── */
  const linkGitlab = async (target: Org): Promise<void> => {
    const f = await openFormModal("关联 GitLab 仓库", [
      { key: "path", label: i18n("auto.pages.Organization.p25"), required: true, placeholder: "group/project" },
    ]);
    if (!f?.path) return;
    setSharing("gitlab");
    try {
      const repo = await gitlabProjectByPath(f.path);
      const r = linkOrgGitlab(target.id, repo);
      showToast(r.ok ? `已关联「${repo.name}」` : "这个仓库已经关联过了");
      if (r.ok) void autoSyncGitlab(target.id);
    } catch (e) {
      showToast(`找不到仓库（GitLab 未登录也会这样）：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing("");
    }
  };

  /**
   * 创建组织仓库 = 先建一个 **GitLab 组织（群组）**（还没有的话），
   * 把成员都邀请进去，再把仓库建在这个组织下面 —— 不是孤立地在个人命名空间建仓库。
   */
  const createGitlab = async (target: Org): Promise<void> => {
    const latest = orgSnapshot().orgs.find((o) => o.id === target.id) ?? target;
    const group = latest.gitlabGroup;
    const fields = [
      ...(group ? [] : [{ key: "groupName", label: i18n("auto.pages.Organization.p26"), default: target.name, required: true } as const]),
      { key: "name", label: group ? "新仓库名" : "第一个仓库名", default: gitlabSlug(target.name), required: true } as const,
      { key: "description", label: i18n("auto.pages.Organization.p27") } as const,
      {
        key: "visibility",
        label: i18n("auto.pages.Organization.p28"),
        kind: "select" as const,
        options: [{ value: "private", label: i18n("auto.pages.Organization.p29") }, { value: "internal", label: i18n("auto.pages.Organization.p30") }, { value: "public", label: i18n("auto.pages.Organization.p31") }],
      },
    ];
    const f = await openFormModal(group ? "在 GitLab 组织下新建仓库" : "创建 GitLab 组织与仓库", fields);
    if (!f?.name) return;
    const visibility = (f.visibility as "private" | "internal" | "public") ?? "private";
    setSharing("gitlab");
    try {
      let groupRef = group;
      if (!groupRef) {
        const groupName = (f.groupName ?? target.name).trim();
        groupRef = await gitlabCreateGroup({
          name: groupName,
          path: gitlabSlug(groupName),
          description: `${target.name} 的组织空间`,
          visibility,
        });
        setOrgGitlabGroup(target.id, groupRef);
      }
      const repo = await gitlabCreateProject({
        name: f.name,
        description: f.description || `${target.name} 的组织仓库`,
        visibility,
        namespaceId: groupRef.id,
      });
      linkOrgGitlab(target.id, repo);
      showToast(group ? `仓库「${repo.name}」已建在 GitLab 组织下` : `GitLab 组织「${groupRef.name}」与仓库「${repo.name}」已创建`);
      void autoSyncGitlab(target.id);
    } catch (e) {
      showToast(`创建 GitLab 组织/仓库失败：${e instanceof Error ? e.message : String(e)}（可在 GitLab 页确认登录与组织名占用）`);
    } finally {
      setSharing("");
    }
  };

  /* ── 项目 / 公告 ── */
  const editProject = async (target: Org, project?: OrgProject): Promise<void> => {
    const f = await openFormModal(project ? "编辑项目" : "新建项目", [
      { key: "name", label: i18n("auto.pages.Organization.p32"), required: true, default: project?.name },
      { key: "description", label: i18n("auto.pages.Organization.p33"), kind: "textarea", default: project?.description },
      { key: "owner", label: i18n("auto.pages.Organization.p34"), default: project?.owner },
    ]);
    if (!f) return;
    saveOrgProject(target.id, { id: project?.id, name: f.name!, description: f.description ?? "", owner: f.owner ?? "", status: project?.status ?? "planned" });
  };

  const editNotice = async (target: Org, notice?: OrgAnnouncement): Promise<void> => {
    const f = await openFormModal(notice ? "编辑公告" : "发布公告", [
      { key: "title", label: i18n("auto.pages.Organization.p35"), required: true, default: notice?.title },
      { key: "body", label: i18n("auto.pages.Organization.p36"), kind: "textarea", required: true, default: notice?.body },
    ]);
    if (!f) return;
    saveOrgAnnouncement(target.id, { id: notice?.id, title: f.title!, body: f.body!, pinned: notice?.pinned ?? false });
  };

  if (!org) return orgId ? <OrgMissing /> : <OrgPicker />;

  const owner = org.members.find((m) => m.role === "owner");
  const libraries = org.libraries ?? [];
  const gitlabRepos = org.gitlabRepos ?? [];
  const projects = org.projects ?? [];

  return (
    <div className="org-page">
      <PageHead
        title={org.name}
        meta={org.brief || "成员、资料库与 GitLab 仓库都挂在这个组织上。"}
        actions={
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void makeInvite(org)}>{i18n("auto.pages.Organization.20")}</Btn>
            <Btn variant="outline" onClick={() => void editOrg(org)}>{i18n("auto.pages.Organization.21")}</Btn>
            <Btn variant="ghost" onClick={() => openTab("contacts", { section: "orgs" })}>{i18n("auto.pages.Organization.22")}</Btn>
          </Inline>
        }
      />
      <div className="org-tabs">
        <Segment
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: i18n("auto.pages.Organization.p37") },
            { value: "members", label: i18n("auto.pages.Organization.p38") },
            { value: "libraries", label: i18n("auto.pages.Organization.p39") },
            { value: "gitlab", label: "GitLab" },
            { value: "projects", label: i18n("auto.pages.Organization.p40") },
            { value: "notices", label: i18n("auto.pages.Organization.p41") },
          ]}
        />
      </div>

      {tab === "overview" ? (
        <Stack gap={5}>
          <Card>
            <Section title={i18n("auto.pages.Organization.23")} hint={i18n("auto.pages.Organization.24")} />
            <KeyValue
              rows={[
                { k: "成员", v: `${org.members.length} 人（${org.members.filter((m) => m.email).length} 人已绑定邮箱）` },
                { k: "负责人", v: owner ? `${owner.name}${owner.email ? ` · ${owner.email}` : ""}` : "未设置" },
                { k: "资料库", v: libraries.length ? libraries.map((l) => l.name).join("、") : "还没有资料库" },
                { k: "GitLab 组织", v: org.gitlabGroup ? `${org.gitlabGroup.name}（${org.gitlabGroup.path}）` : "还没有（新建仓库时自动创建）" },
                { k: "GitLab 仓库", v: gitlabRepos.length ? gitlabRepos.map((r) => r.path).join("、") : "还没有关联仓库" },
                { k: "加入方式", v: org.joinUrl || "未设置" },
              ]}
            />
            <div className="name-card-actions">
              <Btn variant="outline" onClick={() => void addMember(org)}>{i18n("auto.pages.Organization.25")}</Btn>
              <Btn variant="outline" onClick={() => setTab("libraries")}>{i18n("auto.pages.Organization.26")}</Btn>
              <Btn variant="ghost" onClick={() => setTab("gitlab")}>{i18n("auto.pages.Organization.27")}</Btn>
              <Btn variant="ghost" onClick={() => { const r = addToVault(orgCardCatch(orgIdentityCard(org))); showToast(r.ok ? "组织名片已放进暂存箱" : "暂存箱里已经有这张名片了"); }}>{i18n("auto.pages.Organization.28")}</Btn>
            </div>
          </Card>
          {org.invite ? (
            <Card>
              <Section title={i18n("auto.pages.Organization.29")} hint={i18n("auto.pages.Organization.30")} />
              <div className="vault-share">
                <Text slot="micro" tone="faint">
                  {org.invite.label ? `「${org.invite.label}」` : "邀请口令"}　{i18n("auto.pages.Organization.31")}{org.invite.allowEmail ?? "任何人"}　{i18n("auto.pages.Organization.32")}{expireText(org.invite.expiresAt)}
                </Text>
                <code className="vault-share-code">{org.invite.code}</code>
                <Inline gap={2} wrap>
                  <Btn size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(org.invite!.code).then(() => showToast(i18n("auto.pages.Organization.msg11"))).catch(() => showToast(i18n("auto.pages.Organization.msg12")))}>{i18n("auto.pages.Organization.33")}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setInvite(org.invite!)}>{i18n("auto.pages.Organization.34")}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void makeInvite(org)}>{i18n("auto.pages.Organization.35")}</Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    tone="error"
                    onClick={() => void confirmOk(i18n("auto.pages.Organization.msg13")).then((ok) => {
                      if (!ok) return;
                      void revokeOrgInvite(org.id).then((r) => showToast(r.ok ? (r.reason ?? "邀请口令已删除") : r.reason ?? "删除失败：到设置里检查云盘登录后重试"));
                    })}
                  >
                    {i18n("auto.pages.Organization.36")}</Btn>
                </Inline>
              </div>
            </Card>
          ) : null}
          <Card>
            <Section title={i18n("auto.pages.Organization.37")} hint={i18n("auto.pages.Organization.38")} />
            <IdentityCard card={orgIdentityCard(org)} organization variant="detail" />
          </Card>
          <Card>
            <Section title={i18n("auto.pages.Organization.39")} hint={i18n("auto.pages.Organization.40")} />
            <Btn
              variant="ghost"
              tone="error"
              onClick={() => void confirmOk(`删除组织「${org.name}」？本机记录会删除（云盘资料库与 GitLab 仓库不动）。`).then((ok) => {
                if (!ok) return;
                deleteOrg(org.id);
                openTab("contacts", { section: "orgs" });
              })}
            >
              {i18n("auto.pages.Organization.41")}</Btn>
          </Card>
        </Stack>
      ) : null}

      {tab === "members" ? (
        <Stack gap={4}>
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" onClick={() => void addMember(org)}>{i18n("auto.pages.Organization.25")}</Btn>
            <Btn variant="outline" onClick={() => void makeInvite(org)}>{i18n("auto.pages.Organization.42")}</Btn>
            <Btn
              variant="ghost"
              disabled={!libraries.length}
              onClick={() => { void (async () => { for (const lib of libraries) await shareLibrary(org, lib.repoId, lib.name); })(); }}
            >
              {i18n("auto.pages.Organization.43")}</Btn>
            <Btn variant="outline" disabled={sharing === "sync-all"} onClick={() => void syncAllPermissions(org)}>
              {sharing === "sync-all" ? "同步中…" : "同步云盘与 GitLab 权限"}
            </Btn>
          </Inline>
          <Text slot="micro" tone="faint">{i18n("auto.pages.Organization.44")}</Text>
          <List divided>
            {org.members.map((m) => (
              <Row
                key={m.id}
                title={m.name}
                sub={m.email || "还没绑定邮箱 · 点「编辑」补上"}
                trailing={
                  <div className="name-card-actions">
                    <Select aria-label={`${m.name}的角色`} value={m.role} onChange={(v) => { if (!setOrgMemberRole(org.id, m.id, v as OrgRole)) showToast(i18n("auto.pages.Organization.msg14")); }}>
                      <option value="owner">{ROLE_LABEL.owner}</option>
                      <option value="member">{ROLE_LABEL.member}</option>
                      <option value="guest">{ROLE_LABEL.guest}</option>
                    </Select>
                    <Btn size="sm" variant="ghost" onClick={() => void editMember(org, m.id)}>{i18n("auto.pages.Organization.45")}</Btn>
                    <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`移除成员「${m.name}」？`).then((ok) => { if (ok && !removeOrgMember(org.id, m.id)) showToast(i18n("auto.pages.Organization.msg15")); })}>{i18n("auto.pages.Organization.46")}</Btn>
                  </div>
                }
              />
            ))}
          </List>
        </Stack>
      ) : null}

      {tab === "libraries" ? (
        <Stack gap={4}>
          {!seafile.configured ? (
            <Card>
              <Text slot="label">{i18n("auto.pages.Organization.47")}</Text>
              <Text slot="micro" tone="faint">{i18n("auto.pages.Organization.48")}</Text>
              <div className="name-card-actions"><Btn variant="solid" tone="brand" onClick={() => openTab("cloud")}>{i18n("auto.pages.Organization.49")}</Btn></div>
            </Card>
          ) : null}
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={sharing === "create-lib"} onClick={() => void createLibrary(org)}>{i18n("auto.pages.Organization.50")}</Btn>
            <Btn variant="outline" onClick={() => void linkLibrary(org)}>{i18n("auto.pages.Organization.51")}</Btn>
          </Inline>
          {libraries.length === 0 ? (
            <EmptyState
              icon={<IconIn size="lg" />}
              title={i18n("auto.pages.Organization.52")}
              hint={i18n("auto.pages.Organization.53")}
            />
          ) : (
            <Stack gap={3}>
              {libraries.map((lib) => (
                <Card key={lib.repoId}>
                  <Stack gap={2}>
                    <Text slot="title">{lib.name}</Text>
                    <Text slot="micro" tone="faint">
                      {i18n("auto.pages.Organization.54")}{lib.sharedWith?.length ? lib.sharedWith.join("、") : "还没有共享给成员"}
                    </Text>
                    <div className="name-card-actions">
                      <Btn size="sm" variant="outline" onClick={() => openTab("cloud", { cloudRepo: lib.repoId })}>{i18n("auto.pages.Organization.55")}</Btn>
                      <Btn size="sm" variant="outline" disabled={sharing === lib.repoId} onClick={() => void shareLibrary(org, lib.repoId, lib.name)}>{i18n("auto.pages.Organization.56")}</Btn>
                      <Btn size="sm" variant="ghost" disabled={sharing === lib.repoId} onClick={() => void copyLibraryLink(lib.repoId, lib.name)}>{i18n("auto.pages.Organization.57")}</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setOpenLib(openLib === lib.repoId ? null : lib.repoId)}>{openLib === lib.repoId ? "收起文件" : "预览文件"}</Btn>
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`解除资料库「${lib.name}」与组织的关联？云盘里的资料库不会被删除。`).then((ok) => { if (ok) { removeOrgLibrary(org.id, lib.repoId); showToast(i18n("auto.pages.Organization.msg16")); } })}>{i18n("auto.pages.Organization.58")}</Btn>
                    </div>
                    {openLib === lib.repoId ? <LibraryFiles repoId={lib.repoId} name={lib.name} /> : null}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}

      {tab === "gitlab" ? (
        <Stack gap={4}>
          {org.gitlabGroup ? (
            <Card>
              <Stack gap={2}>
                <Text slot="title">{i18n("auto.pages.Organization.59")}{org.gitlabGroup.name}</Text>
                <Text slot="micro" tone="faint">{org.gitlabGroup.path} {i18n("auto.pages.Organization.60")}</Text>
                <div className="name-card-actions">
                  <Btn size="sm" variant="outline" onClick={() => void openExternal(org.gitlabGroup!.webUrl)}>{i18n("auto.pages.Organization.61")}</Btn>
                  <Btn size="sm" variant="ghost" disabled={sharing === "sync-all"} onClick={() => void syncAllPermissions(org)}>{i18n("auto.pages.Organization.62")}</Btn>
                </div>
              </Stack>
            </Card>
          ) : (
            <Text slot="micro" tone="faint">{i18n("auto.pages.Organization.63")}</Text>
          )}
          <Inline gap={2} wrap>
            <Btn variant="solid" tone="brand" disabled={sharing === "gitlab"} onClick={() => void createGitlab(org)}>{org.gitlabGroup ? "在组织下新建仓库" : "建 GitLab 组织与仓库"}</Btn>
            <Btn variant="outline" disabled={sharing === "gitlab"} onClick={() => void linkGitlab(org)}>{i18n("auto.pages.Organization.64")}</Btn>
            <Btn variant="ghost" onClick={() => openTab("gitlab")}>{i18n("auto.pages.Organization.65")}</Btn>
          </Inline>
          {gitlabRepos.length === 0 ? (
            <EmptyState
              icon={<IconIn size="lg" />}
              title={i18n("auto.pages.Organization.66")}
              hint={i18n("auto.pages.Organization.67")}
            />
          ) : (
            <Stack gap={3}>
              {gitlabRepos.map((repo) => (
                <Card key={repo.id}>
                  <Stack gap={2}>
                    <Text slot="title">{repo.name}</Text>
                    <Text slot="micro" tone="faint">{repo.path}</Text>
                    <div className="name-card-actions">
                      <Btn size="sm" variant="outline" onClick={() => openTab("gitlab", { gitlabProject: repo.id }, { title: `${org.name} · ${repo.name}` })}>{i18n("auto.pages.Organization.68")}</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setOpenRepo(openRepo === repo.id ? null : repo.id)}>{openRepo === repo.id ? "收起详情" : "预览项目"}</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => void openExternal(repo.webUrl ?? `https://git.tsinghua.edu.cn/${repo.path}`)}>{i18n("auto.pages.Organization.69")}</Btn>
                      <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`解除仓库「${repo.name}」与组织的关联？GitLab 上的仓库不会被删除。`).then((ok) => { if (ok) { unlinkOrgGitlab(org.id, repo.id); showToast(i18n("auto.pages.Organization.msg17")); } })}>{i18n("auto.pages.Organization.58")}</Btn>
                    </div>
                    {openRepo === repo.id ? <RepoPreview projectId={repo.id} /> : null}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      ) : null}

      {tab === "projects" ? (
        <Stack gap={3}>
          <div><Btn variant="solid" tone="brand" onClick={() => void editProject(org)}>{i18n("auto.pages.Organization.70")}</Btn></div>
          {projects.length === 0 ? <Text tone="faint">{i18n("auto.pages.Organization.71")}</Text> : null}
          {projects.map((p) => (
            <Card key={p.id}>
              <Stack gap={2}>
                <Text slot="title">{p.name}</Text>
                <Text>{p.description || "暂无说明"}</Text>
                <Text slot="micro">{i18n("auto.pages.Organization.72")}{p.owner || "待分配"}</Text>
                <div className="name-card-actions">
                  <Select aria-label={`${p.name}的进度`} value={p.status} onChange={(v) => saveOrgProject(org.id, { ...p, status: v as OrgProject["status"] })}>
                    <option value="planned">{i18n("auto.pages.Organization.73")}</option>
                    <option value="active">{i18n("auto.pages.Organization.74")}</option>
                    <option value="done">{i18n("auto.pages.Organization.75")}</option>
                  </Select>
                  <Btn size="sm" variant="ghost" onClick={() => void editProject(org, p)}>{i18n("auto.pages.Organization.45")}</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`删除项目「${p.name}」？`).then((ok) => { if (ok) deleteOrgProject(org.id, p.id); })}>{i18n("auto.pages.Organization.76")}</Btn>
                </div>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}

      {tab === "notices" ? (
        <Stack gap={3}>
          <div><Btn variant="solid" tone="brand" onClick={() => void editNotice(org)}>{i18n("auto.pages.Organization.77")}</Btn></div>
          {noticeList.length === 0 ? <Text tone="faint">{i18n("auto.pages.Organization.78")}</Text> : null}
          {noticeList.map((n) => (
            <Card key={n.id}>
              <Stack gap={2}>
                <Text slot="title">{n.pinned ? "置顶 · " : ""}{n.title}</Text>
                <div className="org-notice-body">{n.body}</div>
                <div className="name-card-actions">
                  <Btn size="sm" variant="ghost" onClick={() => saveOrgAnnouncement(org.id, { ...n, pinned: !n.pinned })}>{n.pinned ? "取消置顶" : "置顶"}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void editNotice(org, n)}>{i18n("auto.pages.Organization.45")}</Btn>
                  <Btn size="sm" variant="ghost" tone="error" onClick={() => void confirmOk(`删除公告「${n.title}」？`).then((ok) => { if (ok) deleteOrgAnnouncement(org.id, n.id); })}>{i18n("auto.pages.Organization.76")}</Btn>
                </div>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}

      <Modal open={Boolean(invite)} onClose={() => setInvite(null)} title={i18n("auto.pages.Organization.79")} size="sm">
        {invite ? (
          <Stack gap={3}>
            <Text slot="micro" tone="faint">
              {invite.label ? `「${invite.label}」　` : ""}{i18n("auto.pages.Organization.31")}{invite.allowEmail ?? "任何人（拿到口令就能接受）"}　{i18n("auto.pages.Organization.32")}{expireText(org.invite?.expiresAt)}
            </Text>
            <code className="vault-share-code">{invite.code}</code>
            <div className="vault-qr"><QRCodeSVG value={invite.code} size={180} /></div>
            <Inline gap={2} wrap>
              <Btn size="sm" variant="solid" tone="brand" onClick={() => void navigator.clipboard.writeText(invite.code).then(() => showToast(i18n("auto.pages.Organization.msg18"))).catch(() => showToast(i18n("auto.pages.Organization.msg19")))}>{i18n("auto.pages.Organization.33")}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setInvite(null)}>{i18n("auto.pages.Organization.80")}</Btn>
            </Inline>
          </Stack>
        ) : null}
      </Modal>
    </div>
  );
}
