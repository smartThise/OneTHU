/**
 * 校园卡数据新鲜度护栏（R21c 用户实录）。
 *
 * 现象：部分用户流水滞后 1–6 天，「清除数据重新登录会好」——即旧缓存一直压着：
 *   ① 卡页没有手动刷新入口、不显示数据时间；
 *   ② 静默刷新失败时刻意不报错（SWR 语义），于是旧数据无限展示且无从察觉；
 *   ③ 真 bug：流水抓取失败会返回空数组并落盘，把此前的真实流水覆盖成「没有流水」。
 *
 * [1] 取数层：暴露数据时间与刷新失败；过期过久强制非静默；失败不覆盖流水
 * [2] 卡页：常驻刷新按钮 + 「更新于 …」 + 旧数据显式提示与「重新拉取」
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ---------- [1] 取数层（state/data.ts useCard） ---------- */
const data = read("apps/desktop/src/state/data.ts");
const start = data.indexOf("export function useCard(");
const card = data.slice(start, data.indexOf("/* ============ 今日预约", start));
assert.ok(card.length > 500, "useCard 片段定位失败");
assert.ok(/const CARD_HARD_STALE = 6 \* 60 \* 60 \* 1000;/.test(data), "必须有旧缓存硬上限常量");
assert.ok(/const \[updatedAt, setUpdatedAt\] = useState<number \| null>/.test(card), "必须暴露数据时间");
assert.ok(/const \[refreshError, setRefreshError\] = useState<string \| null>/.test(card), "必须暴露刷新失败");
assert.ok(/return \{ data, state, error, reload, updatedAt, refreshError \};/.test(card), "必须把两者返回给 UI");
// 流水失败不得当空列表覆盖缓存
assert.ok(/return null; \/\/ null = 这次流水没拿到/.test(card), "流水失败必须返回 null（不是 []）");
assert.ok(/const mergedTx = transactions \?\? prev\?\.transactions \?\? \[\];/.test(card), "失败时保留旧流水");
assert.ok(/cacheSet\(cardKey, \{ info: cardInfo, transactions: mergedTx \}\);/.test(card), "落盘写合并后的流水");
// 过期过久必须非静默（失败要露脸）
assert.ok(/else if \(Date\.now\(\) - cached\.at > CARD_HARD_STALE\) void load\(false\);/.test(card),
  "超过硬上限必须走非静默加载（否则旧缓存继续压着）");

/* ---------- [2] 卡页 UI ---------- */
const tab = read("apps/desktop/src/pages/info/CardTab.tsx");
assert.ok(/const \{ data, state, error, reload, updatedAt, refreshError \} = useCard\(30\);/.test(tab),
  "卡页必须消费新字段");
assert.ok(/disabled=\{state === "loading"\}/.test(tab) && /刷新中…/.test(tab),
  "必须有常驻刷新按钮（含加载态文案）");
assert.ok(/更新于 \{fmtAgo\(updatedAt\)\}/.test(tab), "必须显示数据时间");
assert.ok(/刷新失败，当前显示/.test(tab) && /重新拉取/.test(tab), "旧数据必须有显式提示与重试入口");
assert.ok(/function fmtAgo\(/.test(tab) && /const isStale = /.test(tab), "相对时间与过期判定助手要在位");

console.log("card-freshness-test: 全部断言通过（数据时间 + 手动刷新 + 失败可见 + 不覆盖流水 + 硬过期非静默）");
