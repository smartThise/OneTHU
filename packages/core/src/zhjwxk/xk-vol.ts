/**
 * 志愿统计（NextTHUxk 2.0 院系定向实时拉取回移，v1.5.1 三改定稿）。
 * 数据源 = 教务「按人头统计」页 xkBksZytjb.do：
 *   BR（tbzySearchBR）9 列：课号/序号/课名/开课系/容量/已报/必修/限选/任选志愿
 *   Ty（tbzySearchTy）6 列：课号/序号/课名/容量/已报/体育志愿
 * 关键事实（存档表单 AI选课分析系统/志愿查询_files/xkBks.xkBksZytjb.html）：
 *   ① 该页唯一筛选字段是 p_lrdwnm = 院系代码下拉，没有课号筛选——p_kch 被
 *      服务端无视（fetchXkVolCourse 的 p_kch 是表单自带的查询框，POST 才生效）。
 *   ② Ty 页表单无 p_lrdwnm（体育志愿无院系轴）→ 池含体育课时全量拉 ≤20 页。
 * 用户定稿：任何数据不整库预爬——旧版 tbzySearchBR/Ty 全库硬爬 ≤220 页是死码。
 * 本模块保持零依赖（叶子），便于 strip-types 冒烟。
 */

/** 志愿行（比 XkVolInfo 多 code/seq/department：错页校验与三段匹配需要） */
export interface XkVolRow {
  code: string;
  seq: string;
  department: string;
  capacity: number;
  applied: number;
  volRequired: string;
  volElective: string;
  volOptional: string;
  volSports: string;
}

/** 课序号归一：教务各页前导零不一致（志愿统计 "1" vs 选课页 "01"） */
export const normSeq = (s: string): string => String(parseInt(s, 10) || 0);

/** 院系名 → 院系代码（86 项，存档下拉全量） */
export const XK_DEPT_CODES: Record<string, string> = {
  建筑学院: "000",
  城规系: "001",
  建筑系: "002",
  土木系: "003",
  水利系: "004",
  环境学院: "005",
  机械系: "012",
  精仪系: "013",
  能动系: "014",
  车辆学院: "015",
  工业工程系: "016",
  电机系: "022",
  电子系: "023",
  计算机系: "024",
  自动化系: "025",
  集成电路学院: "026",
  航院: "031",
  工物系: "032",
  化工系: "034",
  材料学院: "035",
  数学系: "042",
  物理系: "043",
  化学系: "044",
  生命学院: "045",
  地学系: "046",
  交叉信息院: "047",
  高研院: "048",
  经管学院: "051",
  公管学院: "059",
  金融学院: "060",
  中文系: "063",
  外文系: "064",
  法学院: "066",
  新闻学院: "067",
  马克思主义学院: "068",
  人文学院: "069",
  社科学院: "070",
  体育部: "072",
  图书馆: "075",
  艺教中心: "078",
  美术学院: "080",
  统计系: "088",
  建管系: "091",
  天文系: "092",
  安全学院: "093",
  人工智能学院: "094",
  心理系: "095",
  卫健学院: "096",
  苏世民书院: "097",
  建筑技术: "099",
  核研院: "101",
  教育学院: "103",
  训练中心: "151",
  电工电子中心: "155",
  学生部: "207",
  武装部: "209",
  教务处: "254",
  研究生院: "255",
  校医院: "305",
  药学院: "402",
  临床医学院: "405",
  软件学院: "410",
  网络研究院: "412",
  地区研究院: "413",
  航发院: "415",
  语言中心: "420",
  新雅书院: "470",
  致理书院: "471",
  日新书院: "472",
  未央书院: "473",
  行健书院: "475",
  求真书院: "476",
  为先书院: "477",
  秀钟书院: "478",
  笃实书院: "479",
  紫荆书院: "482",
  自强书院: "483",
  水木书院: "484",
  数学教学中心: "492",
  医学院: "500",
  基础医学院: "501",
  生医工程学院: "502",
  医疗管理学院: "503",
  国际研究生院: "599",
  清华大学全球创新学院: "601",
};

/** 院系名 → 码（精确优先，双向 includes 兜底；外校课无志愿数据自然 miss） */
export const deptCodeOf = (dept: string): string => {
  const d = (dept || "").trim();
  if (!d) return "";
  if (XK_DEPT_CODES[d]) return XK_DEPT_CODES[d];
  const hit = Object.keys(XK_DEPT_CODES).find((k) => d.includes(k) || k.includes(d));
  return hit ? (XK_DEPT_CODES[hit] ?? "") : "";
};

/** BR 9 列行解析（v1.5.1 定稿）：
 *  - 第 4 列开课系捕获（错页校验用：拉回的页里得有本院系的行才算数）
 *  - 墓碑行过滤（用户十七报：10780102 全零 = 已满课不在志愿池；不过滤会
 *    拿 kkxx 容量造「0/N 宽松 + 满屏假 100%」）。报名>0 的 0 容量行保留（超载=真信号）
 *  - 键归一 code_normSeq（前导零） */
export function parseVolRows(html: string): Record<string, XkVolRow> {
  const map: Record<string, XkVolRow> = {};
  const re = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"([^"]*?)"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!(parseInt(m[4] ?? "") || 0) && !(parseInt(m[5] ?? "") || 0)) continue; // 墓碑行
    const key = `${m[1]}_${normSeq(m[2] ?? "")}`;
    map[key] = {
      code: m[1] ?? "",
      seq: m[2] ?? "",
      department: (m[3] ?? "").trim(),
      capacity: parseInt(m[4] ?? "") || 0,
      applied: parseInt(m[5] ?? "") || 0,
      volRequired: m[6] ?? "",
      volElective: m[7] ?? "",
      volOptional: m[8] ?? "",
      volSports: "",
    };
  }
  return map;
}

/** Ty 6 列行解析（体育志愿；无院系轴）：墓碑行同滤 + 键归一 */
export function parseVolSportsRows(html: string): Record<string, XkVolRow> {
  const map: Record<string, XkVolRow> = {};
  const re = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!(parseInt(m[3] ?? "") || 0) && !(parseInt(m[4] ?? "") || 0)) continue; // 墓碑行
    const key = `${m[1]}_${normSeq(m[2] ?? "")}`;
    map[key] = {
      code: m[1] ?? "",
      seq: m[2] ?? "",
      department: "",
      capacity: parseInt(m[3] ?? "") || 0,
      applied: parseInt(m[4] ?? "") || 0,
      volRequired: "",
      volElective: "",
      volOptional: "",
      volSports: m[5] ?? "",
    };
  }
  return map;
}

/** 分页信息（共 N 页/共 N 条） */
export function parsePagerInfo(html: string): { pages: number; total: number } {
  const pages = /共\s*(\d+)\s*页/.exec(html);
  const total = /共\s*([\d,，]+)\s*条/.exec(html);
  return {
    pages: pages ? parseInt(pages[1] ?? "") || 0 : 0,
    total: total ? parseInt((total[1] ?? "").replace(/[,，]/g, "")) || 0 : 0,
  };
}

/** 三段匹配（用户实锤「5/2」张冠李戴事故）：志愿统计页的课序号与选课页
 *  前导零不一致（存档 Ty 行 "10720011","1" vs 一级课表/搜索行 "01"）——
 *  ① 原始键 ② 归一化键（parseInt 去前导零）③ 逐行归一比对；
 *  段对不上且该课多段时**宁缺毋滥**（旧 byCode 任意取首段 = 拿别的班的
 *  容量/报名人数冒充本班），单段才允许回退。 */
export function matchVolRow<T extends { code?: string; seq?: string }>(
  volMap: Record<string, T>,
  code: string,
  seq: string,
): T | undefined {
  const byCode: T[] = [];
  for (const v of Object.values(volMap)) if (v.code === code) byCode.push(v);
  return (
    volMap[`${code}_${seq || "0"}`] ??
    volMap[`${code}_${normSeq(seq)}`] ??
    byCode.find((r) => normSeq(r.seq ?? "") === normSeq(seq)) ??
    (byCode.length === 1 ? byCode[0] : undefined)
  );
}

/** 按课号分组索引（buildRows 每轮构建一次，避免逐行全表扫描） */
export function buildVolIndex<T extends { code?: string; seq?: string }>(volMap: Record<string, T>): Map<string, T[]> {
  const idx = new Map<string, T[]>();
  for (const v of Object.values(volMap)) {
    if (!v.code) continue;
    const arr = idx.get(v.code);
    if (arr) arr.push(v);
    else idx.set(v.code, [v]);
  }
  return idx;
}

/** 三段匹配（索引版）：语义同 matchVolRow，配合 buildVolIndex 使用 */
export function matchVolIndexed<T extends { code?: string; seq?: string }>(
  idx: Map<string, T[]>,
  volMap: Record<string, T>,
  code: string,
  seq: string,
): T | undefined {
  const rows = idx.get(code);
  return (
    volMap[`${code}_${seq || "0"}`] ??
    volMap[`${code}_${normSeq(seq)}`] ??
    rows?.find((r) => normSeq(r.seq ?? "") === normSeq(seq)) ??
    (rows && rows.length === 1 ? rows[0] : undefined) // 多段不盲配
  );
}

/** 志愿串解析（NextTHUxk 2.0 probability.js parseVolArr 逐字）：
 *  "(2)12,8,0" → { prefix: 2, counts: [12,8,0] }。
 *  志愿串 = 当前阶段开放志愿级的密集列表（从高到低 → 右对齐补 0）：
 *    3 个 = 一/二/三志愿（旧全阶段）；1 个 = 仅第三志愿（新生预选「(1)2」/「2」）。
 *  缺的高志愿位补 0（该阶段没人能填）。绝不再因数量 <3 整串判 null
 *  （旧版就是这里把新生预选的志愿数据全吃了）。 */
export function parseVolStr(v: string): { prefix: number; counts: number[] } | null {
  const str = (v || "").trim();
  if (!str) return null;
  const priMatch = /^\((\d+)\)/.exec(str);
  const prefix = priMatch ? parseInt(priMatch[1] ?? "") || 0 : 0;
  const cleaned = str.replace(/^\(\d+\)/, "").trim();
  const nums = cleaned ? cleaned.match(/\d+/g) : null;
  if (!nums || !nums.length) {
    // 纯优先志愿「(N)」：无分级数据，仅优先人数
    return prefix > 0 ? { prefix, counts: [0, 0, 0] } : null;
  }
  const vals = nums.map((n) => parseInt(n, 10) || 0);
  const counts = [0, 0, 0];
  const base = 3 - Math.min(3, vals.length);
  for (let i = 0; i < Math.min(3, vals.length); i++) counts[base + i] = vals[i] ?? 0;
  return { prefix, counts };
}
