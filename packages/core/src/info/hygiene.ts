/**
 * 宿舍卫生成绩 —— thu-info-lib dorm.ts getDormScore 的纯解析层（逐字移植；
 * I/O 与 id→m.myhome 漫游 0a993de7…/0 在 client.ts 挂载）。
 *
 * lib 判据移植：#weixin_health_linechartCtrl1_Chart1 图表元素唯一，其 src 即
 * 折线图图片地址；无图表元素在 lib 为 DormAuthError —— 此处返回 null（= 暂无
 * 卫生检查数据，UI 显示「暂无」），登录页特征仍按会话失效处理。
 */
import { findAttr } from "./htmltext.js";

/** 未登录页特征（与电费页同款 ASP.NET 登录控件，client 层据此抛 AuthRequiredError） */
export const HYGIENE_LOGIN_MARK = "net_Default_LoginCtrl1_txtUserName";

export function hasHygieneLogin(page: string): boolean {
  return page.includes(HYGIENE_LOGIN_MARK);
}

/**
 * 卫生检查图表图片地址（lib getDormScore 的 chart.attr().src）。
 * 返回页面原文 src（webvpn 相对路径 / 绝对地址 / 站点相对路径均可能），
 * 由 client 层解析成可请求 URL；无图表 → null。
 */
export function parseHygieneChartSrc(page: string): string | null {
  const tag = /<img\b[^>]*id=["']weixin_health_linechartCtrl1_Chart1["'][^>]*>/i.exec(page)?.[0];
  if (!tag) return null;
  return findAttr(tag, "src") ?? null;
}
