/**
 * E6：页面归属（底栏高亮）的唯一映射表。
 *
 * 由来（docs/ui-ux-polish-detailed.md §6 E6）：底栏原先用每项各自的 `activePages`
 * 数组做高亮，`mail` 这类页面不在任何一项里 → 底栏出现「没有任何一项被选中」。
 * 现在反过来做：**按页面查归属**，每个可达页面都必须能查到唯一一项。
 *
 * 三条纪律：
 * - 表用 `Record<Exclude<Page, \`plugin:\${string}\`>, BottomNavPage>` 声明，
 *   新增路由不补归属就编译不过——「漏一页」这类退化在类型层就被挡住；
 * - 插件动态 tab（`plugin:<id>:<tab>`）不进静态表，统一归「我的」（设置里进插件）；
 * - 白名单只登记**确实不该有底栏**的页面；目前为空（登录页不是 Page，全屏页也都已归属）。
 *
 * 归属口径（与 NAV_REGISTRY 的分类对齐，霖已定）：
 * - 待办项同时承载学习类（网络学堂及其子页、课表、选课）——沿用 M1 既有约定；
 * - 邮箱 / 云盘 / 设置 / 个人信息与成绩 / 插件 → 「我的」（行政长尾归口）；
 * - 生活 / 预约 / 寻迹 / 在线服务 / 其他 Info 应用 / THUbook → 「服务」；
 * - 收藏首页与收藏夹页 → 「收藏」。
 */
import type { Page } from "./app.js";

/** 底栏五项（顺序即展示顺序；E3 已把第 5 项由「设置」换成「我的」页） */
export type BottomNavPage = "today" | "tasks" | "services" | "favs" | "mine";

export const BOTTOM_NAV_PAGES: readonly BottomNavPage[] = ["today", "tasks", "services", "favs", "mine"];

/** 页面 → 底栏归属（穷尽检查：漏一页编译不过） */
export const PAGE_OWNER: Record<Exclude<Page, `plugin:${string}`>, BottomNavPage> = {
  /* 今日 */
  today: "today",
  /* 学习（挂在底栏「待办」项下，M1 既有约定） */
  tasks: "tasks",
  "learn-assignments": "tasks",
  "learn-assignment-detail": "tasks",
  "learn-ykt-detail": "tasks",
  learn: "tasks",
  "learn-course": "tasks",
  "learn-notices": "tasks",
  "learn-notice-detail": "tasks",
  "learn-files": "tasks",
  "learn-file-detail": "tasks",
  "learn-search": "tasks",
  "learn-semester": "tasks",
  "learn-forum-thread": "tasks",
  schedule: "tasks",
  zhjwxk: "tasks",
  /* 我的（行政 / 个人数据归口；E3 起底栏第 5 项就是「我的」页） */
  mine: "mine",
  info: "mine",
  mail: "mine",
  cloud: "mine",
  settings: "mine",
  plugins: "mine",
  /* 服务（长尾工具） */
  services: "services",
  life: "services",
  reserve: "services",
  trace: "services",
  thos: "services",
  otherinfo: "services",
  thubook: "services",
  /* G2 独立页：归属沿用原聚合页（信息→我的、生活/预约→服务、选课→待办），
     底栏高亮与顶栏返回回落都与旧页一致 */
  grade: "mine",
  fitness: "mine",
  exams: "mine",
  evaluation: "mine",
  calendar: "mine",
  news: "mine",
  profile: "mine",
  "course-info": "mine",
  dorm: "services",
  washer: "services",
  hygiene: "services",
  "campus-card": "services",
  invoice: "services",
  payroll: "services",
  "grad-income": "services",
  "campus-net": "services",
  "lib-seat": "services",
  "lib-room": "services",
  classroom: "services",
  sports: "services",
  "public-space": "services",
  "xk-find": "tasks",
  "xk-manage": "tasks",
  /* 收藏 */
  favs: "favs",
  folder: "favs",
};

/** 白名单：确实不该有底栏的页面（登录页不是 Page；留空也要有这个出口） */
export const NO_BOTTOM_NAV: readonly Page[] = [];

/**
 * 页面归属查询。插件动态 tab 统一归「我的」；未登记页面兜底「服务」，
 * 但未登记页面在类型层已经不可能（Record 穷尽），这里是运行时二道闸。
 */
export function navOwner(page: Page): BottomNavPage {
  if (page.startsWith("plugin:")) return "mine";
  if (NO_BOTTOM_NAV.includes(page)) return "services";
  return PAGE_OWNER[page as Exclude<Page, `plugin:${string}`>] ?? "services";
}

/** 底栏某一项在当前页是否高亮（唯一判据，Layout 不许自己再写一份） */
export function isBottomNavActive(item: BottomNavPage, page: Page): boolean {
  return navOwner(page) === item;
}
