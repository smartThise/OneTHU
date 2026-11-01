import { labelForId } from "../../i18n/staticLabels.js";
import { courseDisplayName, courseSearchNames } from "../../lib/learnLanguage.js";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Tabs, Btn } from "@onethu/gui";
/** 全部作业（learnX Assignments）：按状态分组（进行中/已逾期/已交/已批改），组内按截止时间排序 */
import { useMemo, useState } from "react";
import { parseLearnTime, SOURCE_NAMES } from "@onethu/core";
import { PageAtomStar } from "../..//components/Collect.js";
import { Card, Empty, ErrorNote, ListWindow, PageHead, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { ConnectGate } from "../../components/ConnectGate.js";
import {
  dismissExtHwGuide,
  isExtHwGuideDismissed,
  requestExtHwScroll,
  toHomework,
  useExternalHomework,
} from "../../state/exthw.js";
import { BackButton, HomeworkRow, semesterText } from "./shared.js";
import { useIgnoredHw } from "../../state/hwIgnore.js";
import { useLearnNavSemester } from "./shared.js";

type Filter = "unfinished" | "overdue" | "submitted" | "graded" | "ignored" | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "unfinished", get label() { return i18n("pages.learn.assignmentspage.dc9591e56d50"); } },
  { key: "overdue", get label() { return i18n("pages.learn.assignmentspage.13c68d134847"); } },
  { key: "submitted", get label() { return i18n("pages.learn.assignmentspage.40c77cac9724"); } },
  { key: "graded", get label() { return i18n("pages.learn.assignmentspage.85f50675dc34"); } },
  // R21c：忽略的作业从常规分组移出、单独成组——可在此查看与恢复
  { key: "ignored", get label() { return i18n("pages.learn.assignmentspage.c9bb70bcaaa3"); } },
  { key: "all", get label() { return i18n("pages.learn.assignmentspage.5c55a67935af"); } },
];

/** 逾期未交（12.2）：未提交且截止时间已过。解析统一走 core parseLearnTime（与 shared.tsx
 *  同源；兼容外部源 "YYYY-MM-DD HH:mm" 与 ISO 串）；解析失败不判逾期 → 留在「进行中」，
 *  避免把拿不到 deadline 的条目误分类。 */
function isOverdue(h: { submitted: boolean; deadline: string }): boolean {
  if (h.submitted) return false;
  const d = parseLearnTime(h.deadline);
  return d !== null && d.getTime() < Date.now();
}

/** 外部作业源引导横幅：新用户不知道雨课堂/TUOJ 要单独登录。
 *  仅「尚未配置任何外部源」时显示，配置后自动消失；「知道了」持久忽略（localStorage）。
 *  R11 16.3：主文案改为「接入多平台作业聚合」；主按钮「登录雨课堂」弹登录通道 modal
 *  （微信扫码；R17 23.2 短信通道因图形验证码已停用，UI 参考校园卡充值弹窗）；次按钮「去设置」跳设置页 extHw 区。
 *  R13 18.3：文案改两段式——雨课堂人人可用（主按钮仍登录雨课堂）；OJ 平台按个人情况
 *  在设置页登录，不再把三类平台并列平铺。 */
function ExtHwGuide() {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  const ext = useExternalHomework();
  const [dismissed, setDismissed] = useState(() => isExtHwGuideDismissed());
  const [loginOpen, setLoginOpen] = useState(false);
  // 等凭据解密完成（state=ready）再判断，避免已配置用户瞬时闪一下横幅
  if (ext.state !== "ready" || ext.configured || dismissed) return null;
  return (
    <>
      <div className="browser-hint ext-hw-hint">
        <span className="ext-hw-hint-text">
          <div>{i18n("pages.learn.assignmentspage.1ee8c573d98e")}</div>
          <div style={{ opacity: 0.8, marginTop: 2 }}>{i18n("pages.learn.assignmentspage.6ba20a081728")}</div>
          {/* R11 16.2：TUOJ 自动漫游已过统一认证但未返回课程——条幅提示，不算错误 */}
          {ext.tuojAuto.tuoj.kind === "no-courses" ? (
            <div style={{ opacity: 0.8, marginTop: 2 }}>{i18n("pages.learn.assignmentspage.fcd6b279b349")}</div>
          ) : null}
        </span>
        <Btn variant="solid" tone="brand" onClick={() => setLoginOpen(true)}>{i18n("pages.learn.assignmentspage.da697122c040")}</Btn>
        <Btn variant="outline" onClick={() => {
            requestExtHwScroll();
            navigate("settings");
          }}>{i18n("pages.learn.assignmentspage.93112c231d6a")}</Btn>
        <Btn variant="ghost" onClick={() => {
            dismissExtHwGuide();
            setDismissed(true);
          }}>{i18n("pages.learn.assignmentspage.de32e20193ad")}</Btn>
      </div>
      <ConnectGate need="yuketang" open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

/* R19 27.1：TUOJ 会话失效已静默自动重漫游过、但该源最终仍失败时，作业页明示
 * 「已尝试自动重新登录，仍失败：<原因>」（文案由 core 组装进 errors）并保留手动入口
 * ——「去设置重新登录」跳设置页 extHw 区的「统一认证登录」。不弹窗，仅条幅；
 * 其余源错误仍只在设置页展示（与既有行为一致）。
 * R21-A：Tyche 会话失效静默自动重登（记住密码时）失败也走同一条幅——core 对发起过
 * 自动重登仍失败的源统一加同款前缀，这里把 tyche 并入渲染列表；「去设置」落到
 * Tyche 卡片的手动登录入口。
 * R21-B：雨课堂会话失效（无静默重登路径——短信有图形验证码、扫码需人）并入渲染列表，
 * 并给「扫码重登」一键直达登录弹窗，省一趟设置页。 */
function ExtHwSourceErrorNote() {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  const ext = useExternalHomework();
  const [yktLoginOpen, setYktLoginOpen] = useState(false);
  const [tuojLoginOpen, setTuojLoginOpen] = useState(false);
  const rows = (["tuoj", "tuojClassic", "tyche", "yuketang"] as const)
    .map((id) => ({ id, name: labelForId(SOURCE_NAMES[id]), err: ext.errors[id] }))
    .filter((r) => Boolean(r.err));
  const yktFailed = rows.some((r) => r.id === "yuketang");
  // 等凭据解密完成再判断，避免就绪前闪一下
  if (ext.state !== "ready" || rows.length === 0) return null;
  return (
    <>
      <div className="browser-hint ext-hw-hint">
        <span className="ext-hw-hint-text">
          {rows.map(({ id, name, err }) => (
            <div key={id} style={{ color: "var(--red, #c04848)" }}>
              {name}：{err}
            </div>
          ))}
        </span>
        {yktFailed ? (
          <Btn variant="solid" tone="brand" onClick={() => setYktLoginOpen(true)}>{i18n("pages.learn.assignmentspage.6466fa8f4cad")}</Btn>
        ) : null}
        {rows.some((r) => r.id === "tuoj" || r.id === "tuojClassic") ? (
          <Btn variant="solid" tone="brand" onClick={() => setTuojLoginOpen(true)}>{i18n("pages.learn.assignmentspage.42338b60a3ea")}</Btn>
        ) : null}
        <Btn variant="outline" onClick={() => {
            requestExtHwScroll();
            navigate("settings");
          }}>{i18n("pages.learn.assignmentspage.1dd9120b2b30")}</Btn>
      </div>
      <ConnectGate need="yuketang" open={yktLoginOpen} onClose={() => setYktLoginOpen(false)} />
      <ConnectGate need="tuoj" open={tuojLoginOpen} onClose={() => setTuojLoginOpen(false)} />
    </>
  );
}

export function AssignmentsPage() {
  const uiLocale = useUiLocale();

  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  const { navigate, navParams } = useApp();
  const ext = useExternalHomework();
  const [filter, setFilter] = useState<Filter>("unfinished");

  /** 雨课堂课程筛选（网络学堂页的雨课堂课程卡片点进来）：只看该课堂的作业与试卷。
   *  网络学堂作业没有 classroom 标识，因此筛选后自然只剩该门雨课堂课的内容。 */
  const extCourseId = navParams?.extCourseId;
  const extCourseName = navParams?.extCourseName;

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c])),
    [uiLocale, data],
  );

  /** 外部作业（雨课堂/TUOJ/Tyche）归一化；未配置凭据时恒为空数组（零回归） */
  const extHw = useMemo(() => ext.items.map(toHomework), [uiLocale, ext.items]);
  // R21c：忽略状态（订阅同一份快照：行内忽略/恢复立刻反映到分组与计数）
  const ignored = useIgnoredHw();

  /** 本页可见的全集（网络学堂 + 外部源），已应用雨课堂课程筛选 */
  const all = useMemo(() => {
    const merged = [...(data?.homework ?? []), ...extHw];
    return extCourseId ? merged.filter((h) => h.externalClassroomId === extCourseId) : merged;
  }, [uiLocale, data, extHw, extCourseId]);

  // R23（霖需求）：旁听作业（雨课堂 role=6 课堂）**不计入**各分组计数与「全部」，
  // 而是在当前分组下方单列「旁听作业」一节——不与正式课程混排。
  const groups = useMemo(() => {
    const hw = [...all].sort((a, b) => a.deadline.localeCompare(b.deadline));
    // R21c：忽略的作业只出现在「已忽略」组，常规分组与「全部」都不再显示
    const live = hw.filter((h) => !ignored.has(h.id) && !h.audited);
    return {
      // 进行中 = 未交且未逾期（含 deadline 解析失败者，保守不判逾期）
      unfinished: live.filter((h) => !h.submitted && !isOverdue(h)),
      overdue: live.filter(isOverdue),
      submitted: live.filter((h) => h.submitted && !h.graded),
      graded: live.filter((h) => h.graded),
      ignored: hw.filter((h) => ignored.has(h.id)),
      all: live,
    };
  }, [uiLocale, all, ignored]);

  /** 旁听作业全集（同样排除已忽略） */
  const auditAll = useMemo(
    () => all.filter((h) => h.audited && !ignored.has(h.id)).sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [uiLocale, all, ignored],
  );
  /** 旁听节按当前分组同一口径筛选（进行中/已逾期/已交/已批改；「已忽略」组不重复列） */
  const auditList = useMemo(() => {
    if (filter === "ignored") return [];
    if (filter === "unfinished") return auditAll.filter((h) => !h.submitted && !isOverdue(h));
    if (filter === "overdue") return auditAll.filter(isOverdue);
    if (filter === "submitted") return auditAll.filter((h) => h.submitted && !h.graded);
    if (filter === "graded") return auditAll.filter((h) => h.graded);
    return auditAll;
  }, [uiLocale, auditAll, filter]);

  const list = groups[filter];
  // R10 15.4：页头只留学期文本；各分组计数已并入 Tabs 各 tab（含「全部」），
  // 「外部 N」删除（已融入各组、无信息量）
  // 从网络学堂页的雨课堂课程卡片进来时，页头改为说明「正在看哪门课」。
  const meta = extCourseId
    ? i18n("pages.learn.assignmentspage.f053f24bd333", { value: String(extCourseName || i18n("pages.learn.assignmentspage.67e5d61a802b")) })
    : data
      ? semesterText(data.semester.id)
      : i18n("pages.learn.assignmentspage.54209642994c");

  return (
    <>
      <PageHead
        title={i18n("pages.learn.assignmentspage.a1cabc0664cf")}
        meta={meta}
        actions={
          <>
            <PageAtomStar atomKey="learn-assignments" title={i18n("pages.learn.assignmentspage.a1cabc0664cf")} />
            <BackButton to="learn" label={i18n("pages.learn.assignmentspage.e5da2c107242")} />
            {extCourseId ? (
              <Btn variant="ghost" onClick={() => navigate("learn-assignments")}>{i18n("pages.learn.assignmentspage.d4b1b25d27b2")}</Btn>
            ) : null}
            <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.learn.assignmentspage.aee887434131")}</Btn>
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <ExtHwGuide />

      {/* R19 27.1：TUOJ 自动重漫游仍失败的静默条幅（含「去设置重新登录」手动入口） */}
      <ExtHwSourceErrorNote />

      <Tabs
        variant="segmented"
        block
        value={filter}
        onChange={(key) => setFilter(key as Filter)}
        items={FILTERS.map(({ key, label }) => ({ id: key, label, badge: groups[key].length }))}
      />

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : state === "error" && !data ? null : (
        <>
          {list.length === 0 && auditList.length === 0 ? (
            <Card>
              <Empty
                text={
                  filter === "unfinished"
                    ? i18n("pages.learn.assignmentspage.4ea07768437b")
                    : filter === "overdue"
                      ? i18n("pages.learn.assignmentspage.f67f9df18e46")
                      : filter === "ignored"
                        ? i18n("pages.learn.assignmentspage.174b6eabff32")
                        : i18n("pages.learn.assignmentspage.5c018f6106a3")
                }
              />
            </Card>
          ) : (
            <ListWindow className="learn-assignment-window">
              {/* 固定视口内滚动：高度由 ListWindow 按底栏实测，不再依赖硬编码 offset
                  （旧 offset 在宽屏留出大片空白）。 */}
                {list.map((h, i) => (
                  <HomeworkRow key={`${h.courseId}-${h.id}`} h={h} courseName={courseDisplayName(byCourse.get(h.courseId)) ?? h.courseName} identityCourseName={byCourse.get(h.courseId)?.name ?? h.courseName} sem={data?.semester.id} from="learn-assignments" remind style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} />
                ))}
                {/* R23：旁听作业单列（不计入上方计数与「全部」总数） */}
                {auditList.length > 0 ? (
                  <div className="learn-assignment-audit">
                    <SectionHead title={i18n("pages.learn.assignmentspage.fb24bf947275")} />
                    {auditList.map((h, i) => (
                      <HomeworkRow key={`${h.courseId}-${h.id}`} h={h} courseName={courseDisplayName(byCourse.get(h.courseId)) ?? h.courseName} identityCourseName={byCourse.get(h.courseId)?.name ?? h.courseName} sem={data?.semester.id} from="learn-assignments" remind style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} />
                    ))}
                  </div>
                ) : null}
            </ListWindow>
          )}
        </>
      )}
    </>
  );
}
