/**
 * OneTHU 产品宣传片 · 自动化演示流程（Demo Flow）
 *
 * 设计原则（用户口径）：
 *  1) 呼吸感节奏：转场/新页之后停 1.5–2.0s 静止聚焦；动作之间 220–420ms 抖动延迟，
 *     避免机械秒点（参数集中在 PACE，改一处即可整体调快调慢）。
 *  2) 聚焦爽点：不从注册/授权/设置切入，直接从「今日概览 → OH 一句话直达 → 作业/成绩/校园卡」
 *     这些一眼能看出价值与动效的场景开始。
 *  3) 顺畅轨迹：滚动用多段小步 + 末段减速，避免骤停骤起，录屏帧率更稳。
 *  4) 纯净画面：prep 统一环境（勿扰、亮度、常亮、方向锁、状态栏演示模式、冷启动回首页），
 *     cleanup 复位；录制用 scrcpy（见 docs/demo-video/README.md）。
 *
 * 驱动方式：WebView DevTools 协议（./cdp.mjs）——本应用 WebView 不向 uiautomator 暴露可访问性
 * 节点，而 CDP 能读真实 DOM 文字与坐标，换设备/换字号都不用改脚本。
 *
 * 用法：
 *   node tools/demo-flow/flow.mjs --list        # 列出分镜
 *   node tools/demo-flow/flow.mjs --prep        # 环境准备（录制前）
 *   node tools/demo-flow/flow.mjs --scene=3     # 只跑第 3 个分镜（补录）
 *   node tools/demo-flow/flow.mjs --all         # 全流程
 *   node tools/demo-flow/flow.mjs --cleanup     # 环境复位
 *   --end-home：跑完回桌面（默认不回；录制收尾或分镜 7 需要时才用）
 * 开关：--pkg=app.onethu.demo（默认）、--fast（节奏 ×0.6，预览用）
 */
import { adb, connectCdp, FIND_JS, human } from "./cdp.mjs";
import { appendFileSync } from "node:fs";

const PKG = process.argv.find((a) => a.startsWith("--pkg="))?.split("=")[1] ?? "app.onethu.demo";
const SPEED = process.argv.includes("--fast") ? 0.6 : 1;

/** 节奏参数：宣传片的「呼吸」都在这里 */
const PACE = {
  holdAfterNav: [1500, 2000],
  betweenActions: [220, 420],
  typeDelay: 55,
  scrollSteps: 6,
  scrollMs: 520,
};

const BEATS = process.env.DEMO_BEATS ?? "/tmp/onethu-demo-beats.jsonl";
function beat(scene, action, extra = {}) {
  const row = { t: Date.now(), scene, action, ...extra };
  try { appendFileSync(BEATS, JSON.stringify(row) + "\n"); } catch { /* 记录失败不影响演示 */ }
  console.log(`  · [${scene}] ${action}${extra.text ? ` 「${extra.text}」` : ""}`);
}

const pause = (range) => human(Math.round((range[0] + Math.random() * (range[1] - range[0])) * SPEED));
const holdNav = () => pause(PACE.holdAfterNav);
const beatPause = () => pause(PACE.betweenActions);

class Demo {
  constructor(cdp) { this.cdp = cdp; this.scene = "prep"; }

  async find(text) {
    const hits = await this.cdp.evaluate(FIND_JS(text));
    if (!hits?.length) throw new Error(`找不到元素：「${text}」`);
    return hits[0];
  }

  async tap(text, { optional = false } = {}) {
    let hit;
    try { hit = await this.find(text); } catch (e) {
      if (optional) { beat(this.scene, "跳过（未找到）", { text }); return false; }
      throw e;
    }
    const { x, y } = hit;
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await human(80);
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await human(70);
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    beat(this.scene, "点击", { text, x, y });
    await beatPause();
    return true;
  }

  async type(text, { into = null } = {}) {
    if (into) await this.tap(into);
    await this.cdp.evaluate(`(() => {
      const el = document.activeElement;
      if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
      return true;
    })()`);
    for (const ch of text) {
      await this.cdp.send("Input.insertText", { text: ch });
      await human(PACE.typeDelay);
    }
    beat(this.scene, "输入", { text });
    await beatPause();
  }

  async enter() {
    const k = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
    beat(this.scene, "回车提交");
    await beatPause();
  }

  async scroll(dir = "down", { px = 520 } = {}) {
    const sign = dir === "down" ? -1 : 1;
    let left = px;
    for (let i = 0; i < PACE.scrollSteps; i++) {
      const ratio = 1 - (i / PACE.scrollSteps) * 0.55;
      const step = Math.max(24, Math.round((left / (PACE.scrollSteps - i)) * ratio));
      left -= step;
      await this.cdp.evaluate(`window.scrollBy({ top: ${sign * step}, behavior: 'auto' })`);
      await human(Math.round(PACE.scrollMs / PACE.scrollSteps));
    }
    beat(this.scene, dir === "down" ? "向下滑动" : "向上滑动", { px });
    await beatPause();
  }

  /** 打开导航抽屉并点某一项（手机布局导航在抽屉里；锚点为实测 aria-label） */
  async goto(label) {
    await this.tap("打开导航菜单", { optional: true });
    await this.focus(900);                      // 抽屉展开动效留给观众
    const ok = await this.tap(label, { optional: true });
    await this.focus(1600);                     // 新页静止聚焦
    return ok;
  }

  async back() {
    const ok = await this.tap("返回", { optional: true });
    if (!ok) { adb(["shell", "input", "keyevent", "4"]); beat(this.scene, "系统返回键"); }
    await holdNav();
  }

  async focus(ms) { await (ms ? human(Math.round(ms * SPEED)) : holdNav()); beat(this.scene, "静止聚焦"); }
}

/* 分镜表：每条都是「观众能看到什么」的承诺 */
const SCENES = [
  { id: 1, title: "开场：今日概览（一眼看清今天）", value: "课表、未交作业、近三日截止同屏，滚动有呼吸感",
    async run(d) {
      await d.focus(1800);
      await d.scroll("down", { px: 380 });
      await d.focus(1700);
      await d.scroll("up", { px: 380 });
      await d.focus(1400);
    } },
  { id: 2, title: "爽点：OH 一句话直达", value: "自然语言 → 结构化结果卡片，秒级生成",
    async run(d) {
      await d.tap("对话");
      await d.focus(1600);
      await d.type("明天图书馆哪有空座？", { into: "问点什么" });
      await d.enter();
      await d.focus(2600);
      await d.scroll("down", { px: 320 });
      await d.focus(1800);
      await d.tap("关闭", { optional: true });
      await d.focus(1200);
    } },
  { id: 3, title: "作业：一屏管全部（网络学堂 / 雨课堂 / OJ）", value: "多源合并、状态分组、行内忽略与提醒",
    async run(d) {
      await d.tap("未交作业", { optional: true });   // 首页统计 stat-link → 全部作业
      await d.focus(1900);
      await d.scroll("down", { px: 560 });
      await d.focus(1700);
      await d.scroll("up", { px: 560 });
      await d.focus(1300);
      await d.back();
    } },
  { id: 4, title: "信息页：成绩与考试", value: "图表与统计，展示信息聚合 + 可视化",
    async run(d) {
      await d.goto("信息");
      await d.tap("成绩", { optional: true });
      await d.focus(2000);
      await d.scroll("down", { px: 480 });
      await d.focus(1700);
      await d.back();
    } },
  { id: 5, title: "生活页：校园卡余额与流水", value: "余额、近 30 天消费、逐笔流水（与桌面小组件同源）",
    async run(d) {
      await d.goto("生活");
      await d.tap("校园卡", { optional: true });
      await d.focus(2100);
      await d.scroll("down", { px: 520 });
      await d.focus(1800);
      await d.back();
    } },
  { id: 6, title: "寻迹：今日日程在地图上串起来", value: "带地点的日程 + 地图，回答「去哪、多久」",
    async run(d) {
      await d.goto("寻迹");
      await d.focus(1200);
      await d.scroll("down", { px: 420 });
      await d.focus(1600);
      await d.back();
    } },
  { id: 7, title: "收尾：桌面小组件（应用之外也在工作）", value: "回桌面展示今日日程与校园卡小组件",
    async run(d) {
      adb(["shell", "input", "keyevent", "3"]);
      await d.focus(2600);
      await d.focus(1600);
    } },
];

async function prep() {
  console.log("· 环境准备（录制前）");
  const sh = (cmd) => { try { adb(["shell", ...cmd]); } catch { /* ROM 不支持则跳过 */ } };
  sh(["settings", "put", "global", "sysui_demo_allowed", "1"]);
  for (const [k, v] of [["time", "0941"], ["battery", "100"], ["battery_charging", "true"], ["network", "wifi"], ["wifi", "show"], ["mobile", "hide"], ["notifications", "hide"]]) {
    sh(["am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "enter", "-e", k, v]);
  }
  sh(["settings", "put", "global", "zen_mode", "1"]);
  sh(["settings", "put", "system", "screen_brightness_mode", "0"]);
  sh(["settings", "put", "system", "screen_brightness", "180"]);
  sh(["settings", "put", "system", "accelerometer_rotation", "0"]);
  sh(["settings", "put", "system", "user_rotation", "0"]);
  sh(["svc", "power", "stayon", "true"]);
  sh(["am", "force-stop", PKG]);
  await human(700);
  sh(["monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]);
  await human(4200);
  console.log("  完成：确认画面无无关通知/悬浮窗（个别 ROM 需手动关）");
}

async function cleanup() {
  console.log("· 环境复位");
  const sh = (cmd) => { try { adb(["shell", ...cmd]); } catch { /* ignore */ } };
  sh(["am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "exit"]);
  sh(["settings", "put", "global", "sysui_demo_allowed", "0"]);
  sh(["settings", "put", "global", "zen_mode", "0"]);
  sh(["settings", "put", "system", "accelerometer_rotation", "1"]);
  sh(["svc", "power", "stayon", "false"]);
  console.log("  完成");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const s of SCENES) console.log(`${String(s.id).padStart(2)}. ${s.title}\n    看点：${s.value}`);
    return;
  }
  if (args.includes("--prep")) return prep();
  if (args.includes("--cleanup")) return cleanup();

  const only = args.find((a) => a.startsWith("--scene="))?.split("=")[1];
  const list = only ? SCENES.filter((s) => String(s.id) === only) : SCENES;
  if (only && list.length === 0) throw new Error(`没有第 ${only} 个分镜`);

  const cdp = await connectCdp(PKG);
  const d = new Demo(cdp);
  console.log(`· 已连接 ${PKG}（pid ${cdp.pid}）；节拍表：${BEATS}`);
  try {
    for (const s of list) {
      d.scene = `scene${s.id}`;
      console.log(`\n▶ 分镜 ${s.id}：${s.title}`);
      beat(d.scene, "分镜开始", { title: s.title });
      await s.run(d);
      beat(d.scene, "分镜结束");
    }
  } finally {
    // 默认**不动设备**：跑完停在当前页面。要回桌面请显式加 --end-home（录制收尾用）。
    // （此前默认按 HOME，正在看手机的人会觉得「应用被划走了」——不该是默认行为。）
    if (args.includes("--end-home")) adb(["shell", "input", "keyevent", "3"]);
    cdp.close();
  }
  console.log("\n✓ 演示流程执行完毕。剪辑节拍表见上面那个 jsonl（含每次动作时间戳）。");
}

main().catch((e) => { console.error("✗ Demo Flow 失败：", e.message); process.exit(1); });
