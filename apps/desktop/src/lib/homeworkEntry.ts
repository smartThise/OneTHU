/**
 * R20-B2b：作业行点击的统一分流执行层 —— **所有**作业行点击入口（全部作业 /
 * 课程详情 / 今日页与收藏夹作业卡 / 全局搜索）唯一通道，禁止各点击点自拼分流。
 *
 * 结构：纯判定 pickHomeworkRoute（./yktDetail.ts，零依赖可 Node 直测）在这里落地：
 *  - "ykt-native"：雨课堂 + leafTypeId/classroomId 齐备 → navigate("learn-ykt-detail")。
 *    全平台默认原生（R20-B2b 起不再限 Android 宿主，PC 同样直达）；列表行已知信息
 *    （title/deadline/courseName/kind/externalUrl）仅作详情未回来时的头部兜底与
 *    「浏览器打开」备用出口；
 *  - "external-web"：其余外部源 / 雨课堂参数缺失 → openExternalHomework（R20-A 分流：
 *    Android 应用内桌面模式 WebView，桌面系统浏览器）；行无 externalUrl 时保持旧口径
 *    no-op（外部作业没有站内详情可落，点了不动作）；
 *  - "internal"：网络学堂作业 → navigate("learn-assignment-detail")。
 *
 * 本文件只做动作映射，不写判定条件（判定条件唯一出处 = pickHomeworkRoute）；
 * 依赖 tauri invoke（经由 openExternalHomework），Node 直测走纯函数层。
 */
import type { Homework } from "@onethu/core";
import type { LearnNav, Page } from "../state/app.js";
import { pickHomeworkRoute } from "./yktDetail.js";
import { openExternalHomework } from "./extHwBrowse.js";

/** 轻路由签名（与 AppState.navigate / components/HomeWidgets Nav 一致） */
export type HwNav = (page: Page, params?: LearnNav) => void;

export interface HwEntryOptions {
  navigate: HwNav;
  /** 返回目标（详情页返回键；不传由目标页自定默认） */
  from?: Page;
  /** 调用方持有的课程名兜底（今日页/搜索的 courseId → 名称映射；行自带 courseName 优先） */
  courseName?: string;
}

/**
 * 雨课堂原生详情的参数（§2.8.2 宽屏分栏右栏内嵌复用）。
 * 与 openHomeworkRow 同一构造：分栏右栏不跳页、也不污染全局 navParams，
 * 直接把这份参数当 props 交给详情组件。
 */
export function yktDetailParams(h: Homework, courseName: string, from?: Page): NonNullable<LearnNav["ykt"]> {
  return {
    leafTypeId: h.externalLeafTypeId ?? "",
    classroomId: h.externalClassroomId ?? "",
    externalUrl: h.externalUrl,
    title: h.title,
    deadline: h.deadline,
    courseName: h.courseName ?? courseName,
    kind: h.kind,
  };
}

/** 作业行点击统一入口：按 pickHomeworkRoute 三态落地，任何点击点不得绕过本函数。 */
export function openHomeworkRow(h: Homework, opts: HwEntryOptions): void {
  const route = pickHomeworkRoute(h);
  if (route === "ykt-native") {
    opts.navigate("learn-ykt-detail", { ykt: yktDetailParams(h, opts.courseName ?? "", opts.from), from: opts.from });
    return;
  }
  if (route === "external-web") {
    // R20-A 分流不变：Android 应用内 WebView 桌面模式 / 桌面系统浏览器；无链接 no-op
    if (h.externalUrl) void openExternalHomework(h.externalUrl);
    return;
  }
  opts.navigate("learn-assignment-detail", { courseId: h.courseId, itemId: h.id, from: opts.from });
}
