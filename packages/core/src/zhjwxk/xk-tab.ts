/**
 * 一级课表页签检索兜底（NextTHUxk 2.0 tabSearchByKch/parseTabGrid 回移）。
 * 根因：kkxxSearch 开课信息索引不命中 PK/GPK/BW 前缀课号——教务 web UI 是在
 * 任选页签的检索表单里搜到的（POST m=rxSearch + p_kch，存档表单实锤）。
 * 本模块保持零依赖（叶子），便于 strip-types 冒烟；XkCourse 结构类型由调用方
 * （zhjwxk/client.ts）保证，这里以最小结构面约束。
 */

export interface XkTabCourse {
  department: string;
  code: string;
  seq: string;
  name: string;
  credits: number;
  teacher: string;
  teacherId: string;
  capacity: number;
  remaining: number;
  gradCapacity: number;
  gradRemaining: number;
  time: string;
  note: string;
  feature: string;
  grade: string;
  tongshiGroup: string;
  attr: string;
  partial?: boolean;
}

/** 页签 gridData 行解析：14 列 [1]attr [3]课名 [4]课号 [5]课序 [6]时间 [7]教师 [8]学分；
 *  [0]radio value='SEM;课号;课序;' 为课序权威源。余量列页签无——partial 语义。 */
export function parseXkTabGrid(html: string, attr: string): XkTabCourse[] {
  const out: XkTabCourse[] = [];
  for (const seg of html.match(/gridData\w*\s*=\s*\[[\s\S]*?\];/g) ?? []) {
    const rows = seg.match(/\[\s*"(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")+\s*\]/g) ?? [];
    for (const row of rows) {
      const cells: string[] = [];
      const cre = /"((?:[^"\\]|\\.)*)"/g;
      let cm: RegExpExecArray | null;
      while ((cm = cre.exec(row)) !== null) cells.push(cm[1] ?? "");
      if (cells.length < 9) continue;
      const name = (cells[3] ?? "").replace(/<[^>]+>/g, "").trim();
      const code = (cells[4] ?? "").trim();
      if (!code || !name || !/\d/.test(code)) continue;
      let seq = (cells[5] ?? "").trim();
      const rid = /value='([^']*);([^']*);([^']*);'/.exec(cells[0] ?? "");
      if (rid && rid[2] === code && rid[3]) seq = rid[3];
      out.push({
        department: "",
        code,
        seq: seq || "0",
        name,
        credits: parseFloat(cells[8] ?? "") || 0,
        teacher: (cells[7] ?? "").trim(),
        teacherId: "",
        capacity: 0,
        remaining: 0,
        gradCapacity: 0,
        gradRemaining: 0,
        time: (cells[6] ?? "").trim(),
        note: "",
        feature: "",
        grade: "",
        tongshiGroup: "",
        attr: (cells[1] ?? "").replace(/<[^>]+>/g, "").trim() || attr,
        partial: true, // 未知≠已满：余量/志愿由按需补拉填充
      });
    }
  }
  return out;
}

/** 页签检索依赖注入面（保持叶子零依赖；由 zhjwxk/client.ts 传入真实实现）。 */
export interface XkTabDeps {
  get: (url: string) => Promise<string>;
  post: (url: string, fields: Record<string, string>) => Promise<string>;
  semester: () => Promise<string>;
  assertAlive: (html: string) => void;
  tokenRe: () => RegExp;
}

/** 页签检索：GET 带 p_kch 直查，无网格则取 token POST 重试（存档 doQuery() 原样）；
 *  任选→限选→必修逐页签试。 */
export async function searchXkCoursesByTab(
  deps: XkTabDeps,
  opts: { semester?: string; kch: string },
): Promise<XkTabCourse[]> {
  const semester = await deps.semester();
  const tabs: Array<{ m: string; flag: string; attr: string }> = [
    { m: "rxSearch", flag: "rx", attr: "任选" },
    { m: "xxSearch", flag: "xx", attr: "限选" },
    { m: "bxSearch", flag: "bx", attr: "必修" },
  ];
  for (const tab of tabs) {
    try {
      let fh = await deps.get(
        `/xkBks.vxkBksXkbBs.do?m=${tab.m}&p_xnxq=${semester}&tokenPriFlag=${tab.flag}&p_kch=${encodeURIComponent(opts.kch)}&_t=${Date.now()}`,
      );
      deps.assertAlive(fh);
      if (!/gridData\w*\s*=/.test(fh)) {
        const token = deps.tokenRe().exec(fh)?.[1];
        if (!token) continue;
        fh = await deps.post("/xkBks.vxkBksXkbBs.do", {
          m: tab.m,
          page: "",
          token,
          p_xnxq: semester,
          tokenPriFlag: tab.flag,
          p_kch: opts.kch,
          p_kcm: "",
          p_rxklxm: "",
        });
      }
      const rows = parseXkTabGrid(fh, tab.attr);
      if (rows.length) return rows;
    } catch {
      // 单页签失败继续下一个（fail-soft）
    }
  }
  return [];
}
