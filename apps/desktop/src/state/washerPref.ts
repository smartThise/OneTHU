/**
 * 洗衣机楼栋记忆（2026-09-28，霖反馈后补）：首启问过、页面记住，下次进来直接落在你住的那栋。
 *
 * 为什么单独成模块：写入方有两个（首启导览、洗衣机页手动选），读取方是洗衣机页。
 * 两边必须同一份键——否则又会变成"问了没人用"：用户在首启选了楼栋，进洗衣机页却还是空的。
 *
 * 楼栋在不同供应商下会重名，所以记 (供应商, id) 两个字段，名称只作兜底匹配。
 */
export interface WasherChoice {
  /** 供应商代码（washerProviderCode 的产物） */
  provider: string;
  id: string;
  name: string;
}

const KEY = "onethu.life.washerBuilding";

export function getWasherChoice(): WasherChoice | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<WasherChoice>;
    if (typeof o?.id !== "string" || o.id === "") return null;
    return { provider: typeof o.provider === "string" ? o.provider : "", id: o.id, name: typeof o.name === "string" ? o.name : "" };
  } catch {
    return null; // 存坏了就当没记过，不影响页面可用
  }
}

export function setWasherChoice(c: WasherChoice): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
