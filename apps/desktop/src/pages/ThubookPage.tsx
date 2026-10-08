import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stripInlineColors } from "../lib/htmlTheme.js";
import type { ReactNode } from "react";
import { Card, PageHead } from "../components/Layout.js";
import { universalFetch } from "../lib/transport.js";
import { ErrorLine } from "../components/Details.js";

/** THUbook（thubook.help，VuePress 2 预渲染静态站）内嵌阅读器。
 *  目录 = 抓各分组页预渲染侧边栏（带汉字标题，sitemap 只有拼音文件名）；
 *  正文 = <main> 提取（剔除 icon/svg 壳层、图片补全域名+限高）；
 *  x-frame-options: DENY → 不能 iframe。 */

const BASE = "https://thubook.help";
const CACHE = new Map<string, { title: string; html: string }>();

interface TocGroup {
  label: string;
  path: string;
  children: Array<{ label: string; path: string }>;
}

/** 从预渲染 HTML 抽侧边栏目录（组级链接 + 各组子链接，全部带汉字） */
function extractSidebar(html: string): { title: string; groups: TocGroup[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title: string = doc.querySelector("title")?.textContent?.trim()?.replace(/ - .*/, "") ?? "";
  const groups: TocGroup[] = [];
  const seenGroup = new Set<string>();
  doc.querySelectorAll(".sidebar-links > .sidebar-link, .sidebar > .sidebar-links > div > a").forEach((a) => {
    const href = a.getAttribute("href")?.split("#")[0];
    const label = a.textContent?.trim();
    if (!href || !label || seenGroup.has(href)) return;
    seenGroup.add(href);
    groups.push({ label, path: href, children: [] });
  });
  // 组内子页：sidebar-sub-headers 前的分组区块各自配对太脆——直接全站 a 去重兜底
  if (!groups.length) {
    doc.querySelectorAll(".sidebar a[href^='/thubook/']").forEach((a) => {
      const href = a.getAttribute("href")?.split("#")[0];
      const label = a.textContent?.trim();
      if (!href || !label || seenGroup.has(href)) return;
      seenGroup.add(href);
      groups.push({ label, path: href, children: [] });
    });
  }
  return { title, groups };
}

/** 正文提取：main 优先；剔除 script/style/icon/svg/导航壳；img 补域名+限高；链接改绝对 */
function extractMain(html: string): { title: string; html: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script, style, nav, header, footer, .navbar, .sidebar, svg, .iconfont, [class*=icon]")
    .forEach((n) => n.remove());
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("/")) img.setAttribute("src", BASE + src);
    else if (/^https?:\/\//.test(src) === false) img.setAttribute("src", BASE + "/thubook/" + src.replace(/^\.\//, ""));
    img.setAttribute("loading", "lazy");
  });
  doc.querySelectorAll("a[href^='/']").forEach((a) => {
    a.setAttribute("href", BASE + (a.getAttribute("href") ?? ""));
  });
  const main = doc.querySelector("main") ?? doc.querySelector(".theme-hope-content") ?? doc.body;
  const title = doc.querySelector("title")?.textContent?.trim() ?? "";
  // 源站正文带行内颜色会压过主题令牌（深色主题下正文仍是黑字，用户实录 2026-09-20）
  // → 出解析时就去色，正文颜色一律由 .thubook-body 继承主题令牌
  return { title, html: stripInlineColors(main?.innerHTML ?? "") };
}

function groupOf(path: string): string {
  const parts = decodeURIComponent(path).replace(/\.html$/, "").split("/").filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] as string) : "";
}

const BODY_STYLE = `
.thubook-body { font-size: 14px; line-height: 1.75; color: var(--text-1); max-width: 760px; margin: 0 auto; }
.thubook-body h1, .thubook-body h2, .thubook-body h3, .thubook-body h4 { margin: 1.2em 0 .5em; line-height: 1.4; }
.thubook-body h1 { font-size: 1.45em; } .thubook-body h2 { font-size: 1.25em; } .thubook-body h3 { font-size: 1.1em; }
.thubook-body p { margin: .6em 0; }
.thubook-body ul, .thubook-body ol { padding-left: 1.5em; margin: .5em 0; }
.thubook-body li { margin: .25em 0; }
.thubook-body a { color: var(--accent); text-decoration: none; }
@media (hover: hover) and (pointer: fine) {
  .thubook-body a:hover { text-decoration: underline; }
}
.thubook-body code { background: var(--surface-3); padding: .1em .4em; border-radius: 4px; font-size: .9em; }
.thubook-body pre { background: var(--surface-3); padding: 12px; border-radius: 8px; overflow-x: auto; }
.thubook-body pre code { background: none; padding: 0; }
.thubook-body table { border-collapse: collapse; margin: .8em 0; width: 100%; display: block; overflow-x: auto; }
.thubook-body th, .thubook-body td { border: 1px solid var(--border); padding: 6px 10px; font-size: 13px; }
.thubook-body th { background: var(--surface-3); }
.thubook-body blockquote { border-left: 3px solid var(--border); margin: .8em 0; padding: .2em 1em; color: var(--text-2); }
.thubook-body img { max-width: min(100%, 480px); max-height: 320px; height: auto; border-radius: 8px; display: block; margin: .6em 0; }
.thubook-body hr { border: none; border-top: 1px solid var(--border); margin: 1.2em 0; }
@media (max-width: 839.98px) {
  .thubook-shell { grid-template-columns: 1fr !important; height: auto !important; }
  .thubook-toc { max-height: 180px; }
}
`;

export default function ThubookPage(): ReactNode {
  const [groups, setGroups] = useState<TocGroup[]>([]);
  const [current, setCurrent] = useState<string>("/thubook/");
  const [page, setPage] = useState<{ title: string; html: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tocLoading, setTocLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 目录：抓首页侧边栏（组级）→ 并发抓各组页侧边栏合并子页（限 6 路）
  useEffect(() => {
    void (async () => {
      try {
        const home = await universalFetch(`${BASE}/thubook/`);
        const homeText = await home.text();
        if (!home.ok) throw new Error(`手册页暂时打不开，请稍后再试：HTTP ${home.status}`);
        const homeExt = extractSidebar(homeText);
        const top = homeExt.groups.length ? homeExt.groups : [{ label: "手册首页", path: "/thubook/", children: [] }];
        const cache: Map<string, { title: string; html: string }> = new Map();
        cache.set("/thubook/", extractMain(homeText));
        const results: TocGroup[] = [...top];
        let idx = 0;
        const workers = Array.from({ length: Math.min(6, top.length) }, async () => {
          while (idx < top.length) {
            const g = top[idx++] as TocGroup;
            if (CACHE.has(g.path)) cache.set(g.path, CACHE.get(g.path)!);
            else {
              try {
                const res = await universalFetch(`${BASE}${g.path}`);
                if (!res.ok) continue;
                const text = await res.text();
                cache.set(g.path, extractMain(text));
                const sub = extractSidebar(text);
                const kids: Array<{ label: string; path: string }> = [];
                const seen = new Set<string>([g.path]);
                for (const s of sub.groups) {
                  if (seen.has(s.path)) continue;
                  seen.add(s.path);
                  kids.push({ label: s.label, path: s.path });
                }
                results[results.findIndex((r) => r.path === g.path)] = { ...g, children: kids };
              } catch {
                /* 单组失败不影响其他组 */
              }
            }
          }
        });
        await Promise.all(workers);
        for (const [k, v] of cache) CACHE.set(k, v);
        setGroups(results);
        const home2 = CACHE.get("/thubook/");
        if (home2) setPage(home2);
      } catch (e) {
        setErr(`目录加载失败：${e instanceof Error ? e.message : String(e)}（检查网络）`);
      } finally {
        setTocLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async (rawPath: string): Promise<void> => {
    // 规范化（服务器语义实测 2026-09-19）：/thubook/xxx.html → 308，/thubook/xxx → 200，
    // /thubook/xxx/ → 308——统一剥 .html 后缀即可；目录根 /thubook/ 保持原样。
    const path = rawPath.replace(/\.html$/i, "");
    const hit = CACHE.get(path);
    if (hit) {
      setCurrent(path);
      setPage(hit);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const res = await universalFetch(`${BASE}${path}`);
      if (!res.ok) throw new Error(`手册页暂时打不开，请稍后再试：HTTP ${res.status}`);
      const ext = extractMain(await res.text());
      CACHE.set(path, ext);
      setCurrent(path);
      setPage(ext);
    } catch (e) {
      setErr(`页面加载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 正文链接拦截：站内 → 阅读器跳转；外链 → 系统浏览器
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onClick = (ev: Event): void => {
      const a = (ev.target as HTMLElement | null)?.closest?.("a");
      const href = a?.getAttribute("href") ?? "";
      if (!a || !href) return;
      ev.preventDefault();
      if (href.startsWith(`${BASE}/`)) {
        void load(href.slice(BASE.length).split("#")[0] || "/thubook/");
      } else if (href.startsWith("/") && !href.startsWith("//")) {
        void load(href.split("#")[0] || "/thubook/");
      } else if (/^https?:\/\//.test(href)) {
        void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href)).catch(() => undefined);
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [page, load]);

  const qLower = q.toLowerCase();
  const visible = useMemo(
    () =>
      groups
        .map((g) => {
          const kids = qLower ? g.children.filter((c) => c.label.toLowerCase().includes(qLower) || groupOf(c.path).includes(qLower)) : g.children;
          const selfHit = !qLower || g.label.toLowerCase().includes(qLower) || kids.length > 0;
          return selfHit ? { ...g, children: kids } : null;
        })
        .filter((g): g is TocGroup => g !== null),
    [groups, qLower],
  );

  return (
    <>
      <PageHead title="THUbook" meta="清华手册 · thubook.help" />
      <style>{BODY_STYLE}</style>
      <div className="thubook-shell" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 10, height: "calc(100vh - 150px)" }}>
        <Card className="thubook-toc" style={{ overflowY: "auto", padding: 10 }}>
          <input
            className="input"
            placeholder="搜索手册…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", marginBottom: 8, fontSize: 12.5 }}
          />
          {tocLoading ? <div style={{ fontSize: 12, color: "var(--text-3)" }}>目录加载中…</div> : null}
          <div style={{ display: "grid", gap: 2 }}>
            {visible.map((g) => {
              return (
                <div key={g.path}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      onClick={() => void load(g.path)}
                      style={{
                        flex: 1, textAlign: "left", fontSize: 13, fontWeight: 700, padding: "7px 8px", borderRadius: 7,
                        border: "none", cursor: "pointer", background: current === g.path ? "var(--accent)" : "transparent",
                        color: current === g.path ? "var(--on-primary)" : "var(--text-1)",
                      }}
                    >
                      {g.label}
                    </button>
                  </div>
                  {g.children.map((c) => (
                        <button
                          key={c.path}
                          onClick={() => void load(c.path)}
                          style={{
                            display: "block", width: "100%", textAlign: "left", fontSize: 12.5, padding: "5px 8px 5px 20px",
                            borderRadius: 7, border: "none", cursor: "pointer",
                            background: current === c.path ? "var(--accent)" : "transparent",
                            color: current === c.path ? "var(--on-primary)" : "var(--text-2)",
                          }}
                        >
                          {c.label}
                        </button>
                      ))}
                </div>
              );
            })}
            {!tocLoading && !visible.length ? <div style={{ fontSize: 12, color: "var(--text-3)" }}>无匹配</div> : null}
          </div>
        </Card>
        <Card style={{ overflowY: "auto", padding: "16px 22px" }}>
          {err ? (
            <ErrorLine text={err} style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }} />
          ) : null}
          {loading ? <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>加载中…</div> : null}
          {/* 正文：站点预渲染 HTML 注入（script/icon/svg 已剔除，图片补全域名+限高） */}
          <div className="thubook-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: page?.html ?? "" }} />
          {!page && !loading && !err ? <div style={{ fontSize: 13, color: "var(--text-3)" }}>左侧选择一页开始阅读</div> : null}
        </Card>
      </div>
    </>
  );
}
