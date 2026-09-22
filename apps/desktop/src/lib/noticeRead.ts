/**
 * 通知「已读」本地覆盖（R23，霖实测：点开过的通知有时仍是未读）。
 *
 * 背景：网络学堂的已读状态只有服务端字段 `sfyd`（拉列表时读一次），而客户端
 * **从不主动置读**——`beforeViewXs` 详情页此前只在「有附件」时才被请求，于是：
 *  · 无附件的通知：永远置不了读；
 *  · 有附件的通知：置读发生在服务端，要等下一次拉列表才反映到 UI（所以「有时」还是未读）。
 *
 * 修法两层：① 打开详情即写本地覆盖（立即反映到列表/未读分组，跨会话保留）；
 * ② 打开详情总是请求 `beforeViewXs`（服务端侧置读 + 兜底发现附件）。
 * 本地覆盖与服务端 `sfyd` 取并集：服务端已读不会被本地状态回退。
 */
import { useSyncExternalStore } from "react";

const KEY = "onethu.learn.noticeRead.v1";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

let read = load();
const listeners = new Set<() => void>();
let version = 0;

/** 通知稳定键（courseId + id；同一 id 在不同课程下可能重复） */
export function noticeReadKey(courseId: string, id: string): string {
  return `${courseId}::${id}`;
}

export function isNoticeReadLocally(courseId: string, id: string): boolean {
  return read.has(noticeReadKey(courseId, id));
}

/** 打开通知即置读（幂等；写盘失败不影响本次会话） */
export function markNoticeReadLocally(courseId: string, id: string): void {
  const k = noticeReadKey(courseId, id);
  if (!courseId || !id || read.has(k)) return;
  read.add(k);
  version += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify([...read]));
  } catch {
    /* 存储不可用：仅本次会话生效 */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 订阅本地已读集合的变化（列表据此立刻把该条移出「未读」） */
export function useNoticeReadVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** 合并服务端与本地：服务端已读优先，本地覆盖只做「置读」不做「置未读」 */
export function noticeHasRead(serverHasRead: boolean | undefined, courseId: string, id: string): boolean {
  return serverHasRead === true || isNoticeReadLocally(courseId, id);
}
