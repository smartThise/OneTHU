/**
 * 宽屏详情槽位缓存 + 滚轮归一化护栏。
 * 主人明确要求：「加载过的详情缓起来，5min 一刷新足够；作业被提交了立刻刷新」。
 * 提交后的立即刷新由详情组件内部 invalidateLearnCache + 自身状态负责（不可单测），
 * 这里钉住另外四条可测口径：
 *   [1] 新作业追加槽位，同一作业不重复占位
 *   [2] 再次激活：TTL 内只刷新时间戳（复用挂载=不重拉）；超 TTL 换 nonce（重建=重拉一次）
 *   [3] 槽位上限（默认 8）：超出丢最旧，避免长会话挂一堆详情
 *   [4] 滚轮归一化：像素/行/页三种 deltaMode 折算成同一口径，且过阈值才翻一项
 */
import assert from "node:assert/strict";
import {
  activateSlot,
  DETAIL_SLOTS_MAX,
  DETAIL_TTL_MS,
  normalizeWheelDelta,
  takeWheelStep,
} from "../apps/desktop/src/lib/detailSlots.ts";

const hw = (id) => ({ id });
const T0 = 1000000;

/* [1] 追加 + 去重 */
let list = activateSlot([], hw("a"), T0);
assert.deepEqual(list.map((s) => [s.h.id, s.nonce]), [["a", 0]]);
list = activateSlot(list, hw("a"), T0 + 1000);
assert.equal(list.length, 1, "同一作业不得重复占位");
assert.equal(list[0].at, T0 + 1000, "再次激活应刷新时间戳");
assert.equal(list[0].nonce, 0, "TTL 内不得重建");

/* [2] TTL 到期才重建 */
list = activateSlot(list, hw("a"), T0 + 1000 + DETAIL_TTL_MS + 1);
assert.equal(list[0].nonce, 1, "超过 TTL 应重建（重拉一次）");
list = activateSlot(list, hw("a"), T0 + 1000 + DETAIL_TTL_MS + 2);
assert.equal(list[0].nonce, 1, "刚重建过不应连续重建");

/* [3] 上限丢最旧 */
let many = [];
for (let i = 0; i < DETAIL_SLOTS_MAX + 3; i++) many = activateSlot(many, hw("h" + i), T0 + i);
assert.equal(many.length, DETAIL_SLOTS_MAX, "槽位数应封顶");
assert.equal(many[0].h.id, "h3", "应丢最旧的槽位");
assert.equal(many[many.length - 1].h.id, "h" + (DETAIL_SLOTS_MAX + 2));

/* [4] 滚轮归一化 + 阈值 */
assert.equal(normalizeWheelDelta(100, 0, 170), 100);
assert.equal(normalizeWheelDelta(3, 1, 170), 48);
assert.equal(normalizeWheelDelta(1, 2, 170), 170);
assert.deepEqual(takeWheelStep(0, 20), { acc: 20, dir: 0 }, "未过阈值不翻页");
assert.deepEqual(takeWheelStep(0, 100), { acc: 0, dir: 1 });
assert.deepEqual(takeWheelStep(0, -100), { acc: 0, dir: -1 });
assert.deepEqual(takeWheelStep(20, 10), { acc: 0, dir: 1 }, "触控板细碎 delta 应累积到阈值再翻");
assert.deepEqual(takeWheelStep(-20, -10), { acc: 0, dir: -1 });

console.log(
  "详情槽位缓存：TTL/上限/滚轮归一化 全部通过 ✓（上限 " +
    DETAIL_SLOTS_MAX +
    "，TTL " +
    DETAIL_TTL_MS / 60000 +
    " 分钟）",
);
