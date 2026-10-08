/** 内联线性图标 —— 1.6px 描边，墨色，克制 */
import type { ReactElement, SVGProps } from "react";

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export const IconToday = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 6h18M3 12h18M3 18h11" />
    <circle cx="19.4" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const IconLearn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
    <path d="M20 18.5H6.5A2.5 2.5 0 0 0 4 21" />
  </svg>
);

export const IconSchedule = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
    <path d="M3.5 10h17M8 2.5V6.5M16 2.5V6.5" />
  </svg>
);

/* 真齿轮（G4）：外圈八齿 + 内孔。旧画法是「圆心 + 八条射线」，霖走查判定像太阳。 */
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.1 14.6a1.5 1.5 0 0 0 .3 1.65l.05.05a1.82 1.82 0 1 1-2.57 2.57l-.05-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.91 1.37v.14a1.82 1.82 0 1 1-3.64 0v-.07a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.05.05a1.82 1.82 0 1 1-2.57-2.57l.05-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.91H3.6a1.82 1.82 0 1 1 0-3.64h.07a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.05-.05a1.82 1.82 0 1 1 2.57-2.57l.05.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .91-1.37V3.6a1.82 1.82 0 1 1 3.64 0v.07a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.82 1.82 0 1 1 2.57 2.57l-.05.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.91h.14a1.82 1.82 0 1 1 0 3.64h-.07a1.5 1.5 0 0 0-1.37.91Z" />
  </svg>
);

export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8.2" r="3.4" />
    <path d="M4.8 20c.6-3.6 3.6-5.6 7.2-5.6s6.6 2 7.2 5.6" />
  </svg>
);

export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />
  </svg>
);

export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h10" />
  </svg>
);

export const IconFile = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 2.5h8L19 8v13.5H6z" />
    <path d="M13.5 3v5.5H19" />
  </svg>
);

export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 16v-5.5a6 6 0 0 1 12 0V16l1.5 2.5h-15z" />
    <path d="M10 21h4" />
  </svg>
);

export const IconPen = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m14.5 5 4.5 4.5L8 20.5l-5 1 1-5z" />
    <path d="m12.5 7 4.5 4.5" />
  </svg>
);

export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 16V5" />
    <path d="m7 10 5-5 5 5" />
    <path d="M5 19h14" />
  </svg>
);

export const IconCloud = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M17.5 19a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.3 12.1 4 4 0 0 0 6 19.9h11.5Z" />
  </svg>
);

export const IconBook = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
  </svg>
);

export const IconMail = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

export const IconIn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v10.5M7.5 9.5 12 14l4.5-4.5" />
    <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5L19.5 7" />
  </svg>
);

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const IconTrace = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10Z" />
    <circle cx="12" cy="10.6" r="2.3" />
    <path d="M19 16.5c1.6.6 2.5 1.4 2.5 2.3 0 1.7-4.3 3-9.5 3" strokeDasharray="0" />
  </svg>
);

/** 校历：日历 + 当天标记（与 IconSchedule 的「纯网格日历」区分开——
 *  反馈修复 2026-10-05：两者此前 SVG 路径逐字节相同，日程与预约并排显示时同形）。 */
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
    <path d="M3.5 10h17M8 2.5V6.5M16 2.5V6.5M12 12.2h4.6V17H12z" />
  </svg>
);

/** 预约：座位（图书馆座位 / 研讨间 / 空教室 / 体育场馆 / 公共空间都是「订一个位置」） */
export const IconReserve = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6.6 3.5h10.8v7.2H6.6z" />
    <path d="M4.2 13.4h15.6v3.4H4.2z" />
    <path d="M6.6 16.8v3.7M17.4 16.8v3.7" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3v11M7.5 10 12 14.5 16.5 10" />
    <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
  </svg>
);

export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </svg>
);

/** 警示（危险操作确认弹窗用，与 .btn-danger 同一语义）：三角外廓 + 感叹号 */
export const IconWarn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M10.3 3.9 1.9 18.1A2 2 0 0 0 3.6 21h16.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.5M12 17.3h.01" />
  </svg>
);

/** 选课：勾选靶标（圆 + 对勾） */
export const IconXk = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </svg>
);

/** 在线服务（THOS 服务大厅）：四格服务窗格 */
export const IconThos = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6.6" height="6.6" rx="1.4" />
    <rect x="13.4" y="4" width="6.6" height="6.6" rx="1.4" />
    <rect x="4" y="13.4" width="6.6" height="6.6" rx="1.4" />
    <path d="M16.7 13.9v5.6M13.9 16.7h5.6" />
  </svg>
);

export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="10.5" r="1.8" />
    <path d="M6 16c.7-1.6 1.9-2.2 3-2.2s2.3.6 3 2.2M14.5 9.5h4M14.5 12.5h4M14.5 15.5h4" />
  </svg>
);

export const IconCard = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3 10h18M6.5 14.5h4" />
  </svg>
);

export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13.5 5H19v5.5M19 5l-8 8" />
    <path d="M18 14.5v4A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4" />
  </svg>
);

/** 收藏夹（用户收藏夹/子收藏夹通用标识） */
export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
  </svg>
);

/** 新建收藏夹（文件夹 + 加号） */
export const IconFolderPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
    <path d="M12 10.5v5M9.5 13h5" />
  </svg>
);

/** 收藏星标（CollectStar 用；fill 由调用方以 CSS 控制） */
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {/* 图钉（pushpin）：钉帽 + 钉身 + 针尖，避免与星号混淆 */}
    <path d="M9.6 1.6h4.8v1.6l-1.6 1.6v3.2L10.4 10.4H5.6L3.2 8V4.8L1.6 3.2V1.6z" />
    <path d="M8 10.4v4" />
  </svg>
);

export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m12 3.6 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" />
  </svg>
);

/* ══════════ 收藏夹图标库（FavFolder.icon 键名持久化；未知键回退默认文件夹） ══════════ */

export const FOLDER_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  folder: IconFolder,
  star: IconStar,
  pin: IconPin,
  today: IconToday,
  learn: IconLearn,
  schedule: IconSchedule,
  pen: IconPen,
  check: IconCheck,
  flag: IconFlag,
  calendar: IconCalendar,
  bell: IconBell,
  file: IconFile,
  search: IconSearch,
  info: IconInfo,
  card: IconCard,
  refresh: IconRefresh,
  external: IconExternal,
  xk: IconXk,
  thos: IconThos,
  download: IconDownload,
  inbox: IconIn,
};

export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 7.2V3.4M15 7.2V3.4M6.8 7.2h10.4v3.9a5.2 5.2 0 0 1-5.2 5.2 5.2 5.2 0 0 1-5.2-5.2V7.2ZM12 16.3v4.3" />
  </svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 7l10 10M17 7l-10 10" />
  </svg>
);

/** E8：「已忽略」入口（垃圾桶）——从「全部作业」tab 栏移出后的顶部入口 */
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10v6M13.5 10v6" />
  </svg>
);

/** GitHub 标（品牌填充形，故单独覆盖 fill/stroke；16 号画布按 1.5 倍放到 24 网格） */
export const IconGithub = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ fill: "currentColor", stroke: "none", ...p })}>
    <g transform="scale(1.5)">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </g>
  </svg>
);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

/** G1 顶栏返回键（←） */
export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

/** G1 顶栏「···」（页面级操作菜单）；三个实心圆点，不描边 */
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </svg>
);

export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);



export function FolderIcon({ name, ...rest }: { name?: string } & SVGProps<SVGSVGElement>) {
  const C = (name && FOLDER_ICONS[name]) || IconFolder;
  return <C {...rest} />;
}
