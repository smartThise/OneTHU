import { Btn } from "@onethu/gui";
/**
 * 导览压轴步的「OH 自我进化」粒子舞台：纯 canvas，无 UI 依赖。
 *
 * 一幕三拍（约 11.5s 后重来一轮）：
 *   ① 汇聚——四散的尘粒卷进来，凝成中心一颗亮核；
 *   ② 分裂——亮核炸开，尘埃甩进外圈轨道，六颗带词的小节点散成词云；
 *   ③ 绕转——整体绕核慢转 + 微光闪烁，淡出后回到 ①。
 *
 * 纪律（2026-10-13 导览 v3 定案）：
 *  - 颜色全部来自主题令牌（挂载期读一次 computed style；运行期不查 DOM、不注入颜色、不外链图片）；
 *  - Chromium 96：只用 2D canvas + rAF，无 color-mix、无新 API；
 *  - 60fps：粒子按面积封顶 150 一次性分配；每帧只做位移/透明度，样式切换不超过三次；
 *  - prefers-reduced-motion：组件直接不渲染（导览这一屏只见文案）；
 *  - 导览步卸载即收 rAF；dt 钳位 40ms，页面隐藏恢复时不跳帧。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { t as i18n } from "../i18n/index.js";


type RGB = { r: number; g: number; b: number };

/** 令牌 → 画布色：只认 #hex 与 rgb()/rgba() 两种 computed 输出 */
function parseColor(v: string): RGB | null {
  const s = v.trim().toLowerCase();
  if (s.startsWith("#")) {
    const h = s.length === 4 || s.length === 5 ? s.slice(1).split("").map((c) => c + c).join("") : s.slice(1);
    if (h.length < 6) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const p = (fn[1] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    const r = p[0] ?? NaN;
    const g = p[1] ?? NaN;
    const b = p[2] ?? NaN;
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
  }
  return null;
}

/** 按候选顺序读一枚令牌色（从画布元素起算，可吃到局部重映射） */
function tokenColor(el: HTMLElement | null, names: string[]): RGB | null {
  if (!el) return null;
  const cs = getComputedStyle(el);
  for (const name of names) {
    const hit = parseColor(cs.getPropertyValue(name) ?? "");
    if (hit) return hit;
  }
  return null;
}

/** 分裂后的词云席位：半径/角速/字号按槽位错开，散开又咬合 */
const NODE_SLOT = [
  { label: "工具", rMul: 0.34, w: 0.16, size: 13 },
  { label: "流程", rMul: 0.52, w: 0.1, size: 12 },
  { label: "组件", rMul: 0.66, w: 0.07, size: 12 },
  { label: "主题", rMul: 0.78, w: 0.05, size: 11 },
  { label: "小组件", rMul: 0.88, w: 0.04, size: 11 },
  { label: "插件", rMul: 0.97, w: 0.03, size: 12 },
] as const;

const CONVERGE_MS = 2400;
const HOLD_MS = 620;
const BURST_MS = 820;
const REPLAY_MS = 11500;
const rgb = (c: RGB, a: number): string => "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

interface Dust {
  a0: number; r0: number; a: number; r: number;
  w: number; size: number; alp: number; tw: number;
}
interface NodeSlot { a0: number; w: number; lm: number; size: number }
interface Core {
  phase: "con" | "hold" | "burst" | "orbit";
  t0: number; last: number; spin: number;
  dust: Dust[]; nodes: NodeSlot[] | null;
}

export function TourParticles(): ReactNode {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const [replay, setReplay] = useState(0);

  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 主循环：随 replay 重启；reduced 或令牌异常时不起来（宁可不动也不注入颜色） */
  useEffect(() => {
    if (reduced) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const c0 = tokenColor(cv, ["--md-sys-color-primary", "--accent", "--md-sys-color-on-surface"]);
    if (!c0) return;
    const c1 = tokenColor(cv, ["--md-sys-color-on-surface", "--text-1"]) ?? c0;
    const c2 = tokenColor(cv, ["--md-sys-color-on-surface-variant", "--text-2", "--text-3"]) ?? c1;

    const fit = (): void => {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.round(rect.width * dpr));
      cv.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "600 12px " + getComputedStyle(cv).fontFamily;
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(cv);
    window.addEventListener("resize", fit);

    const rect0 = cv.getBoundingClientRect();
    const rr0 = Math.min(rect0.width, rect0.height) * 0.46;
    const N = Math.min(150, Math.max(90, Math.round((rect0.width * rect0.height) / 2100)));
    const mkDust = (): Dust => {
      const a0 = Math.random() * Math.PI * 2;
      const r0 = rr0 * (0.62 + Math.random() * 0.5);
      return {
        a0, r0, a: a0, r: r0,
        w: (Math.random() * 0.3 + 0.08) * (Math.random() < 0.5 ? -1 : 1),
        size: 1 + Math.random() * 1.8,
        alp: 0.3 + Math.random() * 0.5,
        tw: Math.random() * Math.PI * 2,
      };
    };
    const st: Core = { phase: "con", t0: performance.now(), last: 0, spin: 0, dust: Array.from({ length: N }, mkDust), nodes: null };
    st.last = st.t0;

    const drawBaseCore = (now: number, cx: number, cy: number, rr: number): void => {
      const pulse = 1 + 0.1 * Math.sin(now * 0.012);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 0.2 * pulse);
      g.addColorStop(0, rgb(c0, 0.85));
      g.addColorStop(1, rgb(c0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - rr * 0.21, cy - rr * 0.21, rr * 0.42, rr * 0.42);
    };

    const drawWord = (st: Core, cx: number, cy: number, rr: number, prog: number): void => {
      if (!st.nodes) return;
      const fam = getComputedStyle(cv).fontFamily;
      for (let i = 0; i < st.nodes.length; i++) {
        const n = st.nodes[i]!;
        const slot = NODE_SLOT[i]!;
        const ang = n.a0 - prog * 0.9 - st.spin;
        const rad = rr * slot.rMul * 1.55;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        ctx.fillStyle = rgb(c1, 0.75 * prog);
        ctx.beginPath();
        ctx.arc(x, y, 8 + prog * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(c2, prog);
        ctx.font = "600 " + slot.size + "px " + fam;
        ctx.fillText(slot.label, x + 12, y + 4);
      }
      ctx.font = "600 12px " + fam;
    };

    const frame = (now: number): void => {
      const dt = Math.min(now - st.last, 40);
      st.last = now;
      const el = now - st.t0;
      const rect = cv.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const rr = Math.min(rect.width, rect.height) * 0.46;
      ctx.clearRect(0, 0, rect.width, rect.height);

      if (st.phase === "con") {
        const k = Math.min(el / CONVERGE_MS, 1);
        const e = ease(k);
        st.spin += dt * 0.0004;
        ctx.fillStyle = rgb(c2, 0.9);
        for (const d of st.dust) {
          const swirl = e * (1.6 + d.w) * (d.w > 0 ? 1.3 : -0.7);
          const rad = d.r0 * (1 - e) * (1 - e * 0.15);
          const ang = d.a0 - e * swirl * 2.4;
          d.a = ang;
          d.r = rad;
          const jx = cx + Math.cos(ang) * rad + Math.sin(el * 0.0019 + d.tw) * 2;
          const jy = cy + Math.sin(ang) * rad + Math.cos(el * 0.0023 + d.tw) * 2;
          ctx.globalAlpha = Math.min(0.2 + e * d.alp, d.alp);
          ctx.beginPath();
          ctx.arc(jx, jy, d.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (k >= 1) { st.phase = "hold"; st.t0 = now; }
      } else if (st.phase === "hold") {
        drawBaseCore(now, cx, cy, rr);
        ctx.fillStyle = rgb(c2, 0.4);
        for (const d of st.dust) {
          d.a = d.a0 - st.spin * 2.4;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(d.a) * rr * 0.08, cy + Math.sin(d.a) * rr * 0.08, d.size, 0, Math.PI * 2);
          ctx.fill();
        }
        if (el >= HOLD_MS) {
          st.phase = "burst";
          st.t0 = now;
          for (const d of st.dust) {
            d.r += rr * (0.25 + Math.random() * 0.55);
            d.a += (Math.random() - 0.5) * 1.2;
          }
          st.nodes = NODE_SLOT.map((s, i) => ({ a0: (i * Math.PI * 2) / NODE_SLOT.length + 0.7, w: s.w, lm: s.rMul, size: s.size }));
        }
      } else if (st.phase === "burst") {
        const k = Math.min(el / BURST_MS, 1);
        const e = ease(k);
        ctx.fillStyle = rgb(c2, 0.9);
        for (const d of st.dust) {
          const rad = rr * 0.1 + (d.r - rr * 0.1) * e;
          d.r = rad;
          d.a += d.w * dt * 0.0006;
          ctx.globalAlpha = Math.min(d.alp + 0.3 - e * 0.3, 1);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(d.a) * rad, cy + Math.sin(d.a) * rad, d.size * (1.6 - e * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        drawBaseCore(now, cx, cy, rr);
        drawWord(st, cx, cy, rr, e);
        if (k >= 1) { st.phase = "orbit"; st.t0 = now; }
      } else {
        for (const d of st.dust) {
          d.a += d.w * dt * 0.0004;
          const rad = d.r + Math.sin(now * 0.0006 + d.tw) * rr * 0.02;
          ctx.globalAlpha = d.alp * (0.55 + 0.45 * Math.sin(now * 0.002 + d.tw));
          ctx.beginPath();
          ctx.arc(cx + Math.cos(d.a) * rad, cy + Math.sin(d.a) * rad, d.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        drawBaseCore(now, cx, cy, rr);
        drawWord(st, cx, cy, rr, 1);
        st.spin += dt * 0.00006;
        if (el >= REPLAY_MS) {
          st.phase = "con";
          st.t0 = now;
          st.spin = 0;
          st.nodes = null;
          st.dust = Array.from({ length: N }, mkDust);
        }
      }
      rafRef.current = window.requestAnimationFrame(frame);
    };
    rafRef.current = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", fit);
      if (ro) ro.disconnect();
    };
  }, [reduced, replay]);

  if (reduced) return null;

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%", height: "clamp(150px, 24vh, 208px)", borderRadius: "var(--r-md)" }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        role="img"
        aria-label={i18n("auto.components.OnboardingTourParticles.1")}
      />
      <Btn variant="outline" onClick={() => setReplay((n) => n + 1)}>{i18n("auto.components.OnboardingTourParticles.2")}</Btn>
    </div>
  );
}
