/** 全部作业（learnX Assignments）：tab 分「进行中 / 已交 / 已批 / 全部」，组内按截止时间排序。
 *
 * E8（霖 2026-10-04）两条口径：
 * - 「已忽略」从 tab 栏移出，顶部改成一个垃圾桶图标入口，点开走 A3 既有弹层列出忽略列表
 *   并可就地恢复（不是删除数据，仍可找回）；tab 栏因此变短。
 * - 「已逾期」不再是独立 tab：归入「进行中」并**单独一栏**（模仿旁听作业的分栏规则），
 *   且**计入**「进行中」的计数。
 */
import { useMemo, useRef, useState } from "react";
import { parseLearnTime, SOURCE_NAMES } from "@onethu/core";
import { usePageCollect } from "../../components/Collect.js";
import { pageAtomRef } from "../../state/atoms.js";
import type { PageMenuItem } from "../../state/pageChrome.js";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh, IconTrash } from "../../components/Icons.js";
import { useContextMenu } from "../../components/ContextMenu.js";
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
import { userCopy } from "../../lib/userCopy.js";
import { unignoreHw, useIgnoredHw } from "../../state/hwIgnore.js";
import { useLearnNavSemester } from "./shared.js";

/** 「已逾期」与「已忽略」都不再是 tab：逾期并入「进行中」单列一栏，忽略走垃圾桶入口 */
type Filter = "unfinished" | "submitted" | "graded" | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "unfinished", label: "进行中" },
  { key: "submitted", label: "已交" },
  { key: "graded", label: "已批" },
  { key: "all", label: "全部" },
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
          <div>雨课堂人人可用；OJ 平台（TUOJ、Tyche 等）按个人情况在设置页登录。</div>
          <div style={{ opacity: 0.8, marginTop: 2 }}>
            登录后把各平台作业 DDL 合并到「全部作业」与「今日」。
          </div>
          {/* R11 16.2：TUOJ 自动漫游已过统一认证但未返回课程——条幅提示，不算错误 */}
          {ext.tuojAuto.tuoj.kind === "no-courses" ? (
            <div style={{ opacity: 0.8, marginTop: 2 }}>
              TUOJ 统一认证已通过，但未返回课程（可能未注册 / 未选课）。
            </div>
          ) : null}
        </span>
        <button className="btn btn-primary" onClick={() => setLoginOpen(true)}>
          登录雨课堂
        </button>
        <button
          className="btn"
          onClick={() => {
            requestExtHwScroll();
            navigate("settings");
          }}
        >
          去设置
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            dismissExtHwGuide();
            setDismissed(true);
          }}
        >
          知道了
        </button>
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
  const { navigate } = useApp();
  const ext = useExternalHomework();
  const [yktLoginOpen, setYktLoginOpen] = useState(false);
  const [tuojLoginOpen, setTuojLoginOpen] = useState(false);
  const rows = (["tuoj", "tuojClassic", "tyche", "yuketang"] as const)
    .map((id) => ({ id, name: SOURCE_NAMES[id], err: ext.errors[id] }))
    .filter((r) => Boolean(r.err));
  const yktFailed = rows.some((r) => r.id === "yuketang");
  // 等凭据解密完成再判断，避免就绪前闪一下
  if (ext.state !== "ready" || rows.length === 0) return null;
  return (
    <>
      <div className="browser-hint ext-hw-hint">
        <span className="ext-hw-hint-text">
          {rows.map(({ id, name, err }) => (
            <div key={id} style={{ color: "var(--red)" }}>
              {name}：{userCopy(err ?? "")}
            </div>
          ))}
        </span>
        {yktFailed ? (
          <button className="btn btn-primary" onClick={() => setYktLoginOpen(true)}>
            雨课堂扫码重登
          </button>
        ) : null}
        {rows.some((r) => r.id === "tuoj" || r.id === "tuojClassic") ? (
          <button className="btn btn-primary" onClick={() => setTuojLoginOpen(true)}>
            TUOJ 重新登录
          </button>
        ) : null}
        <button
          className="btn"
          onClick={() => {
            requestExtHwScroll();
            navigate("settings");
          }}
        >
          去设置重新登录
        </button>
      </div>
      <ConnectGate need="yuketang" open={yktLoginOpen} onClose={() => setYktLoginOpen(false)} />
      <ConnectGate need="tuoj" open={tuojLoginOpen} onClose={() => setTuojLoginOpen(false)} />
    </>
  );
}

/** E8 忽略列表弹层体（A3 弹层内的内容）：订阅同一份忽略快照——恢复一条后列表立刻少一条，
 *  不是一个打开时刻的冻结副本。 */
function IgnoredHwPanel() {
  const ignored = useIgnoredHw();
  const list = useMemo(() => [...ignored.values()].sort((a, b) => b.at - a.at), [ignored]);
  if (list.length === 0) return <div className="asg-ignored-empty">没有被忽略的作业。</div>;
  return (
    <div className="asg-ignored">
      {list.map((e) => (
        <div key={e.id} className="asg-ignored-row">
          <span className="asg-ignored-title" title={e.title || "未命名作业"}>
            {e.title || "未命名作业"}
          </span>
          <button type="button" className="btn" onClick={() => unignoreHw(e.id)}>
            恢复
          </button>
        </div>
      ))}
    </div>
  );
}

/** E8 顶部垃圾桶入口：点开走 A3 的长按菜单本体（同一个 ContextMenuLayer）。
 *  霖 2026-10-04 裁定「一步展开」：点垃圾桶**直接**进忽略列表，不再先出一层单项菜单——
 *  所以走 `ctx.openPanel()`，面板里列出忽略列表并可逐条恢复。tab 栏因此不再有「已忽略」这一项。 */
function IgnoredHwEntry() {
  const ctx = useContextMenu();
  const ignored = useIgnoredHw();
  const btn = useRef<HTMLButtonElement>(null);
  const open = (): void => {
    if (ctx.isOpen()) {
      ctx.close();
      return;
    }
    const r = btn.current?.getBoundingClientRect();
    ctx.openPanel({
      x: r ? r.right : 0,
      y: r ? r.bottom : 0,
      title: "已忽略的作业",
      panel: () => <IgnoredHwPanel />,
    });
  };
  return (
    <button
      ref={btn}
      type="button"
      className="icon-btn asg-trash"
      data-ctx-trigger
      aria-haspopup="menu"
      aria-label="已忽略的作业"
      title="已忽略的作业（可恢复）"
      onClick={open}
    >
      <IconTrash width={16} height={16} />
      {ignored.size > 0 ? <span className="asg-trash-count">{ignored.size}</span> : null}
    </button>
  );
}

export function AssignmentsPage() {
  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  const ext = useExternalHomework();
  const [filter, setFilter] = useState<Filter>("unfinished");

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  /** 外部作业（雨课堂/TUOJ/Tyche）归一化；未配置凭据时恒为空数组（零回归） */
  const extHw = useMemo(() => ext.items.map(toHomework), [ext.items]);
  // R21c：忽略状态（订阅同一份快照：行内忽略/恢复立刻反映到分组与计数）
  const ignored = useIgnoredHw();

  // R23（霖需求）：旁听作业（雨课堂 role=6 课堂）**不计入**各分组计数与「全部」，
  // 而是在当前分组下方单列「旁听作业」一节——不与正式课程混排。
  // E8：逾期不再单开 tab——`unfinished` 含逾期（计数含它），渲染时拆成「进行中 / 已逾期」两栏。
  const groups = useMemo(() => {
    const hw = [...(data?.homework ?? []), ...extHw].sort((a, b) => a.deadline.localeCompare(b.deadline));
    // R21c：忽略的作业不再进常规分组与「全部」（只在垃圾桶弹层里）
    const live = hw.filter((h) => !ignored.has(h.id) && !h.audited);
    return {
      // 进行中 = 未交（含已逾期；deadline 解析失败者保守留在进行中）
      unfinished: live.filter((h) => !h.submitted),
      // 已逾期 = 未交且截止已过（⊂ 进行中，栏内单列但计入上面的计数）
      overdue: live.filter(isOverdue),
      submitted: live.filter((h) => h.submitted && !h.graded),
      graded: live.filter((h) => h.graded),
      all: live,
    };
  }, [data, extHw, ignored]);

  /** 旁听作业全集（同样排除已忽略） */
  const auditAll = useMemo(
    () =>
      [...(data?.homework ?? []), ...extHw]
        .filter((h) => h.audited && !ignored.has(h.id))
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data, extHw, ignored],
  );
  /** 旁听节按当前分组同一口径筛选（与正式分组同口径：进行中已含逾期） */
  const auditList = useMemo(() => {
    if (filter === "unfinished") return auditAll.filter((h) => !h.submitted);
    if (filter === "submitted") return auditAll.filter((h) => h.submitted && !h.graded);
    if (filter === "graded") return auditAll.filter((h) => h.graded);
    return auditAll;
  }, [auditAll, filter]);

  const list = groups[filter];
  // E8：「进行中」栏内拆两段——未到期在前、已逾期单列一栏（逾期项仍算在 groups.unfinished 计数里）
  const onTimeList = filter === "unfinished" ? list.filter((h) => !isOverdue(h)) : list;
  const overdueList = filter === "unfinished" ? groups.overdue : [];
  // R10 15.4：页头只留学期文本；各分组计数已并入 SegmentedOverflow 各 tab（含「全部」），
  // 「外部 N」删除（已融入各组、无信息量）
  const meta = data ? semesterText(data.semester.id) : "按截止时间排序";

  const collect = usePageCollect(pageAtomRef("learn-assignments"), "全部作业");

  const renderRows = (rows: typeof list, delayBase = 0) => (
    <Card className="list swap-in">
      {rows.map((h, i) => (
        <HomeworkRow
          key={`${h.courseId}-${h.id}`}
          h={h}
          courseName={h.courseName ?? byCourse.get(h.courseId)}
          sem={data?.semester.id}
          from="learn-assignments"
          style={{ animationDelay: `${(delayBase + i) * 25}ms` }}
        />
      ))}
    </Card>
  );

  return (
    <>
      {collect.modal}
      <PageHead
        title="全部作业"
        meta={meta}
        back={<BackButton to="learn" label="课程列表" />}
        actions={
          <IgnoredHwEntry />
        }
        menu={[
          collect.item,
          {
            key: "refresh",
            label: "刷新",
            icon: <IconRefresh width={16} height={16} />,
            disabled: state === "loading",
            onSelect: () => void reload(),
          },
        ].filter(Boolean) as PageMenuItem[]}
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <ExtHwGuide />

      {/* R19 27.1：TUOJ 自动重漫游仍失败的静默条幅（含「去设置重新登录」手动入口） */}
      <ExtHwSourceErrorNote />

      {/* E8：tab 栏只剩进行中 / 已交 / 已批 / 全部（已逾期并入进行中、已忽略移到顶部垃圾桶） */}
      <SegmentedOverflow>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "is-active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="tab-count">{groups[key].length}</span>
          </button>
        ))}
      </SegmentedOverflow>

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : state === "error" && !data ? null : (
        <>
          {onTimeList.length === 0 && overdueList.length === 0 && auditList.length === 0 ? (
            <Card>
              <Empty text={filter === "unfinished" ? "没有进行中的作业。" : "该分组暂无作业。"} />
            </Card>
          ) : null}
          {onTimeList.length > 0 ? renderRows(onTimeList) : null}
          {/* E8：已逾期在「进行中」下单独一栏（仿旁听作业分栏；计数已含在「进行中」里） */}
          {overdueList.length > 0 ? (
            <>
              <SectionHead title="已逾期" />
              {renderRows(overdueList, onTimeList.length)}
            </>
          ) : null}
          {/* R23：旁听作业单列（不计入上方计数与「全部」总数） */}
          {auditList.length > 0 ? (
            <>
              <SectionHead title="旁听作业" />
              {renderRows(auditList, onTimeList.length + overdueList.length)}
            </>
          ) : null}
        </>
      )}
    </>
  );
}
