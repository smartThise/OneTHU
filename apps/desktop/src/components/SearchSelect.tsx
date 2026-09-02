import { useState } from "react";

/** 可搜索下拉选项。group 相同的相邻选项共享一个分组标题（保序）。 */
export interface SearchSelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

/** 预约/信息页通用可搜索下拉（PR #7 洗衣机楼栋选择的泛化，2026-09-02）：
 *  - 选项 ≥6 个自动带搜索框（按 label 模糊匹配，大小写不敏感），少于 6 个退化为普通下拉
 *  - 长列表可搜索定位；选中项 accent 高亮；点面板外关闭
 *  - value 用字符串承载（Number 型 id 由调用方转换），支持 disabled */
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
  const searchable = options.length >= 6;
  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  // 保序分组：相邻同 group 选项共享标题
  const groups: Array<{ name: string | undefined; items: SearchSelectOption[] }> = [];
  for (const o of shown) {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }

  return (
    <div className="filter-dd">
      <button
        type="button"
        className="input filter-dd-btn"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <span style={{ opacity: 0.55 }}>▾</span>
      </button>
      {open ? (
        <>
          <div className="seg-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="filter-dd-panel">
            {searchable ? (
              <input
                className="input search-dd-search"
                placeholder="搜索…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            ) : null}
            <div className="search-dd-list">
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
      ) : null}
    </div>
  );
}
