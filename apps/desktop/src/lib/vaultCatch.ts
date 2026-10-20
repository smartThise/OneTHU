/**
 * `data-vault-catch` 的统一构造器（暂存箱长按拖入）。
 *
 * 页面只负责描述「这是什么、点开落在哪」，打开方式统一在 state/vaultRegistry.ts 里实现。
 */
import type { VaultCatch } from "../state/vault.js";
import { t as i18n } from "../i18n/index.js";


/** 把 VaultCatch 序列化成 data-vault-catch 属性值 */
export function vaultCatchAttr(cat: VaultCatch): string {
  return JSON.stringify(cat);
}

/** 日程/时间块：点开时可选择加入「我的日程」 */
export function vaultCatchSchedule(it: { title: string; kind: string; date?: string; location?: string; note?: string; startMs?: number; endMs?: number }): string {
  return vaultCatchAttr({
    type: "payload",
    title: it.title,
    sub: [it.kind, it.date, it.location].filter(Boolean).join(" · "),
    payload: { kind: "schedule", date: it.date, note: it.note, startMs: it.startMs, endMs: it.endMs },
    source: "日程",
  });
}

/** 云盘：文件拖入 = 自动下载并缓存到暂存箱云盘；文件夹只保留引用。 */
export function vaultCatchCloudFile(f: { name: string; kind: "file" | "dir"; repoId: string; repoName?: string; path: string; size?: number }): string {
  if (f.kind === "file") {
    return vaultCatchAttr({
      type: "file",
      title: f.name,
      sub: [f.repoName, f.size ? `${f.size} B` : "云盘文件"].filter(Boolean).join(" · "),
      file: { name: f.name, size: f.size },
      remote: { kind: "seafile", repoId: f.repoId, path: f.path, size: f.size },
      source: "云盘",
    });
  }
  return vaultCatchAttr({
    type: "payload",
    title: f.name,
    sub: ["云盘文件夹", f.repoName].filter(Boolean).join(" · "),
    payload: { kind: "cloud-folder", repoId: f.repoId, path: f.path },
    source: "云盘",
  });
}

/** GitLab 项目：点开落 project */
export function vaultCatchGitlabProject(p: { id: number; name: string; path?: string }): string {
  return vaultCatchAttr({
    type: "payload",
    title: p.name.replace(/^.*\//, ""),
    sub: p.path ? `GitLab · ${p.path}` : "GitLab 项目",
    payload: { kind: "gitlab-project", projectId: p.id },
    source: "GitLab",
  });
}

/** 标签页：点开回到该页 */
export function vaultCatchTab(t: { title: string; page: string; params?: Record<string, unknown> | null }): string {
  return vaultCatchAttr({
    type: "payload",
    title: t.title,
    sub: i18n("auto.lib.vaultCatch.p1"),
    payload: { kind: "tab", page: t.page, params: t.params ?? null },
    source: "标签页",
  });
}

/** 工作区：点开恢复工作区 */
export function vaultCatchWorkspace(w: { id: string; name: string; count: number }): string {
  return vaultCatchAttr({
    type: "payload",
    title: w.name,
    sub: `工作区 · ${w.count} 个标签`,
    payload: { kind: "workspace", workspaceId: w.id },
    source: "工作区",
  });
}

/** 网络学堂通知 / 作业附件、新闻附件：拖入 = 自动下载并缓存到暂存箱云盘 */
export function vaultCatchAttachment(a: { kind: "learn" | "news"; name: string; url?: string; label?: string }): string {
  return vaultCatchAttr({
    type: "file",
    title: a.name,
    sub: a.label ? `附件 · ${a.label}` : "附件",
    file: { name: a.name },
    ...(a.url ? { remote: { kind: a.kind, url: a.url } } : {}),
    source: a.kind === "news" ? "新闻" : "课程",
  });
}

/** 课程通知：点开落通知详情 */
export function vaultCatchLearnNotice(n: { courseId?: string; itemId: string; title: string }): string {
  return vaultCatchAttr({
    type: "payload",
    title: n.title,
    sub: i18n("auto.lib.vaultCatch.p2"),
    payload: { kind: "learn-notice", courseId: n.courseId, itemId: n.itemId },
    source: "课程",
  });
}
