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
const washer = readFileSync("apps/desktop/src/pages/info/WasherTab.tsx", "utf8");
const pref = readFileSync("apps/desktop/src/state/washerPref.ts", "utf8");

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
assert.ok(!/setWasherChoice/.test(skipBlock), "跳过此步不该把没确认的楼栋写进去");
assert.ok(
  /className="btn btn-primary"[\s\S]{0,220}if \(step === 2\) \{/.test(v2) && /setWasherChoice\(\{/.test(v2),
  "「下一步」才写入楼栋",
);

// ②b 楼栋这一问必须"有人用"：下拉选择 + 与洗衣机页共用同一份记忆
assert.ok(/<SearchSelect/.test(v2), "楼栋要用下拉（可搜索），不是自由填写");

// ②c 下拉必须挂到 body 上：首启卡片自己会滚（overflow），面板留在原地就会被裁掉
//     ——霖实测"下拉被局限在卡片里，啥都看不到"
const ss = readFileSync("apps/desktop/src/components/SearchSelect.tsx", "utf8");
assert.ok(/createPortal\(menu, document\.body\)/.test(ss), "下拉面板要 portal 到 body，否则会被祖先 overflow 裁掉");
assert.ok(
  /position: "fixed"/.test(ss) && /getBoundingClientRect\(\)/.test(ss),
  "面板要按触发按钮的 rect 做 fixed 定位（不能靠 absolute 跟着流）",
);
assert.ok(/box\.up/.test(ss), "下面放不下时要能向上翻，否则贴着屏幕底部的下拉看不见");
assert.ok(/zIndex: PANEL_Z \+ 1/.test(ss), "面板层级要在应用内弹层之上（导览是 2000）");
assert.ok(
  !/<input[\s\S]{0,200}(楼|公寓)/.test(v2),
  "楼栋这一问不该出现自由填写输入框——选一个不存在的楼栋，洗衣机页认不出来",
);
assert.ok(/setWasherChoice/.test(v2), "首启选完要写进洗衣机页读的那份记忆");
assert.ok(
  /getWasherChoice/.test(washer) && /setWasherChoice/.test(washer) && /washerPref\.js/.test(washer),
  "洗衣机页必须读（进来自动落回）也写（手动改也记住）这份记忆，否则首启那一问等于白问",
);
assert.ok(
  /const KEY = "onethu\.life\.washerBuilding"/.test(pref),
  "楼栋记忆的键只能有一处定义（两边各写一份就又会分叉）",
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
