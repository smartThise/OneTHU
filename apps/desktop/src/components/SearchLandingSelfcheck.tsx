import { Btn } from "@onethu/gui";
/**
 * 检索落点自查路由（**仅 dev 构建**；release 里整块被 rollup 剥离，不进导航）。
 *
 * 打开方式：应用任意 URL 追加 `?searchland=selfcheck`（例如 `tauri://localhost/?searchland=selfcheck` 或
 * dev 服务的 http://localhost:1420/?searchland=selfcheck）。挂载 → 等 1.2s 应用稳定后开场。
 *
 * 做什么：对 state/searchRows 的**每一行**做真实检索（searchAll，与检索条同源）→ 调 goSearchRow
 * （与点行点击同一条链路）→ 轮询 DOM 验证落点 → console 打完整 45 行 hit/fallback 原因表
 * （console.table）+ 右下角「复制报告」面板（`data-set-id` / `.row-focus` 的 DOM 级证据）。
 *
 * 判级：
 *   hit         —— 注册表执行模型同源命中（searchAll 首位 = 本行）
 *   dom         —— DOM 找到行/按钮本体并高亮（.row-focus 落在 data-set-id 或按钮上）
 *   fallback    —— 有意落分节根 + note（可见性/无独立控件），console 说明原因
 *   miss        —— DOM 找不到行（唯一允许的失败型：先在下面报告里显形）
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { allSearchRows, familyOf, goSearchRow, type SearchRow } from "../state/searchRows.js";
import { searchAll } from "../state/searchAll.js";
import { showToast } from "../state/toast.js";
import { IconX } from "./Icons.js";
import { t as i18n } from "../i18n/index.js";


interface LandingRow {
  id: string;
  query: string;
  family: "settings" | "plugins";
  hit: "hit" | "ambiguous" | "no-top";
  landedOn: "row" | "section-root";
  domFocus: string;
  note: string;
}

interface SelfcheckReport {
  rows: LandingRow[];
  startedAt: string;
  durMs: number;
}

/* DOM 落点判定：本行数据锚点（row-<slug> 或显式 id）/按钮文本/分节根锚点 */
function classifyDom(row: SearchRow): string {
  const bc = row.breadcrumb ?? [];
  const main = `row-${(row.title || "").trim()}`;
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-set-id], .row-focus"));
  const focused = document.querySelector<HTMLElement>(".row-focus");
  if (!focused) return "";
  const tag = focused.dataset.setId || "";
  const txt = (focused.textContent ?? "").trim();
  if (tag === main || tag === `sec-${row.section}` || bc.includes(row.section)) return tag || txt.slice(0, 16);
  if (txt.includes(row.title) && focused.classList.contains("setting-row")) return tag || txt.slice(0, 16);
  if (txt.trim() === row.title.trim()) return (tag || "btn") + "首匹配";
  return "";
}

function SearchLandingSelfcheck(): ReactNode {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SelfcheckReport | null>(null);
  const reportRef = useRef<SelfcheckReport | null>(null);
  reportRef.current = report;
  const autostarted = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("searchland")) return;
    const mode = params.get("searchland");
    if (mode && mode !== "selfcheck") return;
    if (!document.body) return;
    if (autostarted.current) return;
    autostarted.current = true;
    const t = window.setTimeout(() => runSelfcheck(), 1200);
    return () => window.clearTimeout(t);
  }, []);

  const runSelfcheck = async (): Promise<void> => {
    setRunning(true);
    const t0 = Date.now();
    const rows = allSearchRows().sort((a, b) => a.id.localeCompare(b.id));
    const out: LandingRow[] = [];
    for (const row of rows) {
      // ① 同源模型级：searchAll 与检索条同源（行级首位 = 本行）
      const r = searchAll(row.title);
      const topId = r.rows[0]?.row.id ?? "";
      const hitKind: LandingRow["hit"] = topId === row.id ? "hit" : topId ? "ambiguous" : "no-top";
      let landedOn: LandingRow["landedOn"] = "row";
      let note = "";
      let bc: string[] = [];
      try {
        const res = goSearchRow(row);
        landedOn = res.landedOn;
        note = res.note ?? "";
        bc = res.breadcrumb;
      } catch (e) {
        note = `goSearchRow 异常：${String(e instanceof Error ? e.message : e).slice(0, 60)}`;
      }
      // ② DOM 级：等待 React 挂载/滚动/焦点 — 各行有小幅重试
      let domFocus = "";
      for (let i = 0; i < 22; i++) {
        await wait(120);
        domFocus = classifyDom(row);
        if (domFocus) break;
      }
      out.push({
        id: row.id,
        query: row.title,
        family: familyOf(row),
        hit: hitKind,
        landedOn,
        domFocus,
        note: domFocus || landedOn === "section-root"
          ? [note, bc.length ? bc.join("→") : ""].filter(Boolean).join(" ·")
          : `落点失焦（.row-focus 不见）：${note}`,
      });
          }
    const rep: SelfcheckReport = { rows: out, startedAt: new Date(t0).toLocaleTimeString("zh-CN", { hour12: false }), durMs: Date.now() - t0 };
    setReport(rep);
    setRunning(false);
    // ③ console：完整原因表 + 按分类小计
    console.table(out.map((x) => ({
      id: x.id,
      query: x.query,
      family: x.family,
      hit: x.hit === "hit" ? "✅" : x.hit === "ambiguous" ? "⚠️首位被别的行抢" : "⚠️检索首位不是本行",
      landedOn: x.landedOn === "row" ? "行" : "分节根",
      domFocus: x.domFocus ? x.domFocus : "(未见 .row-focus)",
      note: x.note,
    })));
    const passthrough = out.filter((x) => x.hit === "hit" && (x.landedOn === "row" ? !!x.domFocus : true));
    console.log(
      `%c[searchland] 45 行自查：hit ${out.filter((x) => x.hit === "hit").length}/45 · DOM 命中 ${out.filter((x) => !!x.domFocus).length}/45 · fallback(分节根+解释) ${out.filter((x) => x.landedOn === "section-root").length} · 失焦 ${out.length - passthrough.length}`,
      "background:#1233;color:#8bf;padding:2px 8px;border-radius:5px",
    );
  };

  const copyReport = async (): Promise<void> => {
    const rep = reportRef.current;
    if (!rep) return;
    const md = [
      `# 检索落点自查（${rep.startedAt}，${rep.durMs}ms）`,
      "",
      "| id | query | family | hit | landedOn | domFocus | note |",
      "|---|---|---|---|---|---|---|",
      ...rep.rows.map((x) => `| ${x.id} | ${x.query} | ${x.family} | ${x.hit} | ${x.landedOn} | ${x.domFocus || "—"} | ${x.note.replace(/\|/g, "｜").slice(0, 90)} |`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(md);
      showToast(i18n("auto.components.SearchLandingSelfcheck.msg1"));
    } catch {
      showToast(i18n("auto.components.SearchLandingSelfcheck.msg2"));
    }
  };

  if (!report) {
    // 幽灵卡片：给 user 手感的进度卡片（Touching test with running 状态）。
    if (!running) return null;
    return (
      <div className="selfcheck-card" role="status" aria-live="polite">
        {i18n("auto.components.SearchLandingSelfcheck.1")}</div>
    );
  }
  const miss = report.rows.filter((x) => x.hit !== "hit" || (!x.domFocus && x.landedOn !== "section-root"));
  return (
    <div className="selfcheck-card" role="region" aria-label={i18n("auto.components.SearchLandingSelfcheck.2")}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b>{i18n("auto.components.SearchLandingSelfcheck.3")}</b>
        <span style={{ color: "var(--text-3)" }}>hit {report.rows.filter((x) => x.hit === "hit").length}{i18n("auto.components.SearchLandingSelfcheck.4")}{report.rows.filter((x) => x.landedOn === "section-root").length}</span>
        <span style={{ flex: 1 }} />
        <Btn variant="solid" tone="brand" onClick={() => void copyReport()}>{i18n("auto.components.SearchLandingSelfcheck.5")}</Btn>
        <Btn variant="ghost" aria-label={i18n("auto.components.SearchLandingSelfcheck.6")} onClick={() => setReport(null)}><IconX width={14} height={14} /></Btn>
      </div>
      {miss.length ? (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {miss.slice(0, 8).map((x) => (
            <li key={x.id} style={{ fontSize: 12, color: "var(--text-2)" }}>
              {x.id}：{x.hit !== "hit" ? "行级首位不是自己" : "DOM 未落"}（{x.note}）
            </li>
          ))}
        </ul>
      ) : null}
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>{i18n("auto.components.SearchLandingSelfcheck.7")}</div>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** envPn：environment 前置检查（简单判 guard not in 测试桩环境）。 */


export default SearchLandingSelfcheck;
