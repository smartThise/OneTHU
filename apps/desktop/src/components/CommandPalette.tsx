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
import { useOverlayBack } from "../state/navStack.js";
import { createPortal } from "react-dom";
import { IconSearch } from "./Icons.js";
import { pageAtomRef, resolveAtom } from "../state/atoms.js";
import { coreDefaults, type NavEntry } from "../state/navigation.js";
import { searchAll } from "../state/searchAll.js";
import { requestSettingsTab, useAdvancedMode } from "../state/settingsMode.js";
import { closePalette, togglePalette, usePaletteOpen } from "../state/palette.js";
import { useApp } from "../state/context.js";

/** 快捷键提示要跟当前平台一致：Mac 显示 ⌘K，其它（含 Windows）显示 Ctrl K */
export function shortcutLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.platform + " " + navigator.userAgent;
  return /Mac|iPhone|iPad/i.test(ua) ? "⌘K" : "Ctrl K";
}

type Row =
  | { kind: "entry"; key: string; entry: NavEntry }
  | { kind: "atom"; key: string; atomKind: string; atomKey: string; title: string; sub?: string; group: string }
  | { kind: "tab"; key: string; tab: string };

export function CommandPalette(): ReactNode {
  const open = usePaletteOpen();
  useOverlayBack("palette", open, closePalette);
  const { navigate } = useApp();
  const advanced = useAdvancedMode();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* 全局键位：⌘/Ctrl+K 开关，Esc 关闭。preventDefault 是必须的——WebView 里 Ctrl+K 另有含义 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
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
      return coreDefaults().map((entry) => ({ kind: "entry" as const, key: "n:" + entry.id, entry }));
    }
    const r = searchAll(query);
    return [
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
  }, [query, advanced]);

  useEffect(() => {
    setActive((i) => (i >= rows.length ? 0 : i));
  }, [rows.length]);

  useEffect(() => {
    document.querySelector('[data-pal-row="' + active + '"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runRow = (row: Row): void => {
    closePalette();
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
        aria-label="搜索功能"
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
            placeholder="搜功能 / 页面 / 设置，如：电费 洗衣机 成绩"
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
            aria-label="搜索功能"
          />
          <kbd className="pal-kbd">{shortcutLabel()}</kbd>
        </div>
        {!query ? <div className="pal-group">常用</div> : null}
        <div className="pal-list">
          {rows.length === 0 ? (
            <div className="pal-empty">没找到。换个说法试试，比如「电费」「洗衣机」「成绩」。</div>
          ) : (
            rows.map((row, i) => (
              <button
                key={row.key}
                data-pal-row={i}
                className={"pal-row" + (i === active ? " is-active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => runRow(row)}
              >
                <span className="pal-row-main">
                  <span className="pal-row-name">
                    {row.kind === "entry" ? row.entry.name : row.kind === "atom" ? row.title : "设置 · " + row.tab}
                  </span>
                  <span className="pal-row-sub">
                    {row.kind === "entry"
                      ? row.entry.note ?? row.entry.category
                      : row.kind === "atom"
                        ? (row.group ? row.group + " · " : "") + (row.sub ?? "相关内容")
                        : "跳到设置的这一栏"}
                  </span>
                </span>
                <span className="pal-row-tag">{row.kind === "entry" ? "功能" : row.kind === "atom" ? "页面" : "设置"}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
