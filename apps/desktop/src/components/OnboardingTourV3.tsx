import { Btn, Chip, IconBtn, Inline, Modal, Progress, Spacer, Stack, Surface, Text } from "@onethu/gui";
/**
 * 桌面端首启导览 v3（2026-10-13）：以桌面现状（dev-explorer 外壳）为基线的全新导览。
 *
 * 旧体系（OnboardingTour.tsx「逐项问界面 + 账号接入」与 OnboardingTourV2.tsx 三问灰度）
 * 已随本次改版删除，播放统一走本组件；偏好沿用 state/onboarding.ts：
 *  - 完成标记 onethu.onboarded.flow3（看完 / 跳过 /「不再显示」都落这里）；
 *  - 流程字段 onethu.onboarding.flow 新默认值 "v3"（旧存档兼容策略见该文件注释）。
 *
 * 七步：欢迎 → 标签页与工作区 → 首页白板 → 横竖栏与抽屉 → OnePage → 插件市场与搜索
 * → OH 自我进化（压轴：粒子舞台，见 OnboardingTourParticles.tsx）。
 * 文案纪律：禁词不碰、每条说明 ≤42 字；克制、准确，不口语不说明书腔。
 * 视觉纪律：讲解框收编 OneGUI（2026-10-14）——卡片 = OG Modal 面板（浮层面阶、
 * head/body/foot 解剖与退场相位全归库),文案件走 Text 字阶、步点走 Progress、
 * 词云走 Chip；专属档位统一在 OnboardingTourScope.ts 以 defineScope 登记。
 *
 * 第二步的「真实拖拽演练」：卡片让位成一枚胶囊锚在底栏上方，交互全透传，
 * 用户自己把一张标签拖到另一张上（约 0.6s 出灰框、松手合并），点胶囊回来继续。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hasOnboardedV3, markOnboardedV3 } from "../state/onboarding.js";
import { askNotifyPermissionOnce } from "../state/notifyPermissionAsk.js";
import { IconX } from "./Icons.js";
import { TourParticles } from "./OnboardingTourParticles.js";
import { TOUR_CARD_SCOPE, defineOnboardingScopes } from "./OnboardingTourScope.js";
import { t as i18n } from "../i18n/index.js";


defineOnboardingScopes();

const STEPS = 7;
/** 每步一屏的结构化文案（bullets 全部 ≤42 字，直指真实可点的 UI） */
interface Doc {
  title: string;
  lead: string;
  bullets: string[];
  foot?: string;
}

/** bullet 行：圆点几何走唯一允许的纯几何内联，颜色引用 OG 语义令牌（tour scope 已锁档） */
export function TourBullet({ children }: { children: ReactNode }): ReactNode {
  return (
    <Inline gap={2} vAlign="baseline">
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: 4,
          height: 4,
          borderRadius: "var(--og-radius-full)",
          background: "var(--og-content-3)",
        }}
      />
      <Text as="span">{children}</Text>
    </Inline>
  );
}

const DOCS_BASE: Doc[] = [
  {
    title: "欢迎使用 OneTHU",
    lead: "清华园随身工具箱。",
    bullets: [
      "七步一分钟，看完桌面端的主干。",
      "每步都可跳过；想重温，设置页右上角有「导览」。",
      "右上角 × 只关闭这一次，下次启动还会出现。",
    ],
  },
  {
    title: "标签页与工作区",
    lead: "页面都住在标签页里；拖一拖，就长成工作区。",
    bullets: [
      "顶部一排是标签页；换到竖版时在左侧栏。",
      "右键标签可复制、关闭，或一星收进 OnePage。",
      "把一张标签拖到另一张上，停 0.6 秒出灰框，松手合并。",
      "工作区底板就在标签栏上：右键可解散（标签保留）或删除。",
      "底栏「标签页」「OneGO!」抽屉里同样能看到工作区面板。",
    ],
  },
  {
    title: "首页是一张自由白板",
    lead: "大时间与一级功能区是骨架；其余组件随你摆。",
    bullets: [
      "骨架不动：右键大时间或功能区可调透明度（四档）。",
      "组件按住即拖，四角把手缩放，组件之间可以叠盖。",
      "选中即浮出小工具条：置顶、透明度四档、删除。",
      "右键空白（落点跟指针）或右侧 ＋：添加组件。",
      "双击空白就地建便笺；画笔恒在最高层，可撤销清空。",
    ],
    foot: "全是常态手势，没有要进出的「编辑模式」。",
  },
  {
    title: "横竖两副骨架",
    lead: "标签栏横竖随时切，窄一点也站得住。",
    bullets: [
      "横版：标签在顶部一排；竖版：标签在左侧一列。",
      "底栏「标签页」抽屉里有横版／竖版切换。",
      "设置里可定默认样式；竖栏底部按钮可切「窄」。",
      "窄栏悬停在栏上即展开，移开即收。",
      "底栏常驻：左「标签页」，中「搜索或问小OH」，右「OneGO!」。",
    ],
  },
  {
    title: "OnePage：你的一页",
    lead: "自带一块可以自由摆组件的白板页。",
    bullets: [
      "底栏「OneGO!」→ 我的 OnePage：起名后点「新建」。",
      "新建即得白板页，与首页同一套手势，摆什么都行。",
      "标签页右键「一星」：把内容收成一块 OnePage。",
      "OneGO! 里还有 OneFlow：在 OH 对话里说「创建一个流程」。",
    ],
    foot: "命令面板（Ctrl+K）里也能直达你的白板。",
  },
  {
    title: "装插件、找一切",
    lead: "两条路就够：去搜索，去市场。",
    bullets: [
      "设置 → 插件：「我的插件 / 插件市场」两个视图随时切。",
      "「安装插件」支持仓库直装与市场一键安装。",
      "底部中央胶囊「搜索或问小OH」：点开打字即搜。",
      "任何页面按 Ctrl+K：输入即搜，回车直达。",
    ],
    foot: "检索同源：面板搜得到的，页面里也搜得到。",
  },
];

/** 第七步独立成 JSX：粒子舞台 + 词云席位 + 能力清单 */
const CHIPS = ["工具", "流程", "组件", "主题", "小组件", "插件"] as const;

function OhEvolutionStep(): ReactNode {
  return (
    <>
      <TourParticles />
      <Inline gap={2} wrap>
        {CHIPS.map((c) => (
          <Chip key={c}>{c}</Chip>
        ))}
      </Inline>
      <Stack gap={1}>
        <TourBullet>{i18n("auto.components.OnboardingTourV3.1")}</TourBullet>
        <TourBullet>{i18n("auto.components.OnboardingTourV3.2")}</TourBullet>
        <TourBullet>{i18n("auto.components.OnboardingTourV3.3")}</TourBullet>
      </Stack>
    </>
  );
}

/** 第七步压轴：标题句直给能力本身，词云席位对应上一段画布散开的六个词 */
const DOCS: Doc[] = [
  ...DOCS_BASE,
  {
    title: "OH：说一句，长一样本领",
    lead: "在对话里说，它就动手。",
    bullets: [],
    foot: "工具箱自己会长：说到哪，就长到哪。",
  },
];

export function OnboardingTourV3(): ReactNode {
  const [open, setOpen] = useState<boolean>(() => !hasOnboardedV3());
  const [step, setStep] = useState(0);
  const [practice, setPractice] = useState(false);
  /** 通知权限的一次性申请：只在导览关掉之后问，避免两层弹窗（沿用 v1/v2 的接线口径） */
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

  /* Esc：演练中回到导览；否则关闭本次（不写偏好，下次启动还会出现）
     —— OG Modal 自带浮层栈的 Esc 出口，与这里专职监听并存（栈顶优先语义一致） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (practice) setPractice(false);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, practice]);

  const closeForever = (): void => {
    markOnboardedV3();
    setOpen(false);
  };

  if (practice) {
    /* 演练 HUD：胶囊 = OG 浮层 Surface（pos 定位交给外层纯几何壳——底栏高是应用侧变量，
       fixed 参数与居中属于 C2 几何，不属于外观）；胶囊材质完全由 overlay 面阶提供 */
    return (
      <div
        role="dialog"
        aria-label={i18n("auto.components.OnboardingTourV3.4")}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "calc(var(--explorer-bar-h, 48px) + var(--og-space-4))",
          width: "max-content",
          marginInline: "auto",
        }}
      >
        <Surface overlay radius="2xl" scope={TOUR_CARD_SCOPE} pad="sm">
          <Inline gap={3} vAlign="center">
            <Text as="span">{i18n("auto.components.OnboardingTourV3.5")}</Text>
            <Btn variant="solid" tone="brand" onClick={() => setPractice(false)}>{i18n("auto.components.OnboardingTourV3.6")}</Btn>
          </Inline>
        </Surface>
      </div>
    );
  }

  const isLast = step === STEPS - 1;
  /* 步索引恒在 0..6（STEPS 定长 + 上/下一步钳位），这里兜底取首步纯为收敛类型 */
  const doc = DOCS[step] ?? DOCS[0]!;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      maskClose={false}
      closeButton={false}
      size="md"
      aria-label={i18n("auto.components.OnboardingTourV3.7")}
      scope={TOUR_CARD_SCOPE}
      foot={
        <Inline gap={2} vAlign="center" wrap>
          <Btn variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>{i18n("auto.components.OnboardingTourV3.8")}</Btn>
          <Spacer />
          <Btn variant="ghost" titleAttr={i18n("auto.components.OnboardingTourV3.9")} onClick={closeForever}>
            {i18n("auto.components.OnboardingTourV3.10")}</Btn>
          {isLast ? (
            <Btn variant="solid" tone="brand" onClick={closeForever}>{i18n("auto.components.OnboardingTourV3.11")}</Btn>
          ) : (
            <Btn variant="solid" tone="brand" onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}>{i18n("auto.components.OnboardingTourV3.12")}</Btn>
          )}
        </Inline>
      }
    >
      <Stack gap={2}>
        {/* 头：步进度 + 关闭本次（不写偏好）——浮动卡骨架的 body 顶部与旧版同位 */}
        <Inline gap={2} vAlign="center">
          <div aria-label={"第 " + (step + 1) + " 步，共 " + STEPS + " 步"}>
            <Progress value={(step + 1) / STEPS} size="sm" />
          </div>
          <Spacer />
          <IconBtn label={i18n("auto.components.OnboardingTourV3.13")} icon={<IconX width={14} height={14} />} onClick={() => setOpen(false)} />
        </Inline>

        <Text slot="title" as="h3">{doc.title}</Text>
        <Text as="p">{doc.lead}</Text>
        <Stack gap={1}>
          {doc.bullets.map((b) => (
            <TourBullet key={b}>{b}</TourBullet>
          ))}
        </Stack>

        {/* ⑦ 压轴：粒子舞台 + 能力清单 */}
        {isLast ? <OhEvolutionStep /> : null}
        {/* ② 真实拖拽演练：进演练模式，卡片让位，交互透传 */}
        {step === 1 ? (
          <Inline gap={3} vAlign="center" wrap>
            <Btn variant="solid" tone="brand" onClick={() => setPractice(true)}>{i18n("auto.components.OnboardingTourV3.14")}</Btn>
            <Text slot="label" tone="faint">{i18n("auto.components.OnboardingTourV3.15")}</Text>
          </Inline>
        ) : null}

        {doc.foot ? <Text slot="label" tone="faint" as="p">{doc.foot}</Text> : null}
      </Stack>
    </Modal>
  );
}
