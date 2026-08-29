/**
 * 订水 —— thu-info-app 真实实现移植（apps/thu-info-app/src/network/water.ts 逐行；
 * dorm.ts 内无订水实现）。清华水站（北京清华园锅炉房？dingshui.bjqzhd.com）公开接口，
 * 无需校内会话，不走 HttpClient（避免被 WebVPN 包装；Tauri 传输层无 CORS 限制）。
 */
import type { FetchLike } from "../http.js";

/** 用户信息查询（water.ts WATER_USER_URL；body: name=pw&param=<订水编号>） */
export const WATER_USER_URL = "http://dingshui.bjqzhd.com/auser/getuser.html";

/** 订水提交（water.ts WATER_SUB_URL；body: pw=<订水编号>&num&num1&lid&address） */
export const WATER_SUB_URL = "http://dingshui.bjqzhd.com/buy/subs.html";

/** 水种 id → 名称（water.ts waterBrandIdToName 原表） */
export const WATER_BRANDS: Record<string, string> = {
  "6": "清紫源泉矿泉水（高端）",
  "10": "燕园泉矿泉水（高端）",
  "12": "农夫山泉桶装水（19L）",
  "11": "清紫源泉矿泉水",
  "8": "喜士天然矿泉水（大）",
  "9": "喜士天然矿泉水（小）",
  "1": "娃哈哈矿泉水",
  "7": "娃哈哈纯净水",
  "5": "清紫源泉纯净水",
};

export interface WaterUserInformation {
  name: string;
  address: string;
}

/** 由订水编号查联系人/地址（water.ts getWaterUserInformation） */
export async function getWaterUserInformation(
  fetchLike: FetchLike,
  id: string,
): Promise<WaterUserInformation> {
  if (id.trim().length === 0) return { name: "", address: "" };
  const res = await fetchLike(WATER_USER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: "pw", param: id }).toString(),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as WaterUserInformation;
  } catch {
    throw new Error(`水站用户信息响应异常（HTTP ${res.status}）`);
  }
}

/** 提交订水（water.ts postWaterSubmission；响应含「成功」才算提交成功） */
export async function submitWaterOrder(
  fetchLike: FetchLike,
  order: { id: string; num: string; num1: string; lid: string; address: string },
): Promise<void> {
  const res = await fetchLike(WATER_SUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      pw: order.id,
      num: order.num,
      num1: order.num1,
      lid: order.lid,
      address: order.address,
    }).toString(),
  });
  const text = await res.text();
  if (!text.includes("成功")) {
    throw new Error(`订水提交失败（${text.slice(0, 60).replace(/\s+/g, " ") || `HTTP ${res.status}`}）`);
  }
}
