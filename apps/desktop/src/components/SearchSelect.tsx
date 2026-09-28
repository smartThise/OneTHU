import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 可搜索下拉选项。group 相同的相邻选项共享一个分组标题（保序）。 */
export interface SearchSelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

/** 面板层级：要在所有应用内弹层之上（首启导览 2000、绑定弹层 1200 等），
 *  但让开通知/门禁那一档（9999+）。 */
const PANEL_Z = 9000;

/** 预约/信息页通用可搜索下拉（PR #7 洗衣机楼栋选择的泛化，2026-09-02）：
 *  - 选项 ≥6 个自动带搜索框（按 label 模糊匹配，大小写不敏感），少于 6 个退化为普通下拉
 *  - 长列表可搜索定位；选中项 accent 高亮；点面板外关闭
 *  - value 用字符串承载（Number 型 id 由调用方转换），支持 disabled
 *
 *  2026-09-28 修正（霖反馈"下拉被局限在卡片里，啥都看不到"）：面板原来以 absolute 挂在原地，
 *  只要祖先里有 overflow（首启导览的卡片正是），就会被裁掉。改成 portal 到 body + 按触发按钮
 *  的 rect 做 fixed 定位，空间不够就向上翻；滚动/缩放时跟着锚点走。
 *  顺带修掉一个一直没有样式、等于没有的「点面板外关闭」背景层。 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "请选择…",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean } | null>(null);
  const searchable = options.length >= 6;
  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  /** 量一次触发按钮的位置，算出面板该往哪儿摆（下面放不下就往上翻） */
  const measure = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const want = Math.min(300, shown.length * 34 + (searchable ? 44 : 12) + 12);
    const up = below < Math.min(want, 180) && above > below;
    const room = up ? above : below;
    setBox({
      top: up ? Math.max(8, r.top - 5) : r.bottom + 5,
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      width: r.width,
      maxH: Math.max(140, Math.min(want, room)),
      up,
    });
  }, [shown.length, searchable]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onMove = (): void => measure();
    // capture：祖先容器内部滚动也要跟着走（导览卡片自己就会滚）
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  // 保序分组：相邻同 group 选项共享标题
  const groups: Array<{ name: string | undefined; items: SearchSelectOption[] }> = [];
  for (const o of shown) {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }

  const menu =
    open && box ? (
      <>
        <div
          style={{ position: "fixed", inset: 0, zIndex: PANEL_Z }}
          onClick={() => setOpen(false)}
        />
        <div
          className="filter-dd-panel"
          style={{
            position: "fixed",
            left: box.left,
            width: box.width,
            zIndex: PANEL_Z + 1,
            maxHeight: box.maxH,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            ...(box.up
              ? { top: "auto", bottom: window.innerHeight - box.top }
              : { top: box.top, bottom: "auto" }),
          }}
        >
          {searchable ? (
            <input
              className="input search-dd-search"
              placeholder="搜索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}
          <div className="search-dd-list" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {shown.length === 0 ? (
              <div className="search-dd-empty">无匹配项</div>
            ) : (
              groups.map((g, gi) => (
                <div key={g.name ?? `g${gi}`}>
                  {g.name ? <div className="search-dd-group">{g.name}</div> : null}
                  {g.items.map((o) => (
                    <button
                      type="button"
                      key={o.value}
                      disabled={o.disabled}
                      className={`filter-dd-opt search-dd-opt${o.value === value ? " is-sel" : ""}`}
                      onClick={() => {
                        setOpen(false);
                        setQuery("");
                        onChange(o.value);
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </>
    ) : null;

  return (
    <div className="filter-dd">
      <button
        ref={btnRef}
        type="button"
        className="input filter-dd-btn"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <span style={{ opacity: 0.55 }}>▾</span>
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
