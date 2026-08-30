/**
 * 教室资源 —— thu-info-lib basics.ts getClassroomList / getClassroomState 的纯解析层
 * （逐字移植；I/O 与 zhjw 业务漫游在 client.ts 挂载）。
 *
 * - 列表：教室查询页链接 href 内嵌 classroom=<查询名>&weeknumber=<周>，逐链接提取
 *   （lib 限定 .w30 a[href^="/http/"]；此处以 href 含 classroom= 为同一有效过滤，
 *   因查询页仅这些链接带该参数）。
 * - 状态：#weeknumber option 值 = 可查周次；7 个 colspan=6 单元格括号内 = 本周日期；
 *   #scrollContent 内 tbody 逐行 = 教室，td[3:] 的 class（onteaching/onexam/
 *   onborrowed/ondisabled/无）映射状态（同 lib，多 class 即抛错）。
 * - arbitraryEncodeGb2312：lib utils/network arbitraryEncode(s,"gb2312") 等价 ——
 *   仅 [\u4e00-\u9fa5] 逐字 GB2312 编码为 %xx（小写），其余字符原样保留。
 *   GB2312 码表用 TextDecoder("gbk") 对全部区位惰性反查构建；无 GBK 解码器环境
 *   回退 encodeURIComponent（best effort）。
 */
import { ClassroomStatus } from "./types.js";
import type { Classroom, ClassroomState, ClassroomStateResult } from "./types.js";
import { cellText, decodeHtmlEntities, findAttr, innerOfTd, tdCells } from "./htmltext.js";

let GB_TABLE: Map<string, string> | null | undefined;

/** GB2312 码表：区位双字节 → 汉字（TextDecoder("gbk") 反查，惰性构建一次） */
function gb2312Table(): Map<string, string> | null {
  if (GB_TABLE !== undefined) return GB_TABLE;
  GB_TABLE = null;
  try {
    const dec = new TextDecoder("gb2312");
    const map = new Map<string, string>();
    for (let hi = 0xa1; hi <= 0xf7; hi++) {
      for (let lo = 0xa1; lo <= 0xfe; lo++) {
        const ch = dec.decode(new Uint8Array([hi, lo]));
        const code = ch.codePointAt(0) ?? 0;
        // 仅收 \u4e00-\u9fa5（arbitraryEncode 只编码该区间；GBK 超集全覆盖）
        if (code >= 0x4e00 && code <= 0x9fa5 && !map.has(ch)) {
          map.set(ch, `%${hi.toString(16)}%${lo.toString(16)}`);
        }
      }
    }
    if (map.size > 0) GB_TABLE = map;
  } catch {
    GB_TABLE = null;
  }
  return GB_TABLE;
}

/** lib arbitraryEncode(s, "gb2312") 等价：仅汉字转 %xx，其余原样 */
export function arbitraryEncodeGb2312(s: string): string {
  const map = gb2312Table();
  if (!map) return s.replace(/[\u4e00-\u9fa5]/g, (c) => encodeURIComponent(c));
  return s.replace(/[\u4e00-\u9fa5]/g, (c) => map.get(c) ?? c);
}

/** 教学楼列表（lib getClassroomList）；空列表返回 []（client 层决定报错语义） */
export function parseClassroomList(html: string): Classroom[] {
  const out: Classroom[] = [];
  for (const a of html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(a[1] ?? "");
    const m = /classroom=(.+?)&weeknumber=(\d+)/.exec(href);
    if (m === null) continue;
    out.push({
      name: cellText(a[2] ?? ""),
      weekNumber: Number(m[2]),
      searchName: m[1] ?? "",
    });
  }
  return out;
}

/** 教室状态行 class → 状态值（lib getClassroomState switch 逐字） */
function statusFromClassName(cls: string | undefined): ClassroomStatus {
  switch (cls) {
    case "onteaching":
      return ClassroomStatus.TEACHING;
    case "onexam":
      return ClassroomStatus.EXAM;
    case "onborrowed":
      return ClassroomStatus.BORROWED;
    case "ondisabled":
      return ClassroomStatus.DISABLED;
    case undefined:
      return ClassroomStatus.AVAILABLE;
    default:
      throw new Error(`教室状态未知 class：${cls}`);
  }
}

/**
 * 教室占用状态页解析（lib getClassroomState）。结构缺失抛普通 Error（client 层
 * 按「超时页/WebVPN 门户页 → 会话失效，否则 ServiceUnavailable」归类）。
 */
export function parseClassroomState(html: string, week: number): ClassroomStateResult {
  // 可查周次（lib $("#weeknumber option")）
  const sel = /<select[^>]*id=["']weeknumber["'][^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1] ?? "";
  const validWeekNumbers = [...sel.matchAll(/<option[^>]*value=["']?(\d+)["']?[^>]*>/gi)].map((m) =>
    Number(m[1]),
  );

  // 本周 7 天日期（lib $("[colspan=6]") 前 7 个，取括号内文本）
  const dates: string[] = [];
  for (const cell of html.matchAll(/<t[dh]\b[^>]*colspan=["']6["'][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
    if (dates.length >= 7) break;
    const r = /\((.+?)\)/.exec(cellText(cell[1] ?? ""));
    if (r === null) throw new Error("教室状态页日期单元格无括号日期（页面结构变化）");
    dates.push(r[1] ?? "");
  }
  if (dates.length < 7) {
    throw new Error(`教室状态页日期单元格不足 7 个（实得 ${dates.length}）`);
  }

  // 教室占用。真实页结构（16:41 落盘实证）：数据行 = td0=教室名(width 218) +
  // td1..42=状态格（7 天 × 6 大节，周一起）；表头行（星期+7 个 colspan6 日期）只有
  // 8 个 td，用 cells.length>=20 过滤。lib children[] 索引含文本节点（children[1]=
  // 首个 td，slice(3) 滤 td 后=除名格外全部状态格），换算成 td 下标即 0=名、1:=状态。
  // 仅解析 scrollContent 标记之后的区域（lib $("#scrollContent>table>tbody") 语义，
  // 页内另有一份无滚动条的镜像表，两份全解析会重复）。
  const classroomStates: ClassroomState[] = [];
  const scIdx = html.search(/id=["']scrollContent["']/i);
  const region = scIdx >= 0 ? html.slice(scIdx) : html;
  for (const tbody of region.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    for (const tr of (tbody[1] ?? "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = tdCells(tr[1] ?? "");
      if (cells.length < 20) continue; // 表头/图例行（8 td）不是教室行
      const name = cellText(innerOfTd(cells[0] ?? ""));
      const status: ClassroomStatus[] = [];
      for (const td of cells.slice(1)) {
        // class 拆分后剔除 colBound（lib 同款过滤），多 class 即抛错
        const classNames = (findAttr(td, "class") ?? "")
          .split(" ")
          .filter((it) => it !== "" && it !== "colBound");
        if (classNames.length > 1) {
          throw new Error(`教室状态单元格多 class：${classNames.join(" ")}`);
        }
        status.push(statusFromClassName(classNames[0]));
      }
      if (name !== "") classroomStates.push({ name, status });
    }
  }
  return {
    validWeekNumbers,
    currentWeekNumber: week,
    datesOfCurrentWeek: dates as ClassroomStateResult["datesOfCurrentWeek"],
    classroomStates,
  };
}
