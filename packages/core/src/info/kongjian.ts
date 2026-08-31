/**
 * 学生宿舍公共空间预约（myhome.tsinghua.edu.cn/kongjian —— 学生公共空间示例页逆向）。
 *
 * 共享家园网（myhome）WebForms 页：__VIEWSTATE 状态链 + __doPostBack 回传。
 * 页面结构（kj_yuyue.aspx?xieyi=1，与 2026-09 示例快照一致）：
 *  - RadioButtonList1 = 公共空间（楼栋/活动中心，54 项）→ onchange 回传换页
 *  - RadioButtonList2 = 房间（空间内子房间，如 B1钢琴房/影音室）→ 回传
 *  - RadioButtonList3 = 日期（今起 7 天）→ 回传（__doPostBack 目标带 $索引）
 *  - lblinfo          = 当前选择提示（空间---房间，预约日期）
 *  - Repeater1        = 场次行：lbld_date/lbltime/lblstate + 可约行内 kj_yuyue2.aspx 预约链接
 *  - 确认页 kj_yuyue2.aspx?louhao_id=…&name1=…&name2=…&id2=…&d_date=…&d_time=…&d_time1=…
 *    （txtname/txtid/txttel/txtother + rbtnOK 承诺 + btnOK 确定预约）
 *  - 我的预约 kj_yuyue_my.aspx：表头 公共空间/预约时间/状态/评价/操作（操作含取消回传）
 *
 * 首次进入会 302 到 agreement.aspx，同意后带 ?xieyi=1 回来（客户端负责自动过协议）。
 */

export const KJ_PREFIX = "http://myhome.tsinghua.edu.cn/kongjian";
export const KJ_YUYUE = () => `${KJ_PREFIX}/kj_yuyue.aspx`;
export const KJ_AGREEMENT = () => `${KJ_PREFIX}/agreement.aspx`;
export const KJ_MY = () => `${KJ_PREFIX}/kj_yuyue_my.aspx`;

/** 家园网未登录判据（同电费/卫生：net_Default 登录控件） */
export function hasKongjianLogin(page: string): boolean {
  return page.length > 0 && !/net_Default_LoginCtrl1_txtUserName/i.test(page);
}

export interface KongjianSpace {
  id: string;
  name: string;
}

/** 公共空间下拉（RadioButtonList1 的 option 列表） */
export function parseKongjianSpaces(page: string): KongjianSpace[] {
  const i = page.indexOf("kj_yuyueCtrl1$RadioButtonList1");
  if (i < 0) return [];
  const seg = page.slice(i, i + 40000);
  const out: KongjianSpace[] = [];
  const re = /<option(?:\s+selected="selected")?\s+value="(\d+)">([^<]+)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) out.push({ id: m[1]!, name: decodeEntities(m[2]!.trim()) });
  return out;
}

export interface KongjianSlot {
  date: string;
  time: string;
  state: string;
  /** 可约时的确认页链接（kj_yuyue2.aspx?… 原样，可能带 %uXXXX 转义——直接整链使用） */
  bookUrl?: string;
}

export interface KongjianPage {
  spaces: KongjianSpace[];
  rooms: KongjianSpace[];
  dates: string[];
  selectedSpace?: string;
  selectedRoom?: string;
  selectedDate?: string;
  info?: string;
  slots: KongjianSlot[];
  /** WebForms 回传所需隐藏域（__VIEWSTATE 等，逐轮更新） */
  fields: Record<string, string>;
  formAction?: string;
}

/** 抽 WebForms 隐藏域（__EVENTTARGET/__VIEWSTATE/…）与表单 action */
export function parseWebForms(page: string, formName = "form1"): { fields: Record<string, string>; action?: string } {
  const fields: Record<string, string> = {};
  const action = new RegExp(
    `<form[^>]*name="${formName}"[^>]*action="([^"]*)"|<form[^>]*action="([^"]*)"[^>]*name="${formName}"`,
  ).exec(page);
  const fre = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"|<input[^>]*name="([^"]+)"[^>]*type="hidden"[^>]*value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = fre.exec(page)) !== null) {
    const name = m[1] ?? m[3];
    const val = m[2] ?? m[4];
    if (name) fields[name] = val ?? "";
  }
  return { fields, action: (action?.[1] ?? action?.[2]) || undefined };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 单选表（RadioButtonList2/3 的 table）：checked 项 + 全部 value/label */
function parseRadioTable(page: string, tableId: string): { items: KongjianSpace[]; selected?: string } {
  const i = page.indexOf(`id="kj_yuyueCtrl1_${tableId}"`);
  if (i < 0) return { items: [] };
  const segEnd = page.indexOf("</table>", i);
  const seg = page.slice(i, segEnd < 0 ? i + 60000 : segEnd);
  const items: KongjianSpace[] = [];
  let selected: string | undefined;
  const inputRe = /<input[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(seg)) !== null) {
    const raw = m[0];
    if (!raw.includes(`name="${tableId.replace(/_/g, "_")}`) && !raw.includes("RadioButtonList")) continue;
    if (!/type="radio"/.test(raw)) continue;
    if (!raw.includes('name="kj_yuyueCtrl1$')) continue;
    const value = /value="([^"]*)"/.exec(raw)?.[1] ?? "";
    const checked = /checked="checked"/.test(raw);
    const after = seg.slice(m.index + raw.length, m.index + raw.length + 220);
    const label = /<label[^>]*>([^<]*)<\/label>/.exec(after)?.[1]?.trim() ?? value;
    if (checked) selected = value;
    items.push({ id: value, name: decodeEntities(label) });
    if (items.length > 60) break;
  }
  return { items, selected };
}

/** 日期单选（RadioButtonList3）的回传目标：__doPostBack('…$索引','') */
export function parseDatePostBackTarget(page: string, date: string): string | null {
  const i = page.indexOf(`value="${date}"`);
  if (i < 0) return null;
  const seg = page.slice(Math.max(0, i - 400), i + 400);
  const m = /__doPostBack\((?:\\?&#39;|')([^\\&']+)/.exec(seg);
  return m?.[1] ?? null;
}

/** 整页解析（空间/房间/日期/场次/回传域） */
export function parseKongjianPage(page: string): KongjianPage {
  const spaces = parseKongjianSpaces(page);
  const rooms = parseRadioTable(page, "RadioButtonList2");
  const dates = parseRadioTable(page, "RadioButtonList3");
  const info = /lblinfo"[^>]*>([^<]*)</.exec(page)?.[1]?.trim();
  const slots: KongjianSlot[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(page)) !== null) {
    const row = rm[1]!;
    if (!row.includes("lbld_date")) continue;
    const date = /lbld_date[^>]*>([^<]*)</.exec(row)?.[1]?.trim() ?? "";
    const time = /lbltime[^>]*>([^<]*)</.exec(row)?.[1]?.trim() ?? "";
    const state = /lblstate[^>]*>([^<]*)</.exec(row)?.[1]?.trim() ?? "";
    const href = /href="([^"]*kj_yuyue2\.aspx[^"]*)"/.exec(row)?.[1];
    slots.push({
      date,
      time,
      state,
      bookUrl: href
        ? href.startsWith("http")
          ? href
          : `${KJ_PREFIX}/${href.replace(/^\.\//, "").replace(/^\//, "")}`
        : undefined,
    });
  }
  const wf = parseWebForms(page);
  const selectedSpace = /<option selected="selected" value="(\d+)"/.exec(page)?.[1];
  // 可约判定：官方状态「未预约」即可约（已被预约/已过期不可约）。
  // 预约链接优先取行内原链；缺失时按确认页参数构造（escape() 式 %uXXXX，与官网一致）。
  const spaceName = spaces.find((x) => x.id === selectedSpace)?.name ?? "";
  const roomName = rooms.items.find((x) => x.id === rooms.selected)?.name ?? "";
  const esc = (v: string) =>
    v.replace(/[^A-Za-z0-9_\-.!~*'()]/g, (c) =>
      c.charCodeAt(0) < 256 ? `%${c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}` : `%u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  const plus30 = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) return t;
    const total = Number(m[1]) * 60 + Number(m[2]) + 30;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  const dateFor = slots[0]?.date ?? "";
  for (const slot of slots) {
    const free = slot.state.length > 0 && !/已被预约|已过期|禁止/.test(slot.state);
    if (!free) continue;
    if (!slot.bookUrl && selectedSpace && rooms.selected) {
      slot.bookUrl =
        `${KJ_PREFIX}/kj_yuyue2.aspx?louhao_id=${selectedSpace}` +
        `&name1=${esc(spaceName)}&name2=${esc(roomName)}&id2=${rooms.selected}` +
        `&d_date=${encodeURIComponent(slot.date || dateFor)}` +
        `&d_time=${encodeURIComponent(slot.time)}&d_time1=${encodeURIComponent(plus30(slot.time))}`;
    }
  }
  return {
    spaces,
    rooms: rooms.items,
    dates: dates.items.map((x) => x.id),
    selectedSpace,
    selectedRoom: rooms.selected,
    selectedDate: dates.selected,
    info: info ? decodeEntities(info) : undefined,
    slots,
    fields: wf.fields,
    formAction: wf.action,
  };
}

/** WebForms 回传体：隐藏域 + 现有选中值 + __EVENTTARGET */
export function buildPostBack(page: KongjianPage, eventTarget: string, overrides: Record<string, string> = {}): string {
  const body = new URLSearchParams();
  body.set("__EVENTTARGET", eventTarget);
  body.set("__EVENTARGUMENT", "");
  for (const [k, v] of Object.entries(page.fields)) {
    if (k === "__EVENTTARGET" || k === "__EVENTARGUMENT") continue;
    body.set(k, v);
  }
  if (page.selectedSpace) body.set("kj_yuyueCtrl1$RadioButtonList1", page.selectedSpace);
  if (page.selectedRoom) body.set("kj_yuyueCtrl1$RadioButtonList2", page.selectedRoom);
  if (page.selectedDate) body.set("kj_yuyueCtrl1$RadioButtonList3", page.selectedDate);
  for (const [k, v] of Object.entries(overrides)) body.set(k, v);
  return body.toString();
}

export interface KongjianRecord {
  space: string;
  time: string;
  status: string;
  /** 取消回传目标（__doPostBack 的 target；无则不可取消） */
  cancelTarget?: string;
}

/** 我的预约表（kj_yuyue_my.aspx）：表头 公共空间/预约时间/状态/评价/操作 */
export function parseKongjianMy(page: string): KongjianRecord[] {
  const i = page.indexOf("预约时间");
  if (i < 0) return [];
  const seg = page.slice(i, i + 40000);
  const out: KongjianRecord[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(seg)) !== null) {
    const row = m[1]!;
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]!);
    if (cells.length < 5) continue;
    const text = (x: string) => decodeEntities(x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const space = text(cells[0]!);
    if (!space || space.includes("请您预约后")) continue; // 跳过须知行
    const cm = /__doPostBack\((?:\\?&#39;|')([^\\&']+)/.exec(cells[4]!);
    out.push({
      space,
      time: text(cells[1]!),
      status: text(cells[2]!),
      cancelTarget: (cm?.[1] ?? cm?.[2]) ?? undefined,
    });
  }
  return out;
}

/** 确认页已填值（服务端会预填姓名/学号/电话；lbltel 为只读手机号） */
export function parseKongjianConfirmValues(page: string): { name: string; sid: string; tel: string; date: string } {
  const val = (suffix: string) => {
    const re = new RegExp(`<input[^>]*name="[^"]*\\$${suffix}"[^>]*value="([^"]*)"|<input[^>]*value="([^"]*)"[^>]*name="[^"]*\\$${suffix}"`, "i");
    const m = re.exec(page);
    return (m?.[1] ?? m?.[2] ?? "").trim();
  };
  return {
    name: val("txtname"),
    sid: val("txtid"),
    tel: val("lbltel") || val("txttel"),
    date: val("txtdate"),
  };
}
