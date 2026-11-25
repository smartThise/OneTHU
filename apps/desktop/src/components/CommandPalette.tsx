import { useOverlayBack } from "../state/navStack.js";
import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { isSimpleLike, useExperienceMode } from "../state/experienceMode.js";
/**
 * 命令面板（§2.8.4）：⌘/Ctrl+K 唤起的居中搜索，输入即搜、回车直达。
 *
 * 三条纪律：
 *  · 结果与服务页搜索**同源**（state/searchAll.ts）：面板里搜得到的，服务页也搜得到；
 *  · 打开走原子的 open（与服务页同一条链路），所以「最近使用」照样被记；
 *  · 键位同时认 ⌘ 和 Ctrl——本项目只出 Windows 与 Android，实际按的是 Ctrl+K，
 *    但两个都认，将来出 Mac 版不用返工；侧栏还留了可点击入口，不逼人记快捷键。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconSearch } from "./Icons.js";
import { pageAtomRef, resolveAtom } from "../state/atoms.js";
import { coreDefaults, type NavEntry } from "../state/navigation.js";
import { searchAll } from "../state/searchAll.js";
import { requestSettingsTab } from "../state/settingsMode.js";
import { displayBreadcrumb, familyOf, goSearchRow, type SearchRow } from "../state/searchRows.js";
import { showToast } from "../state/toast.js";
import { ohAsk } from "../plugins/ChatDock.js";
import { requestOhPanel } from "../plugins/ohControl.js";
import { closePalette, togglePalette, usePaletteOpen } from "../state/palette.js";
import { useApp } from "../state/context.js";
import { vaultCatchAttr } from "./vault/vaultDrag.js";

/** 快捷键提示要跟当前平台一致：Mac 显示 ⌘K，其它（含 Windows）显示 Ctrl K */
export function shortcutLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.platform + " " + navigator.userAgent;
  return /Mac|iPhone|iPad/i.test(ua) ? "⌘K" : "Ctrl K";
}

type Row =
  | { kind: "entry"; key: string; entry: NavEntry }
  | { kind: "atom"; key: string; atomKind: string; atomKey: string; title: string; sub?: string; group: string }
  | { kind: "tab"; key: string; tab: string }
  /** 设置行级命中（声明式注册表；点击直达该行并高亮） */
  | { kind: "row"; key: string; title: string; sub: string; row: SearchRow };

/** 面包屑小字（muted 全链）：桌面显示 displayRoot 口径的**全链**（OH 行显示「设置 → OneTHU Harness → …」），
 *  手机档（is-phone）只显示**最后一段**——屏幕小，但导航仍照常落到行级（链接行为与桌面完全一致）。 */
function breadcrumbLine(row: SearchRow): string {
  const bc = displayBreadcrumb(row);
  if (typeof document !== "undefined" && document.documentElement.classList.contains("is-phone")) {
    return bc[bc.length - 1] ?? "";
  }
  return bc.join(" → ");
}

export function CommandPalette(): ReactNode {
  const uiLocale = useUiLocale();

  const mode = useExperienceMode();
  const open = usePaletteOpen();
  useOverlayBack("command-palette", open, closePalette);
  const { navigate } = useApp();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* 全局键位：⌘/Ctrl+K 开关，Esc 关闭。preventDefault 是必须的——WebView 里 Ctrl+K 另有含义 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        /* Ctrl+K 统一落到 OH 搜索：旧的 CommandPalette 不再抢这个快捷键。
           侧栏按钮仍保留旧面板作为浏览入口。 */
        closePalette();
        requestOhPanel("search");
        return;
      }
      if (e.key === "Escape" && open) closePalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const query = q.trim();
  const rows = useMemo<Row[]>(() => {
    if (!query) {
      // 空查询给「常用」兜底（注册表 core 顺序），省得对着一片空白不知道能搜什么
      return coreDefaults().filter(e=>!isSimpleLike(mode)||!["board","vault","contacts","plugins","xiaoda"].includes(e.page)).map((entry) => ({ kind: "entry" as const, key: "n:" + entry.id, entry }));
    }
    const r = searchAll(query);
    const base: Row[] = [
      ...r.entries.map((entry) => ({ kind: "entry" as const, key: "n:" + entry.id, entry })),
      ...r.atoms.map((a) => ({
        kind: "atom" as const,
        key: "a:" + a.kind + "|" + a.key,
        atomKind: a.kind,
        atomKey: a.key,
        title: a.title,
        sub: a.sub,
        group: a.group,
      })),
      ...r.tabs.map((tab) => ({ kind: "tab" as const, key: "t:" + tab, tab })),
    ];
    /* 设置行级命中**排最前**（同源：searchAll → searchRows 声明式注册表）。
       面包屑走 displayRoot 口径（OH 行显示「设置 → OneTHU Harness → …」）；sub 只留原生说明。 */
    const rowHits: Row[] = r.rows.map((x) => ({
      kind: "row" as const,
      key: "row:" + x.row.id,
      title: x.row.title,
      sub: x.row.desc ?? "",
      row: x.row,
    }));
    return [...rowHits, ...base];
  }, [uiLocale, query, mode]);

  useEffect(() => {
    setActive((i) => (i >= rows.length ? 0 : i));
  }, [rows.length]);

  useEffect(() => {
    document.querySelector('[data-pal-row="' + active + '"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runRow = (row: Row): void => {
    closePalette();
    /* 设置行级命中：直达该行（页签 + 分节/行高亮），复用既有请求机制 */
    if (row.kind === "row") {
      const res = goSearchRow(row.row);
      /* 入口态由 goSearchRow 决定；这里再 navigate("plugins") 会把 OH 行打回插件页。 */
      /* 条件隐藏行 / 无独立控件的行：落到分节根后**明说**一句，不冒充行级命中 */
      if (res.note) showToast(res.note);
      return;
    }
    if (row.kind === "tab") {
      requestSettingsTab(row.tab);
      navigate("settings");
      return;
    }
    if (row.kind === "atom") {
      const view = resolveAtom({ kind: row.atomKind as never, key: row.atomKey });
      if (view) view.open(navigate);
      return;
    }
    const ref = pageAtomRef(row.entry.id);
    const view = ref ? resolveAtom(ref) : null;
    if (view) view.open(navigate);
    else navigate(row.entry.page, row.entry.params);
  };

  if (!open) return null;

  return createPortal(
    <div className="pal-mask" onClick={closePalette} role="presentation">
      <div
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label={i18n("components.commandpalette.505ea9c9f199")}
        data-palette=""
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pal-head">
          <span className="pal-icon">
            <IconSearch width={16} height={16} />
          </span>
          <input
            ref={inputRef}
            className="pal-input"
            placeholder={i18n("components.commandpalette.eccc7050c50c")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const row = rows[active];
                if (row) runRow(row);
              }
            }}
            aria-label={i18n("components.commandpalette.505ea9c9f199")}
          />
          <kbd className="pal-kbd">{shortcutLabel()}</kbd>
        </div>
        {!query ? <div className="pal-group">{i18n("components.commandpalette.4563c57b5143")}</div> : null}
        <div className="pal-list">
          {rows.length === 0 ? (
            <>
            <div className="pal-empty">{i18n("components.commandpalette.618857afe202")}</div>
            {/* 空态兜底（用户点名）：**真可用**的一条通道——与底部悬浮岛/悬浮球同源走 ohAsk()。
                先 closePalette() 再调，避免"检索条 + 对话面板"两层浮层叠着。 */}
            <button
              className="pal-ask"
              title={i18n("components.commandpalette.38e250de311e")}
              onClick={() => {
                const q = query.trim();
                closePalette();
                ohAsk(q);
              }}
            >
              {query.trim()
                ? /^(怎么|如何|是什么)/.test(query.trim())
                  ? i18n("components.commandpalette.30f7c7c3a13f", { value: String(query.trim()) })
                  : i18n("components.commandpalette.c1acb64eaa4e", { value: String(query.trim()) })
                : i18n("components.commandpalette.4c32fa9d2ed5")}
            </button>
            </>
          ) : (
            rows.map((row, i) => (
              <button
                key={row.key}
                data-pal-row={i}
                data-vault-catch={
                  row.kind === "atom"
                    ? vaultCatchAttr({ type: "atom", title: row.title, sub: row.sub, atom: { kind: row.atomKind, key: row.atomKey }, source: "搜索结果" })
                    : row.kind === "entry"
                      ? vaultCatchAttr({ type: "atom", title: row.entry.name, sub: row.entry.note ?? row.entry.category, atom: { kind: "page", key: row.entry.id }, source: "功能目录" })
                      : undefined
                }
                className={"pal-row" + (i === active ? " is-active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => runRow(row)}
              >
                <span className="pal-row-main">
                  <span className="pal-row-name">
                    {row.kind === "entry" ? row.entry.name : row.kind === "atom" ? row.title : row.kind === "row" ? row.title : i18n("components.commandpalette.5214e0bc5dce") + row.tab}
                  </span>
                  {row.kind === "row" ? (
                    /* task-22 面包屑：muted 小字全链（displayRoot 口径；手机档只留最后一段） */
                    <span className="pal-row-bc">{breadcrumbLine(row.row)}</span>
                  ) : null}
                  <span className="pal-row-sub">
                    {row.kind === "entry"
                      ? row.entry.note ?? row.entry.category
                      : row.kind === "atom"
                        ? (row.group ? row.group + " · " : "") + (row.sub ?? i18n("components.commandpalette.3c1917e1c662"))
                        : row.kind === "row"
                          ? (row.sub ? row.sub : i18n("components.commandpalette.2aedc9c279c5"))
                          : i18n("components.commandpalette.e205315fe020")}
                  </span>
                </span>
                <span className="pal-row-tag">
                  {row.kind === "entry" ? i18n("components.commandpalette.25f5ce57a190") : row.kind === "atom" ? i18n("components.commandpalette.452c7b10d57a") : row.kind === "row" ? (familyOf(row.row) === "plugins" ? i18n("components.commandpalette.e806fbbe8ec6") : i18n("components.commandpalette.df3d58c7d84b")) : i18n("components.commandpalette.df3d58c7d84b")}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
