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

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
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

export const IconDemo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3 4 7v6c0 4.4 3.4 7.4 8 8 4.6-.6 8-3.6 8-8V7z" />
    <path d="m9 12 2 2 4-4.5" />
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

export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="16" rx="1.5" />
    <path d="M3.5 10h17M8 2.5V6.5M16 2.5V6.5" />
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

/** 选课：勾选靶标（圆 + 对勾） */
export const IconXk = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
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
export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m12 3.6 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6-4.2-3.9 5.7-.7z" />
  </svg>
);


/* ══════════ 收藏夹图标库（FavFolder.icon 键名持久化；未知键回退默认文件夹） ══════════ */

export const FOLDER_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  folder: IconFolder,
  star: IconStar,
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
  download: IconDownload,
  inbox: IconIn,
};

export function FolderIcon({ name, ...rest }: { name?: string } & SVGProps<SVGSVGElement>) {
  const C = (name && FOLDER_ICONS[name]) || IconFolder;
  return <C {...rest} />;
}
