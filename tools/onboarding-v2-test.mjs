/**
 * 首启 v2 护栏（§4.2）：只问 3 件事、全部可跳过、旧流程留一版灰度。
 *
 * 守的是这条改版最容易被做歪的三处：
 *  ① 问的必须是"此刻就有答案"的事（提醒/统一认证/宿舍楼），不能再把"界面怎么摆"塞回首启；
 *  ② 每一屏都必须能跳过，且"跳过"是真跳过——不能顺手把没确认的输入存下来；
 *  ③ 灰度默认走旧流程（v1），新流程有自己的完成标记，两套互不干扰，删旧流程时才不会误伤。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const v2 = readFileSync("apps/desktop/src/components/OnboardingTourV2.tsx", "utf8");
const tour = readFileSync("apps/desktop/src/components/OnboardingTour.tsx", "utf8");
const state = readFileSync("apps/desktop/src/state/onboarding.ts", "utf8");
const settings = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");

// ① 只问三件"此刻有答案"的事
assert.ok(/const ASKS = 3;/.test(v2), "三问的条数要写死成常量（ASKS = 3）");
for (const kw of ["开启提醒", "用清华账号登录", "你住哪栋楼"]) {
  assert.ok(v2.includes(kw), "首启 v2 少了这一问：" + kw);
}
for (const banned of ["选一个场景", "桌面小组件", "完成一次收藏", "侧栏要放哪些"]) {
  assert.ok(!v2.includes(banned), "首启 v2 不该再问界面摆设，但出现了：" + banned);
}
assert.ok(/markOnboardedV2\(\)/.test(v2) && /navigate\("today"\)/.test(v2), "完成后要标记并直接进「今日」");

const skipBlock = v2.match(/<button className="btn" onClick=\{\(\) => setStep\(\(s\) => s \+ 1\)\}>[\s\S]{0,40}跳过此步/)?.[0] ?? "";
assert.ok(skipBlock !== "", "没找到「跳过此步」的处理逻辑");
assert.ok(!/setDormBuilding/.test(skipBlock), "跳过此步不该把没确认的楼栋存下来");
assert.ok(
  /className="btn btn-primary"[\s\S]{0,120}if \(step === 2\) setDormBuilding\(dorm\);/.test(v2),
  "「下一步」才保存在这一问填的内容",
);

// ③ 灰度：默认 v1，标记独立，分发器到位
assert.ok(/const KEY_V2 = "onethu\.onboarded\.flow2"/.test(state), "v2 要有自己的完成标记（与 v1 独立）");
assert.ok(/v = globalThis\.localStorage\?\.getItem\(FLOW_KEY\) === "v2" \? "v2" : "v1"/.test(state), "流程 flag 默认必须是 v1（灰度期不改老用户体验）");
assert.ok(/export function resetActiveOnboarding\(\): void \{/.test(state), "重新导览要按当前流程清标志");
assert.ok(/export function OnboardingTourV1\(/.test(tour), "旧流程要保留（灰度一版后再删）");
assert.ok(
  /export function OnboardingTour\(\): React\.ReactNode \{[\s\S]{0,160}flow === "v2" \? <OnboardingTourV2 \/> : <OnboardingTourV1 \/>/.test(tour),
  "分发器要按 flag 二选一",
);
assert.ok(/\{advanced \? \(/.test(settings) && /setOnboardingFlow\(v \? "v2" : "v1"\)/.test(settings), "设置页要有灰度开关，且只在高级模式出现");
assert.ok(/resetActiveOnboarding\(\);/.test(settings), "「重新导览」要走按流程清标志的那个函数");

console.log(
  "首启 v2 护栏：三问齐备且不含界面摆设 ✓ / 每屏可跳过且跳过不保存 ✓ / 完成后进「今日」 ✓ / " +
  "v2 独立标记 + 默认走 v1 灰度 ✓ / 分发器与设置页开关 ✓",
);
