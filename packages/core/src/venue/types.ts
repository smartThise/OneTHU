/**
 * 体育场馆系统数据类型 —— 对齐抓包响应（sports_venue_crawl/api/*，2026-08-31）。
 * 字段名逐字（sessionVo / userFeeDetails / reserveStatus…），未用到的字段不声明。
 */

/** 场馆（/api/site/scene/list 与 scene/detail 共用；detail 多 intro 等展示字段） */
export interface VenueScene {
  uuid: string;
  sceneName: string;
  icon?: string;
  intro?: string;
  openTime?: string;
  telPhone?: string;
  status?: string;
  sceneUseType?: number | string;
  relatedType?: string | null; // 关联资源类型（current/page 的 siteType 参数，一般 "DEV"）
}

/** 场次（sessionVo——current/page 内嵌；时段+余量+价格+预约状态） */
export interface VenueSession {
  uuid: string;
  beginDate: number; // 20260901 形式
  endDate: number;
  beginTime: string; // "13:30"
  endTime: string; // "15:00"
  allowUserNum: number;
  resvUserNum: number;
  sceneUseType?: string | null;
  timeType?: string | null; // HOLS 节假日 / WORK 等
  reserveStatus?: {
    reserveStatus: string; // "Y" | "N"
    reserveStatusReason?: string;
    code?: number;
  } | null;
  userFeeDetails?: {
    chargingMode?: number; // 1=计费
    chargingUnitPrice?: number; // 分
    payType?: number;
  } | null;
}

/** 场地（current/page data 元素；位置树/开放规则/人限） */
export interface VenueSite {
  uuid: string;
  siteName: string;
  sceneUuid: string;
  siteType: string; // "DEV"
  openState?: number;
  status?: string;
  roomStatus?: string;
  kindId?: string;
  kindName?: string;
  sceneUseType?: string | null;
  supportPeriod?: string; // "Y"|"N"
  userRange?: { lowerRange: number; includeLow: boolean; upperRange: number; includeUpper: boolean } | null;
  siteLocation?: {
    campusName?: string;
    buildingName?: string;
    floorName?: string;
    roomName?: string;
    location?: string;
  } | null;
  openRule?: {
    fullOpenTime?: Array<{
      timeType?: string; // MON..SUN
      timeRange?: Array<{ startTime: string; endTime: string }>;
    }>;
  } | null;
  sessionVo?: VenueSession[] | null;
  formRuleVo?: { formUuid?: string | null } | null;
}

/** 我的预约记录（/api/reserve/reserveRecord data 元素；字段以抓包为准，宽松可选） */
export interface VenueRecord {
  uuid?: string;
  resvUuid?: string;
  siteName?: string;
  sceneName?: string;
  beginTime?: string;
  endTime?: string;
  resvDate?: string;
  resvStatus?: number | string;
  resvCheckStatus?: number | string;
  payStatus?: number | string;
  orderAmount?: number | string;
  [key: string]: unknown;
}

/** 场馆系统登录用户（/system/login/getLoginUser） */
export interface VenueUser {
  id?: string;
  name?: string;
  username?: string;
  [key: string]: unknown;
}

/** 楼栋（chooseByType siteType=BUILDING） */
export interface VenueBuilding {
  uuid: string;
  siteName?: string | null;
}

/** 设备/场地类型（devKind/list，如"全场/羽毛球/半场"） */
export interface VenueDevKind {
  uuid: string;
  devKindName?: string | null;
}

/** sameLevel 返回的同类型子场景（含 sceneUseType 位掩码：1=NORMAL 2=SPORT_GROUP 4=SPORT_PERSON） */
export interface VenueSceneLite {
  id?: string | null;
  uuid: string;
  sceneName?: string | null;
  sceneUseType?: number | null;
  status?: string | null;
  relatedType?: string | null;
}

/** sameLevel 响应 */
export interface VenueSameLevel {
  sceneTypeName?: string | null;
  sceneTypeUuid?: string | null;
  siteSceneList?: VenueSceneLite[] | null;
}
