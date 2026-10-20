import { Btn, IconBtn, Inline, Progress, Sheet, Spacer, Stack, Text } from "@onethu/gui";
/**
 * 首启导览 · 手机简版（dev-explorer 二轮 A8，2026-10-13）：
 * 桌面 v3 七步在手机太大——手机只讲五件「当下就要会」的事：
 *   ① 标签页抽屉（手机横竖都没有标签条：换标签只走底栏「标签页」抽屉）
 *   ② 添加组件（首页右下「编」→「＋」）
 *   ③ OnePage 与 OneGO!（一本白板 + 工作区面板的常驻入口）
 *   ④ 搜索胶囊（底部长出半屏抽屉、可拉满；也搜得到插件）
 *   ⑤ OH 自我进化一句话（压轴：复用桌面 V3 的粒子舞台）
 *
 * 样式收编 OneGUI（2026-10-14）：卡片 = OG Sheet（手机贴底 + 抓手 + 安全区，
 * 桌面退化居中），骨架同桌面 V3；bullet 行复用 V3 导出的 TourBullet，
 * 专属档位统一在 OnboardingTourScope.ts 以 defineScope 登记。
 *
 * 偏好自持：与桌面 v3（flow3）分键——手机档落 `onethu.onboarded.phone`（同一偏好家族，
 * 模块内读写，不新增状态机）；「不再显示」与看完压轴都落盘并入设置页「导览」重走口径。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { askNotifyPermissionOnce } from "../state/notifyPermissionAsk.js";
import { isPhoneNow, useIsPhone } from "../state/phoneSheets.js";
import { IconX } from "./Icons.js";
import { TourParticles } from "./OnboardingTourParticles.js";
import { TOUR_CARD_SCOPE, defineOnboardingScopes } from "./OnboardingTourScope.js";
import { OnboardingTourV3, TourBullet } from "./OnboardingTourV3.js";
import { t as i18n } from "../i18n/index.js";


defineOnboardingScopes();

const KEY_PHONE = "onethu.onboarded.phone";

export function hasOnboardedPhone(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY_PHONE) === "1";
  } catch {
    return true; /* 存不下时别反复弹 */
  }
}

export function markOnboardedPhone(): void {
  try {
    globalThis.localStorage?.setItem(KEY_PHONE, "1");
  } catch {
    /* ignore */
  }
}

export function resetOnboardingPhone(): void {
  try {
    globalThis.localStorage?.removeItem(KEY_PHONE);
  } catch {
    /* ignore */
  }
}

/* ─── 骨架与桌面 V3 同构：步点走 Progress、文案走 Text 字阶（见其 TourBullet 导出） ─── */
const STEPS = 5;

interface Doc {
  title: string;
  lead: string;
  bullets: string[];
  foot?: string;
}

const DOCS: Doc[] = [
  {
    title: "标签页抽屉",
    lead: "底栏「标签页」一按，全在抽屉里。",
    bullets: [
      "手机横竖都没有标签条：换标签、开新页都走这个抽屉。",
      "按住一个标签拖一拖，就换了顺序。",
      "拖到另一个标签上停一停（0.6 秒灰框），松手合并成工作区。",
      "按住 0.5 秒不动出菜单：聚焦、复制、关闭、解散工作区。",
    ],
    foot: "抽屉可从半屏拉到全屏；顶栏那颗圆形房子钮随时回首页。",
  },
  {
    title: "添加组件：白板随你摆",
    lead: "首页右下角开始。",
    bullets: [
      "点「编」进编辑，再点「＋」选组件放到白板上。",
      "组件长按出菜单，可调尺寸、固定与删除。",
    ],
    foot: "「添加组件」抽屉从底部长出来，也不挡白板。",
  },
  {
    title: "OnePage：你的一页",
    lead: "OneGO! 里管它们。",
    bullets: [
      "底栏右侧「OneGO!」→ 我的 OnePage：起名后「新建」。",
      "新建即得一块白板，跟首页同一套手势。",
      "抽屉里还有工作区面板，手机同样能解散与建组。",
    ],
  },
  {
    title: "搜索胶囊",
    lead: "底栏中央那颗胶囊，不只是输入框。",
    bullets: [
      "点一下：从底部长出半屏搜索窗，可拉满全屏。",
      "能搜页面、面板与插件；结果直接点开。",
      "长按 0.45 秒开始说话；松手直发，上划取消。",
    ],
    foot: "OH 的对话窗也长在同一个胶囊上。",
  },
  {
    title: "OH：说一句，长一样本领",
    lead: "在对话里说，它就动手。",
    bullets: [],
    foot: "工具箱自己会长：说到哪，就长到哪。",
  },
];

export function OnboardingTourMobile(): ReactNode {
  /* 手机专列：非手机一律不渲染（App 的挂载点负责在两端分流，见同文件 OnboardingTourGate） */
  const phone = useIsPhone();
  const [open, setOpen] = useState<boolean>(() => isPhoneNow() && !hasOnboardedPhone());
  const [step, setStep] = useState(0);
  /** 通知权限的一次性申请：导观关掉之后问（与桌面 V3 相同的接线口径） */
  const shown = useRef(false);

  useEffect(() => {
    if (open) {
      shown.current = true;
      return;
    }
    if (!shown.current) return;
    const t = window.setTimeout(() => {
      void askNotifyPermissionOnce();
    }, 800);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!phone || !open) return null;

  const isLast = step === STEPS - 1;
  const doc = DOCS[step] ?? DOCS[0]!;

  const closeForever = (): void => {
    markOnboardedPhone();
    setOpen(false);
  };

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      maskClose={false}
      closeButton={false}
      aria-label={i18n("auto.components.OnboardingTourMobile.1")}
      scope={TOUR_CARD_SCOPE}
      foot={
        <Inline gap={2} vAlign="center" wrap>
          <Btn variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>{i18n("auto.components.OnboardingTourMobile.2")}</Btn>
          <Spacer />
          <Btn variant="ghost" titleAttr={i18n("auto.components.OnboardingTourMobile.3")} onClick={closeForever}>
            {i18n("auto.components.OnboardingTourMobile.4")}</Btn>
          {isLast ? (
            <Btn variant="solid" tone="brand" onClick={closeForever}>{i18n("auto.components.OnboardingTourMobile.5")}</Btn>
          ) : (
            <Btn variant="solid" tone="brand" onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}>{i18n("auto.components.OnboardingTourMobile.6")}</Btn>
          )}
        </Inline>
      }
    >
      <Stack gap={2}>
        {/* 头：步进度 + 关闭本次（不写偏好） */}
        <Inline gap={2} vAlign="center">
          <div aria-label={"第 " + (step + 1) + " 步，共 " + STEPS + " 步"}>
            <Progress value={(step + 1) / STEPS} size="sm" />
          </div>
          <Spacer />
          <IconBtn label={i18n("auto.components.OnboardingTourMobile.7")} icon={<IconX width={14} height={14} />} onClick={() => setOpen(false)} />
        </Inline>

        {isLast ? <TourParticles /> : null}
        <Text slot="subtitle" as="h3">{doc.title}</Text>
        <Text as="p">{doc.lead}</Text>
        <Stack gap={1}>
          {doc.bullets.map((b) => (
            <TourBullet key={b}>{b}</TourBullet>
          ))}
        </Stack>
        {doc.foot ? <Text slot="label" tone="faint" as="p">{doc.foot}</Text> : null}
      </Stack>
    </Sheet>
  );
}

/** App.tsx 挂载点分流：手机 → 简版五步；桌面 → 桌面 V3 七步 */
export function OnboardingTourGate(): ReactNode {
  const phone = useIsPhone();
  if (phone) return <OnboardingTourMobile />;
  return <OnboardingTourV3 />;
}

