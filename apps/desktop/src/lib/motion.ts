import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 动效工具（local/anim-delight）：把"什么时候该动、什么时候不该动"的判断收在一处。
 * 三条规则：系统要求减弱动态 → 一律不动；手机上不开重效果；动画只做一次不循环。
 */

/** 系统级「减弱动态效果」（iOS/安卓/Windows 都有这个开关，必须尊重） */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 页面转场**不用** View Transitions API。
 *
 * 实测（霖 2026-09-22）：整页 tab 切换走快照交叉淡入时，旧页快照会在新页**下层**
 * 以半透明残留（两张整页截图叠加），观感是"旧页面在下面闪一下"——每次切换都闪。
 * 快照转场适合"列表卡 → 详情页"这类有共享元素的场景，不适合整页替换。
 * 因此转场统一走 .page-anim 的 CSS 进场（新页淡入上浮，旧页直接卸载，无叠加）。
 */

/**
 * 导航方向（CSS 转场用）：进二级页=前进，从二级页回顶层=后退。
 * 只在渲染期比较"上一页 vs 当前页"，比较是幂等的（StrictMode 双渲染下结果一致）。
 */
export function useNavDirection(page: string, isSubPage: (p: string) => boolean): "forward" | "back" {
  const prevRef = useRef(page);
  const dirRef = useRef<"forward" | "back">("forward");
  if (prevRef.current !== page) {
    dirRef.current = !isSubPage(page) && isSubPage(prevRef.current) ? "back" : "forward";
    prevRef.current = page;
  }
  return dirRef.current;
}

/**
 * 页签切换方向：按页签在顺序表中的位置比较"上一项 vs 当前项"，决定内容从哪一侧滑入。
 * 只在渲染期比较，幂等（StrictMode 双渲染下结果一致）。
 */
export function useTabDirection(activeId: string | null, order: readonly string[]): "next" | "prev" {
  const prevRef = useRef<string | null>(activeId);
  const dirRef = useRef<"next" | "prev">("next");
  if (prevRef.current !== activeId) {
    const from = prevRef.current === null ? -1 : order.indexOf(prevRef.current);
    const to = activeId === null ? -1 : order.indexOf(activeId);
    dirRef.current = from >= 0 && to >= 0 && to < from ? "prev" : "next";
    prevRef.current = activeId;
  }
  return dirRef.current;
}

/**
 * 退场相位：active 变 false 后仍保持挂载 ms 毫秒，并返回 closing=true。
 * 纯 CSS 做不到"先播完退场再卸载"，弹层/遮罩/抽屉的关闭都需要这一层状态机。
 */
export function useExitPhase(active: boolean, ms = 200): { mounted: boolean; closing: boolean } {
  const [state, setState] = useState<"in" | "out" | "gone">(active ? "in" : "gone");
  const wasActive = useRef(active);
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      setState("in");
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    setState("out");
    const t = window.setTimeout(() => setState("gone"), ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
  return { mounted: state !== "gone", closing: state === "out" };
}

/**
 * 滚动揭示：列表项进入视口时侧向滑入（长列表滚动时"新出现的项"不再突变）。
 *
 * 与挂载逐项进场的关系：命中本选择器的元素在 CSS 里被置为 animation: none + opacity: 0，
 * 改由观察器在进入视口时打 data-reveal-in 标记播 m-reveal-in（同批按 30ms 递延）。两者不能同时作用于
 * 同一元素——挂载动画结束回落到基态 opacity: 0 会让元素消失。关闭 JS / 减弱动态时不加
 * has-reveal，元素保持可见。
 *
 * 可重播：离开视口就撤掉标记（回到藏身态）且不注销观察，所以每次进入视野都会播一次，
 * 往上滚回去与往下滚新出现的行为一致。
 */
export const REVEAL_SELECTOR =
  ":is(.list, .stats, .today-grid, .market-grid, .icon-grid, .setting-group, .app-grid, .thos-grid) > *, .row-click, .mail-row, .news-row, .setting-row, .cloud-row";

export function installScrollReveal(): void {
  if (typeof document === "undefined" || typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;
  if (prefersReducedMotion()) return;
  document.documentElement.classList.add("has-reveal");

  const io = new IntersectionObserver(
    (entries) => {
      let i = 0;
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (!e.isIntersecting) {
          // 离开视口就回到藏身态、且不注销观察：之后不管从哪个方向再进视野都会重播
          // （2026-09-23 霖需求：不是只有往下滚新出现的才有，往上滚回去的也要有）
          delete el.dataset.revealIn;
          continue;
        }
        // 同一批（同时进入视口的一屏）按序递延，避免整屏同时亮起。
        // 不封顶：封顶会让排在后面的卡片拿到同一延迟，第一波播完齐刷刷一起出现（霖实测）。
        // 方阵网格（app/thos）间隔收得更短——霖反馈出现要再快一些。
        const step = el.closest(".app-grid, .thos-grid") ? 16 : 30;
        el.style.animationDelay = `${i++ * step}ms`;
        // ⚠️ 用 data 属性、不用 class：React 重渲染会整体重写 className（行选中高亮等），
        // classList 手加的类会被抹掉，元素当场回到藏身态隐身（霖实测：点中的邮件行直接消失）
        el.dataset.revealIn = "1";
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0 },
  );

  const scan = () => {
    document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((el) => {
      if (el.dataset.reveal === "1") return;
      el.dataset.reveal = "1";
      io.observe(el);
    });
  };
  scan();

  // 动态内容（翻页 / 筛选 / 新数据）也要纳入；100ms 防抖，避免频繁重排时反复全量查询
  let timer = 0;
  new MutationObserver(() => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      scan();
    }, 100);
  }).observe(document.body, { childList: true, subtree: true });
}

/**
 * 数字滚动：值变化时从旧值平滑滚到新值（统计卡用）。
 * 减弱动态时直接返回目标值——不做"为了而动的"动画。
 */
export function useCountUp(value: number, dur = 680): number {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (prefersReducedMotion() || value === fromRef.current) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const from = fromRef.current;
    const delta = value - from;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      // easeOutCubic：起步快、收尾稳，比线性"贵"
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + delta * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, dur]);
  return shown;
}

/**
 * 分段条滑动块（.seg-pill）：把"当前项"从按钮自带底色换成会滑动的块，
 * 切换页签时块从旧位置滑到新位置（`--dur-3` + `--ease-ios`）。
 *
 * 用法：`const [rowRef, pillRef] = useSegPill();`，rowRef 挂到 .segmented 容器，
 * pillRef 挂到容器内第一个 `<span className="seg-pill" />`。
 *
 * 两条纪律：
 *  - 测量放在 layout 相位（首帧 paint 之前就位），不会出现"从 0 位置滑进来"；
 *  - `.is-ready` 只在量到有效宽度后才加——测量失败时按钮保留自带底色，
 *    不会退化成"没有块也没有底色"。CSS 侧用 `:has(.seg-pill.is-ready)` 对齐这条。
 */
export function useSegPill() {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);

  const place = useCallback(() => {
    const el = rowRef.current;
    const pill = pillRef.current;
    if (!el || !pill) return;
    const active = el.querySelector<HTMLElement>("button.is-active");
    const box = active?.getBoundingClientRect();
    if (!active || !box || box.width <= 0) {
      if (pill.classList.contains("is-ready")) pill.classList.remove("is-ready");
      return;
    }
    // 块是容器的绝对定位子元素：left:0 落在 padding 边，故减掉 clientLeft、加上 scrollLeft
    const base = el.getBoundingClientRect();
    pill.style.width = `${box.width}px`;
    pill.style.transform = `translateX(${box.left - base.left - el.clientLeft + el.scrollLeft}px)`;
    if (!pill.classList.contains("is-ready")) pill.classList.add("is-ready");
  }, []);

  // 每次渲染后重测：active 切换、页签文案变化都会改变块的位置与宽度
  useLayoutEffect(() => {
    place();
  });

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    // 字体后加载会改变按钮宽度（容器尺寸不变），补测一次
    void document.fonts?.ready.then(() => place()).catch(() => {});
    return () => ro.disconnect();
  }, [place]);

  return [rowRef, pillRef] as const;
}

/**
 * 退场相位 + 内容保持：给「父组件条件渲染」的弹层 / Sheet 用（插件设置、写信…）。
 * active 变 false 后组件多挂 ms 毫秒播完退场；held 是最后一次非空值，退场期间照常渲染，
 * 否则会闪成空壳。CSS 侧配合 .is-closing 规则。
 */
export function useExitHold<T>(value: T | null, ms = 220): { mounted: boolean; closing: boolean; held: T | null } {
  const { mounted, closing } = useExitPhase(value !== null, ms);
  const heldRef = useRef<T | null>(null);
  useEffect(() => {
    if (value !== null) heldRef.current = value;
  }, [value]);
  return { mounted, closing, held: value ?? heldRef.current };
}

/**
 * 侧栏 / 抽屉当前项指示条（.nav-indicator）：一条会"拉伸平移"的强调条。
 *
 * 切换时先把条撑到覆盖旧→新两项，再收拢到新项——Office 功能区切换那种手感，
 * 但幅度刻意收着：全程一段 320ms 动画，条本身始终 3px 宽。只动 transform
 * （translateY + scaleY，center 原点），不碰布局属性。
 * 用 Web Animations API 而不是两段 transition：两段拼接各自从 0 起速，接缝处
 * 会「突然减慢/突然加快」（霖实测）；一段动画一条速度曲线，过渡自然。
 *
 * 测量与 useSegPill 同款：绝对定位子元素挂在滚动容器（.nav）里、算内容坐标，
 * 容器滚动时条随内容走。嵌套的 .nav-folders-scroll 也要监听 scroll——激活的收藏夹
 * 落在里面时，内层滚动会改变它的视口位置。
 */
export function useNavIndicator() {
  const rowRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);
  const prevRef = useRef<{ a: number; b: number } | null>(null); // 上一项的 [top, bottom]，内容坐标 px

  const place = useCallback(() => {
    const el = rowRef.current;
    const bar = barRef.current;
    if (!el || !bar) return;
    const active = el.querySelector<HTMLElement>(".nav-item.is-active");
    if (!active || active.offsetHeight <= 0) {
      bar.classList.remove("is-ready");
      prevRef.current = null;
      return;
    }
    const base = el.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    const top = box.top - base.top - el.clientTop + el.scrollTop;
    const bottom = top + box.height;
    const prev = prevRef.current;
    prevRef.current = { a: top, b: bottom };
    if (!bar.classList.contains("is-ready")) bar.classList.add("is-ready");

    // 条最终高度固定 16px、在行内垂直居中（与旧版 ::before 一致；抽屉 40px 行也居中，
    // 不随行高撑满——撑满会显得整根条往下坠）
    const BAR = 16;
    const setFinal = (): void => {
      bar.style.transform = `translateY(${(top + bottom) / 2 - BAR / 2}px) scaleY(1)`;
    };
    // 首次（或减弱动态）：直接到位，不玩拉伸
    if (!prev || prefersReducedMotion()) {
      setFinal();
      return;
    }
    // 位置没变（普通重渲染 / 容器宽度变化）：不重播动画
    if (Math.abs(prev.a - top) < 0.5 && Math.abs(prev.b - bottom) < 0.5) return;

    /* 端点速度连续（霖反馈：人眼追的是运动方向那个端点，不是条的中心）。
       ⚠️ 起止姿态都是「静息条」：16px、在行内居中——不是整行框。此前用整行框当
       起点，每次切换条都先突变成一行长再动、到地方再突变缩回（霖实测）。
       前端点（下移=下端，上移=上端）全程走一条 smoothstep 曲线连续起停，
       尾端点延迟 30% 再同样跟上：条自然先拉长再收回，没有拼接突变。
       拉伸上限 3 个行高；时长按移动距离算（140–300ms），近处快、远处稳。 */
    const c0 = (prev.a + prev.b) / 2;
    const c1 = (top + bottom) / 2;
    const down = c1 >= c0;
    const dur = Math.min(300, Math.max(140, Math.round(Math.abs(c1 - c0) * 1.2)));
    const MAX = Math.max(bottom - top, 2) * 3;
    const sstep = (u: number) => u * u * (3 - 2 * u); // smoothstep：两端速度为 0，连续
    const N = 16;
    const e0t = c0 - BAR / 2, e0b = c0 + BAR / 2; // 旧静息条的两端
    const e1t = c1 - BAR / 2, e1b = c1 + BAR / 2; // 新静息条的两端
    const frames: Keyframe[] = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const lead = sstep(t); // 前端点：全程一条曲线
      const trail = t <= 0.3 ? 0 : sstep((t - 0.3) / 0.7); // 尾端点：延迟 30% 再跟上
      let ta = down ? e0t + (e1t - e0t) * trail : e0t + (e1t - e0t) * lead;
      let tb = down ? e0b + (e1b - e0b) * lead : e0b + (e1b - e0b) * trail;
      if (tb - ta > MAX) {
        const c = (ta + tb) / 2;
        ta = c - MAX / 2;
        tb = c + MAX / 2;
      }
      frames.push({
        transform: `translateY(${(ta + tb) / 2 - BAR / 2}px) scaleY(${Math.max(tb - ta, 2) / BAR})`,
        offset: t,
        easing: "linear",
      });
    }
    setFinal(); // 终态先落定（动画结束后即停在这里），动画期间由关键帧接管
    bar.animate(frames, { duration: dur });
  }, []);

  useLayoutEffect(() => {
    place();
  });

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    const onScroll = () => place();
    el.addEventListener("scroll", onScroll, { passive: true });
    // 内层限高滚动段（收藏夹）：激活项在里面时它自己的滚动也要重新对位
    const inners = el.querySelectorAll<HTMLElement>(".nav-folders-scroll");
    inners.forEach((n) => n.addEventListener("scroll", onScroll, { passive: true }));
    void document.fonts?.ready.then(() => place()).catch(() => {});
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      inners.forEach((n) => n.removeEventListener("scroll", onScroll));
    };
  }, [place]);

  return [rowRef, barRef] as const;
}
