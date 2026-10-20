import { Input } from "@onethu/gui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stripInlineColors } from "../lib/htmlTheme.js";
import type { ReactNode } from "react";
import { Card, PageHead } from "../components/Layout.js";
import { universalFetch } from "../lib/transport.js";
import { ErrorLine } from "../components/Details.js";
import { normalizeThubookPath, parseThubookToc, type ThubookGroup, type ThubookPageLink } from "../lib/thubookToc.js";
import { t as i18n } from "../i18n/index.js";


/** THUBook（thubook.help，VuePress 2 预渲染静态站）内嵌阅读器。
 *  目录 = 抓各分组页预渲染侧边栏（带汉字标题，sitemap 只有拼音文件名）；
 *  正文 = <main> 提取（剔除 icon/svg 壳层、图片补全域名+限高）；
 *  x-frame-options: DENY → 不能 iframe。 */

const BASE = "https://thubook.help";
const CACHE = new Map<string, { title: string; html: string }>();

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

const BODY_STYLE = `
.thubook-body { font-size: 14px; line-height: 1.75; color: var(--text-1, #1f2329); max-width: 760px; margin: 0 auto; }
.thubook-body h1, .thubook-body h2, .thubook-body h3, .thubook-body h4 { margin: 1.2em 0 .5em; line-height: 1.4; }
.thubook-body h1 { font-size: 1.45em; } .thubook-body h2 { font-size: 1.25em; } .thubook-body h3 { font-size: 1.1em; }
.thubook-body p { margin: .6em 0; }
.thubook-body ul, .thubook-body ol { padding-left: 1.5em; margin: .5em 0; }
.thubook-body li { margin: .25em 0; }
.thubook-body a { color: #3d8bfd; text-decoration: none; }
.thubook-body a:hover { text-decoration: underline; }
.thubook-body code { background: var(--surface-3, #f4f5f7); padding: .1em .4em; border-radius: 4px; font-size: .9em; }
.thubook-body pre { background: var(--surface-3, #f4f5f7); padding: 12px; border-radius: 8px; overflow-x: auto; }
.thubook-body pre code { background: none; padding: 0; }
.thubook-body table { border-collapse: collapse; margin: .8em 0; width: 100%; display: block; overflow-x: auto; }
.thubook-body th, .thubook-body td { border: 1px solid var(--border, #e5e6eb); padding: 6px 10px; font-size: 13px; }
.thubook-body th { background: var(--surface-3, #f4f5f7); }
.thubook-body blockquote { border-left: 3px solid var(--border, #e5e6eb); margin: .8em 0; padding: .2em 1em; color: var(--text-2, #555); }
.thubook-body img { max-width: min(100%, 480px); max-height: 320px; height: auto; border-radius: 8px; display: block; margin: .6em 0; }
.thubook-body hr { border: none; border-top: 1px solid var(--border, #e5e6eb); margin: 1.2em 0; }

.thubook-toc-list { display: grid; gap: 2px; }
.thubook-toc-page { display: block; width: 100%; text-align: left; font: inherit; font-size: 12.5px; padding: 6px 8px; border-radius: 7px; border: none; cursor: pointer; background: transparent; color: var(--text-2); }
.thubook-toc-page:hover { background: var(--surface-3); }
.thubook-toc-page.is-active { background: var(--og-accent); color: var(--og-accent-on); }
.thubook-toc-page.is-child { padding-left: 20px; }
.thubook-toc-group { margin-top: 8px; }
.thubook-toc-group-label { font-size: 11.5px; font-weight: 700; letter-spacing: .02em; color: var(--og-content-2); padding: 6px 8px 3px; border-top: 1px solid var(--border); }
@media (max-width: 839.98px) {
  .thubook-shell { grid-template-columns: 1fr !important; height: auto !important; }
  .thubook-toc { max-height: 180px; }
}
`;

export default function ThubookPage(): ReactNode {
  const [tocPages, setTocPages] = useState<ThubookPageLink[]>([]);
  const [tocGroups, setTocGroups] = useState<ThubookGroup[]>([]);
  const [current, setCurrent] = useState<string>("/thubook/");
  const [page, setPage] = useState<{ title: string; html: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tocLoading, setTocLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 目录：首页 navbar 的 dropdown 已含完整两级目录（根页 + 四个分组的全部页面），
  // 一次请求取全；不再逐组抓页面合并（那会把整站侧边栏塞进每个组 → 重复/扁平）。
  useEffect(() => {
    void (async () => {
      try {
        const home = await universalFetch(`${BASE}/thubook/`);
        if (!home.ok) throw new Error(`手册页暂时打不开，请稍后再试：HTTP ${home.status}`);
        const homeText = await home.text();
        const toc = parseThubookToc(homeText);
        setTocPages(toc.pages);
        setTocGroups(toc.groups);
        const ext = extractMain(homeText);
        CACHE.set("/thubook/", ext);
        setPage(ext);
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
    const path = normalizeThubookPath(rawPath) ?? "/thubook/";
    const hit = CACHE.get(path);
    if (hit) {
      setCurrent(path);
      setPage(hit);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const res = await universalFetch(new URL(path, BASE).href);
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
        void load(href);
      } else if (href.startsWith("/") && !href.startsWith("//")) {
        void load(href);
      } else if (/^https?:\/\//.test(href)) {
        void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href)).catch(() => undefined);
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [page, load]);

  const qLower = q.trim().toLowerCase();
  const visible = useMemo(() => {
    const hit = (x: ThubookPageLink): boolean => !qLower || x.label.toLowerCase().includes(qLower) || x.path.toLowerCase().includes(qLower);
    const pages = tocPages.filter(hit);
    const groups = tocGroups
      .map((g) => {
        const labelHit = Boolean(qLower) && g.label.toLowerCase().includes(qLower);
        const items = labelHit ? g.items : g.items.filter(hit);
        return { label: g.label, items, keep: !qLower || labelHit || items.length > 0 };
      })
      .filter((g) => g.keep);
    return { pages, groups };
  }, [tocPages, tocGroups, qLower]);
  const total = tocPages.length + tocGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <PageHead title="THUBook" meta={"清华手册 · thubook.help" + (total ? " · " + String(total) + " 篇" : "")} />
      <style>{BODY_STYLE}</style>
      <div className="thubook-shell" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 10, height: "calc(100vh - 150px)" }}>
        <Card className="thubook-toc" style={{ overflowY: "auto", padding: 10 }}>
          <div style={{ width: "100%", marginBottom: 8, fontSize: 12.5 }}>{<Input placeholder={i18n("auto.pages.ThubookPage.1")} value={q} onChange={(value) => setQ(value)} />}</div>
          {tocLoading ? <div style={{ fontSize: 12, color: "var(--text-3, #999)" }}>{i18n("auto.pages.ThubookPage.2")}</div> : null}
          <div className="thubook-toc-list">
            {visible.pages.map((p) => (
              <button
                key={p.path}
                className={"thubook-toc-page" + (current === p.path ? " is-active" : "")}
                onClick={() => void load(p.path)}
              >
                {p.label}
              </button>
            ))}
            {visible.groups.map((g) => (
              <div key={g.label} className="thubook-toc-group">
                <div className="thubook-toc-group-label">{g.label}</div>
                {g.items.map((c) => (
                  <button
                    key={c.path}
                    className={"thubook-toc-page is-child" + (current === c.path ? " is-active" : "")}
                    onClick={() => void load(c.path)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ))}
            {!tocLoading && !visible.pages.length && !visible.groups.length ? <div style={{ fontSize: 12, color: "var(--text-3, #999)" }}>{i18n("auto.pages.ThubookPage.3")}</div> : null}
          </div>
        </Card>
        <Card style={{ overflowY: "auto", padding: "16px 22px" }}>
          {err ? (
            <ErrorLine text={err} style={{ fontSize: 13, marginBottom: 10 }} />
          ) : null}
          {loading ? <div style={{ fontSize: 12.5, color: "var(--text-3, #999)" }}>{i18n("auto.pages.ThubookPage.4")}</div> : null}
          {/* 正文：站点预渲染 HTML 注入（script/icon/svg 已剔除，图片补全域名+限高） */}
          <div className="thubook-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: page?.html ?? "" }} />
          {!page && !loading && !err ? <div style={{ fontSize: 13, color: "var(--text-3, #999)" }}>{i18n("auto.pages.ThubookPage.5")}</div> : null}
        </Card>
      </div>
    </>
  );
}
