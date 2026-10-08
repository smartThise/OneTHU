/**
 * 「我的」页（G3；设计稿原 docs/mine.md，已并入 docs/ui-ux-polish-detailed.md §12）。
 *
 * 三段**不列标题**，自上而下自然排布：
 *   一、学生卡（个人信息）：头像取姓，直径 = 卡片高度的一半；姓名 + 学号；下方院系 / 邮箱；
 *       无内部分隔线，阴影照作业卡片（border + surface-container-lowest + shadow-1）。
 *   二、渐变过渡带里的三张数字卡：校园卡余额 / 学分 / GPA。带内背景是主题色渐变，
 *       从学生卡下方起、在三张卡走完的过程中透明度降到 0——**不画分界线**，靠这条隐形
 *       过渡把两段接起来（霖 2026-10-01 二次定稿）。数字有累加动画。
 *   三、五项服务列表：设置 / 邮箱 / 云盘 / 成绩 / 我的收藏。
 *
 * 学分与 GPA 取**全部已修**口径（与成绩页「全部学年加权」同一份实现 lib/grades）；
 * 数据全部复用既有 hook（useProfile / useCard / useReport / useMailCounts / useFavs），
 * 本页不发请求、不读本地存储、不新增缓存。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Card, PageHead } from "../components/Layout.js";
import { useCountUp } from "../components/CountUp.js";
import {
  IconChevron,
  IconCloud,
  IconLearn,
  IconMail,
  IconSettings,
  IconStar,
} from "../components/Icons.js";
import { useApp } from "../state/context.js";
import {
  getCampusSnapshot,
  subscribeCampusData,
  useCard,
  useProfile,
  useReport,
} from "../state/data.js";
import { MAIL_FOLDERS, useMailCounts } from "../state/mail.js";
import { useFavs } from "../state/favs.js";
import { ensureSeafileAccount, useSeafile } from "../state/seafile.js";
import { fmtSize } from "../lib/size.js";
import { argbFromCssColor, hexFromArgb, paletteGradientStops } from "../lib/monet.js";
import { useThemes } from "../state/theme.js";
import { displayStudentId } from "../lib/privacy.js";
import { creditsOf, weightedAverage } from "../lib/grades.js";

/* D4：数字递增（含 prefers-reduced-motion 降级）已抽到 components/CountUp.tsx；
   本页不再需要私有副本——重复实现在别处改不动，正是这次抽出来的原因。 */

/** 服务行：全局列表行同款（.row + .row-click：分隔线、行高、进场动画都复用现成的），
 *  左图标、中间名称 + 说明、右进入图标。 */
function ServiceRow({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <div
      className="row row-click"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
    >
      <span className="mine-row-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="row-main">
        <div className="row-title">{title}</div>
        <div className="row-sub">{desc}</div>
      </div>
      <IconChevron className="row-caret" width={16} height={16} />
    </div>
  );
}

/**
 * 当前主题色 → Monet 色盘停点（霖 2026-10-01 #1）。
 * 颜色不写死：读当前生效的 primary 令牌当「源色」，用 Monet（HCT/CAM16）派生
 * primary/secondary/tertiary 三条色调板各取几档 tone，作为渐变带的 5 个停点。
 * 主题一换（含第三方主题插件、昼夜调度）就重算；解析不出来返回 null，CSS 回落到令牌默认值。
 */
function useMineGradient(): string[] | null {
  const { activeId, systemDark } = useThemes();
  const [colors, setColors] = useState<string[] | null>(null);
  useEffect(() => {
    const read = (): void => {
      const cs = getComputedStyle(document.documentElement);
      const raw = (
        cs.getPropertyValue("--md-sys-color-primary") ||
        cs.getPropertyValue("--primary") ||
        cs.getPropertyValue("--accent")
      ).trim();
      const argb = argbFromCssColor(raw);
      setColors(argb === null ? null : paletteGradientStops(hexFromArgb(argb)).colors);
    };
    read();
    /* 主题令牌是同步写上的；插件主题可能下一帧才注入，所以再读一次 */
    const raf = requestAnimationFrame(read);
    return () => cancelAnimationFrame(raf);
  }, [activeId, systemDark]);
  return colors;
}

export function MinePage() {
  const { navigate, user: sessionUser } = useApp();
  /* 个人信息与「信息 → 个人信息」同源；学号兜底登录账号（与 ProfileTab 一字不差） */
  const profile = useProfile();
  const user = profile.data ?? null;
  const studentId = displayStudentId(user?.studentId || sessionUser?.username);
  /* 校园邮箱只有信息门户那份有值时空着，这里读校园数据缓存兜底（只读快照，不发请求） */
  const cached = useSyncExternalStore(subscribeCampusData, getCampusSnapshot, getCampusSnapshot);
  const email = user?.email || cached?.user?.email || "—";

  const card = useCard(1);
  const report = useReport();
  const rows = report.data ?? [];
  const credits = creditsOf(rows);
  const allGpa = weightedAverage(rows);

  const mailCounts = useMailCounts();
  const unread = MAIL_FOLDERS.reduce((sum, f) => sum + (mailCounts[f.id] ?? 0), 0);
  const favs = useFavs();
  const folderCount = Object.keys(favs.data.folders).length;
  /* 云盘用量：走状态层的只读加载（有缓存不重复请求），取不到就回落文案 */
  const seafile = useSeafile();
  useEffect(() => {
    void ensureSeafileAccount();
  }, []);
  const cloudDesc = seafile.configured
    ? seafile.account
      ? `已用 ${fmtSize(seafile.account.usage)} / ${fmtSize(seafile.account.total)}`
      : "资料库 · 同步盘"
    : "未绑定";

  const balanceText = useCountUp(card.data?.info.balance ?? null, (v) => "¥" + v.toFixed(2));
  const creditText = useCountUp(credits > 0 ? credits : null, (v) =>
    Number.isInteger(credits) ? String(Math.round(v)) : v.toFixed(1),
  );
  const gpaText = useCountUp(allGpa, (v) => v.toFixed(2));

  /* 渐变带的色盘停点（Monet，跟随主题） */
  const gradient = useMineGradient();

  const initial = (user?.name ?? "?").trim().slice(0, 1) || "?";

  return (
    <>
      {/* 渐变从页面顶端铺起（带上含页头与学生卡，见 §12 G3）：个人信息整段正常显示，
          卡片下沿开始渐隐，数据卡片结束处彻底消失 */}
      <div
        className="mine-grad"
        /* 色盘停点来自 Monet（见 useMineGradient）；取不到就不挂变量，CSS 用令牌兜底 */
        style={
          gradient
            ? ({ "--mine-c1": gradient[0], "--mine-c2": gradient[1], "--mine-c3": gradient[2], "--mine-c4": gradient[3], "--mine-c5": gradient[4] } as CSSProperties)
            : undefined
        }
      >
        <PageHead title="我的" />

        {/* 一、学生卡 */}
        <div className="mine-card">
          <div className="mine-card-head">
            <span className="mine-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="mine-card-id">
              <span className="mine-name">{user?.name ?? "未获取"}</span>
              <span className="mine-sid">学号 {studentId || "未获取"}</span>
            </span>
          </div>
          {/* 霖 2026-10-02 第四批 #8：标题与内容分两栏，别再揉成一整句 */}
          <div className="mine-card-meta">
            <span className="mine-meta-line">
              <span className="mine-meta-label">院系</span>
              <span className="mine-meta-value">{user?.department || "—"}</span>
            </span>
            <span className="mine-meta-line">
              <span className="mine-meta-label">邮箱</span>
              <span className="mine-meta-value">{email}</span>
            </span>
          </div>
        </div>

        {/* 二、三张数字卡（坐在渐变的渐隐段里，与上一段之间不画分界线） */}
        <div className="mine-stats">
          <button
            type="button"
            className="mine-stat"
            onClick={() => navigate("life", { lifeTab: "card" })}
          >
            <b className="mine-stat-num">{balanceText}</b>
            <i className="mine-stat-label">校园卡余额</i>
          </button>
          <button
            type="button"
            className="mine-stat"
            onClick={() => navigate("info", { infoTab: "report" })}
          >
            <b className="mine-stat-num">{creditText}</b>
            <i className="mine-stat-label">学分</i>
          </button>
          <button
            type="button"
            className="mine-stat"
            onClick={() => navigate("info", { infoTab: "report" })}
          >
            <b className="mine-stat-num">{gpaText}</b>
            <i className="mine-stat-label">GPA</i>
          </button>
        </div>
      </div>

      {/* 三、五项服务 */}
      <Card className="mine-services">
        <ServiceRow
          icon={<IconSettings width={18} height={18} />}
          title="设置"
          desc="账号、通用、隐私"
          onClick={() => navigate("settings")}
        />
        <ServiceRow
          icon={<IconMail width={18} height={18} />}
          title="邮箱"
          desc={unread > 0 ? unread + " 封未读" : "暂无未读"}
          onClick={() => navigate("mail")}
        />
        <ServiceRow
          icon={<IconCloud width={18} height={18} />}
          title="云盘"
          desc={cloudDesc}
          onClick={() => navigate("cloud")}
        />
        <ServiceRow
          icon={<IconLearn width={18} height={18} />}
          title="成绩"
          desc="点击查看成绩"
          onClick={() => navigate("info", { infoTab: "report" })}
        />
        <ServiceRow
          icon={<IconStar width={18} height={18} />}
          title="我的收藏"
          desc={folderCount > 0 ? folderCount + " 个收藏夹" : "还没有收藏夹"}
          onClick={() => navigate("favs")}
        />
      </Card>
    </>
  );
}
