import { useOneGUILocale } from "../locale.js";
/* OneGUI · 表单族：全站唯一的输入件（Input / TextArea / Search / Number / Select / Check / Radio / Switch / Slider）
 *
 * 所有控件共享同一个"壳"（.og-input）：边框、底色、聚焦环、尺寸档、无效态都在壳里，
 * 页面永远拿不到改这些的能力 —— 想特殊就登记 scope，或者要求加一个正经变体。
 * UX 与旧实现保持一致：回车提交、Esc 清空搜索、拖拽用 pointer capture、方向键调值。
 */
import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx, one, scopeProps, type OGSize, type OneBase } from "./kit.js";

/* ── 字段包装 ─────────────────────────────────────────────────────────── */

export interface FieldProps extends OneBase {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, required, scope, className, children }: FieldProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-field", className)}>
      {label ? (
        <span className="og-field-label">
          {label}
          {required ? <span className="og-field-required" aria-hidden="true">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="og-field-error">{error}</span> : hint ? <span className="og-field-hint">{hint}</span> : null}
    </div>
  );
}

/* ── 输入壳（内部共用） ───────────────────────────────────────────────── */

interface ShellProps {
  size?: OGSize;
  invalid?: boolean;
  disabled?: boolean;
  focused: boolean;
  className?: string;
  children: ReactNode;
}

function Shell({ size, invalid, disabled, focused, className, children }: ShellProps): ReactNode {
  return (
    <div
      className={cx(
        one("input").size(size).state("invalid", invalid).state("disabled", disabled).state("focused", focused).toString(),
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Input ───────────────────────────────────────────────────────────── */

export interface InputProps extends OneBase {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
  onEscape?: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "tel" | "url" | "search" | "number" | "date" | "time";
  size?: OGSize;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  name?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url" | "search";
  autoComplete?: string;
  autoFocus?: boolean;
  maxLength?: number;
  min?: string | number;
  max?: string | number;
  spellCheck?: boolean;
  /** 键盘处理：用方法语法声明 —— 参数按双变检查，既接受按具体元素注解的处理器，也能上下文推断 */
  onKeyDown?(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void;
  "aria-label"?: string;
}

export function Input({
  value, defaultValue, onChange, onEnter, onEscape, onFocusChange, placeholder, type = "text", size = "md",
  disabled, readOnly, invalid, icon, trailing, scope, className, name, inputMode, autoComplete, autoFocus, maxLength,
  spellCheck, onKeyDown, min, max, ...aria
}: InputProps): ReactNode {
  const [focused, setFocused] = useState(false);
  return (
    <Shell size={size} invalid={invalid} disabled={disabled} focused={focused} className={className}>
      {icon ? <span className="og-input-icon" aria-hidden="true">{icon}</span> : null}
      <input
        {...scopeProps(scope)}
        className="og-input-el"
        type={type}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        maxLength={maxLength}
        min={min}
        max={max}
        spellCheck={spellCheck}
        aria-invalid={invalid || undefined}
        aria-label={aria["aria-label"]}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => { setFocused(true); onFocusChange?.(true); }}
        onBlur={() => { setFocused(false); onFocusChange?.(false); }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Enter") onEnter?.((e.target as HTMLInputElement).value);
          if (e.key === "Escape") onEscape?.((e.target as HTMLInputElement).value);
        }}
      />
      {trailing ? <span className="og-input-icon">{trailing}</span> : null}
    </Shell>
  );
}

/* ── TextArea ────────────────────────────────────────────────────────── */

export interface TextAreaProps extends Omit<InputProps, "type" | "icon" | "inputMode" | "maxLength"> {
  rows?: number;
  autoGrow?: boolean;
  maxRows?: number;
  /** 等宽字体（粘贴 Cookie / JSON / 日志这类"机器文本"用；2026-10-14 加） */
  mono?: boolean;
}

export function TextArea({ value, defaultValue, onChange, onFocusChange, placeholder, size = "md", disabled, readOnly, invalid, rows = 4, autoGrow, maxRows, mono, scope, className, autoFocus, spellCheck, onKeyDown, "aria-label": ariaLabel }: TextAreaProps): ReactNode {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    const el = ref.current;
    el.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = (maxRows ?? 12) * lineHeight;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [autoGrow, maxRows, value, defaultValue]);
  return (
    <Shell size={size} invalid={invalid} disabled={disabled} focused={focused} className={cx("og-input--area", mono && "og-input--mono", className)}>
      <textarea
        ref={ref}
        {...scopeProps(scope)}
        className="og-input-el"
        rows={rows}
        aria-label={ariaLabel}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        spellCheck={spellCheck}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => { setFocused(true); onFocusChange?.(true); }}
        onBlur={() => { setFocused(false); onFocusChange?.(false); }}
        onKeyDown={onKeyDown}
      />
    </Shell>
  );
}

/* ── SearchField ─────────────────────────────────────────────────────── */

export interface SearchFieldProps extends Omit<InputProps, "type" | "icon"> {
  /** 回车提交（搜索"真正生效"的时机由调用方决定） */
  onSearch?: (value: string) => void;
}

export function SearchField({ onSearch, onEnter, onEscape, value, defaultValue, onChange, size = "md", scope, className, placeholder, ...rest }: SearchFieldProps): ReactNode {
  const { t: guiText } = useOneGUILocale();
  const [inner, setInner] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = useCallback((v: string) => {
    if (!controlled) setInner(v);
    onChange?.(v);
  }, [controlled, onChange]);
  return (
    <Input
      {...rest}
      {...scopeProps(scope)}
      className={cx("og-input--search", className)}
      size={size}
      value={current}
      placeholder={placeholder ?? guiText("gui.search.placeholder")}
      icon={<svg className="og-icon og-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.3-4.3" /></svg>}
      trailing={current ? (
        <button type="button" className="og-input-clear" aria-label={guiText("gui.search.clear")} onClick={() => { set(""); onSearch?.(""); }}>×</button>
      ) : null}
      onChange={set}
      onEnter={(v) => { onSearch?.(v); onEnter?.(v); }}
      onEscape={(v) => { set(""); onEscape?.(v); }}
    />
  );
}

/* ── NumberField ─────────────────────────────────────────────────────── */

export interface NumberFieldProps extends Omit<InputProps, "type" | "onChange" | "value" | "defaultValue" | "icon"> {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export function NumberField({ value, defaultValue, onChange, min, max, step = 1, unit, scope, className, disabled, size = "md", ...rest }: NumberFieldProps): ReactNode {
  const { t: guiText } = useOneGUILocale();
  const [inner, setInner] = useState(defaultValue ?? 0);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const clamp = useCallback((n: number) => {
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  }, [min, max]);
  const set = useCallback((n: number) => {
    const v = clamp(n);
    if (!controlled) setInner(v);
    onChange?.(v);
  }, [clamp, controlled, onChange]);
  const [focused, setFocused] = useState(false);
  return (
    <div {...scopeProps(scope)} className={cx("og-number", className)}>
      <button type="button" className="og-number-btn" aria-label={guiText("gui.number.decrease")} aria-disabled={min !== undefined && current <= min} onClick={() => set(current - step)}>−</button>
      <Shell size={size} disabled={disabled} focused={focused}>
        <input
          className="og-input-el"
          type="number"
          inputMode="decimal"
          value={String(current)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const n = Number.parseFloat(e.target.value);
            if (!Number.isNaN(n)) set(n);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {unit ? <span className="og-input-icon">{unit}</span> : null}
      </Shell>
      <button type="button" className="og-number-btn" aria-label={guiText("gui.number.increase")} aria-disabled={max !== undefined && current >= max} onClick={() => set(current + step)}>+</button>
    </div>
  );
}

/* ── Select ────────────────────────────────────────────────────────────
 * 自绘单选下拉：原生 <select> 的弹层由浏览器/系统绘制，深色与玻璃皮肤下无法跟随
 * OneGUI 材质（用户实测：设置页线程数下拉是白底黑字的系统菜单）。这里用
 * button[role=combobox] + portal listbox 取代原生弹层：
 *   · 桌面：贴着控件展开的浮层（超出视口自动翻到上方）；
 *   · 手机：底部选择面板；
 *   · 键盘：上下/Home/End/Enter/Space/Esc/首字跳选；
 *   · 鼠标/触摸：点外关闭，选中回焦触发器。
 * children 仍兼容 <option> / <optgroup>，现有调用方无需改写。 */

export interface SelectOption { value: string; label: ReactNode; disabled?: boolean }

export interface SelectProps extends OneBase {
  /** 兼容原生 select 的 number；onChange 一律回 string */
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  options?: SelectOption[];
  children?: ReactNode;
  placeholder?: string;
  size?: OGSize;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

interface SelectEntry { value: string; label: ReactNode; disabled?: boolean; group?: ReactNode }

/** 从 <option>/<optgroup> 子节点读出扁平选项；分组标签随第一项携带。 */
function flattenSelectChildren(children: ReactNode): SelectEntry[] {
  const out: SelectEntry[] = [];
  const text = (node: ReactNode): string => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(text).join("");
    return "";
  };
  const visit = (nodes: ReactNode, group?: ReactNode): void => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement(node)) return;
      const props = node.props as Record<string, unknown>;
      if (node.type === Fragment) { visit(props.children as ReactNode, group); return; }
      if (node.type === "optgroup") { visit(props.children as ReactNode, props.label as ReactNode); return; }
      if (node.type !== "option") return;
      const label = props.children as ReactNode;
      const value = props.value !== undefined ? String(props.value) : text(label);
      out.push({ value, label: label ?? value, disabled: Boolean(props.disabled), group });
    });
  };
  visit(children);
  return out;
}

export function Select({
  id, value, defaultValue, onChange, options, children, placeholder, size = "md",
  disabled, invalid, scope, className, ...aria
}: SelectProps): ReactNode {
  const autoId = useId();
  const triggerId = id ?? `og-select-${autoId}`;
  const listId = `${triggerId}-list`;
  const entries: SelectEntry[] = options ? options.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled })) : flattenSelectChildren(children);
  const [inner, setInner] = useState<string>(() => {
    if (defaultValue !== undefined) return String(defaultValue);
    return entries.find((e) => !e.disabled)?.value ?? "";
  });
  const current = value !== undefined ? String(value) : inner;
  const selected = entries.find((e) => e.value === current) ?? null;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [phone, setPhone] = useState<boolean>(() => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 839.98px)").matches);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback((focus = false): void => {
    setOpen(false);
    setPos(null);
    if (focus) triggerRef.current?.focus();
  }, []);

  const choose = useCallback((entry: SelectEntry): void => {
    if (entry.disabled) return;
    if (value === undefined) setInner(entry.value);
    onChange?.(entry.value);
    close(true);
  }, [close, onChange, value]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 839.98px)");
    const sync = (): void => setPhone(mq.matches);
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  /* 桌面浮层位置：以触发器矩形为准，空间不足时翻到上方；宽度至少与控件同宽。 */
  useLayoutEffect(() => {
    if (!open || phone || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 168), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const maxHeight = Math.min(320, Math.max(120, Math.max(below, above)));
    const flip = below < 160 && above > below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPos({ left, top: flip ? Math.max(8, rect.top - maxHeight - 6) : rect.bottom + 6, width, maxHeight });
  }, [open, phone, entries.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || popRef.current?.contains(target))) return;
      close();
    };
    const onResize = (): void => close();
    const onScroll = (e: Event): void => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openList = (): void => {
    if (disabled) return;
    if (open) { close(true); return; }
    const selectedIndex = entries.findIndex((e) => e.value === current);
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Escape") {
      if (open) { e.preventDefault(); close(true); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { openList(); return; }
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        let next = i;
        for (let step = 0; step < entries.length; step++) {
          next = (next + dir + entries.length) % entries.length;
          if (!entries[next]?.disabled) break;
        }
        return next;
      });
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      if (!open) return;
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : entries.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) { openList(); return; }
      const entry = entries[active];
      if (entry) choose(entry);
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const char = e.key.toLowerCase();
      const idx = entries.findIndex((entry) => {
        const raw = typeof entry.label === "string" || typeof entry.label === "number" ? String(entry.label) : "";
        return raw.toLowerCase().startsWith(char);
      });
      if (idx >= 0) { e.preventDefault(); if (!open) setOpen(true); setActive(idx); }
    }
  };

  const optionsList = (): ReactNode => {
    let group: ReactNode | undefined;
    return entries.map((entry, i) => {
      const header = entry.group !== undefined && entry.group !== group ? entry.group : null;
      group = entry.group;
      return (
        <Fragment key={`${entry.value}-${i}`}>
          {header ? <div className="og-select-group" role="presentation">{header}</div> : null}
          <button
            type="button"
            ref={(node) => { optionRefs.current[i] = node; }}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={entry.value === current}
            aria-disabled={entry.disabled || undefined}
            tabIndex={-1}
            className={cx("og-select-opt", i === active && "is-active")}
            disabled={entry.disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(entry)}
          >
            <span className="og-select-opt-label">{entry.label}</span>
            {entry.value === current ? <span className="og-select-opt-check" aria-hidden="true">✓</span> : null}
          </button>
        </Fragment>
      );
    });
  };

  return (
    <div {...scopeProps(scope)} className={cx("og-select", className)}>
      <Shell size={size} invalid={invalid} disabled={disabled} focused={open}>
        <button
          ref={triggerRef}
          type="button"
          id={triggerId}
          className="og-select-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          aria-label={aria["aria-label"]}
          aria-labelledby={aria["aria-labelledby"]}
          aria-invalid={invalid || undefined}
          onClick={openList}
          onKeyDown={onTriggerKey}
        >
          <span className={cx("og-select-value", !selected && "is-placeholder")}>
            {selected ? selected.label : placeholder ?? ""}
          </span>
        </button>
        <svg className="og-icon og-icon--sm og-select-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
      </Shell>
      {open && !phone && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              id={listId}
              className="og-select-pop"
              role="listbox"
              aria-labelledby={triggerId}
              style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
            >
              {optionsList()}
            </div>,
            document.body,
          )
        : null}
      {open && phone && typeof document !== "undefined"
        ? createPortal(
            <>
              <div className="og-select-backdrop" onPointerDown={() => close()} />
              <div ref={popRef} id={listId} className="og-select-sheet" role="listbox" aria-labelledby={triggerId}>
                <div className="og-select-sheet-handle" aria-hidden="true" />
                <div className="og-select-sheet-list">{optionsList()}</div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

/* ── Checkbox / Radio ────────────────────────────────────────────────── */

export interface CheckboxProps extends OneBase {
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, defaultChecked, indeterminate, onChange, label, disabled, scope, className }: CheckboxProps): ReactNode {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  return (
    <label {...scopeProps(scope)} className={cx(one("check").state("checked", on).state("indeterminate", indeterminate).state("disabled", disabled).toString(), className)}>
      <span className="og-check-box">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled}
          onChange={(e) => {
            if (checked === undefined) setInner(e.target.checked);
            onChange?.(e.target.checked);
          }}
        />
      </span>
      {label !== undefined ? <span className="og-check-label">{label}</span> : null}
    </label>
  );
}

export interface RadioProps extends OneBase {
  value: string;
  label?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  onChange?: (value: string) => void;
  name?: string;
}

export function Radio({ value, label, disabled, checked, onChange, name, scope, className }: RadioProps): ReactNode {
  return (
    <label {...scopeProps(scope)} className={cx(one("check").variant("radio").state("checked", checked).state("disabled", disabled).toString(), className)}>
      <span className="og-check-box">
        <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange?.(value)} />
      </span>
      {label !== undefined ? <span className="og-check-label">{label}</span> : null}
    </label>
  );
}

export interface RadioGroupProps extends OneBase {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  direction?: "row" | "column";
}

export function RadioGroup({ children, direction = "column", scope, className }: RadioGroupProps): ReactNode {
  return (
    <div {...scopeProps(scope)} className={cx("og-radiogroup", direction === "row" ? "og-radiogroup--row" : "", className)} role="radiogroup">
      {children}
    </div>
  );
}

/* ── Switch ──────────────────────────────────────────────────────────── */

export interface SwitchProps extends OneBase {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Switch({ checked, defaultChecked, onChange, disabled, scope, className, ...aria }: SwitchProps): ReactNode {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  const toggle = (): void => {
    if (disabled) return;
    if (checked === undefined) setInner(!on);
    onChange?.(!on);
  };
  return (
    <span
      {...scopeProps(scope)}
      className={cx(one("switch").state("checked", on).state("disabled", disabled).toString(), className)}
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      aria-label={aria["aria-label"]}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); }
      }}
    >
      <span className="og-switch-thumb" />
    </span>
  );
}

/* ── Slider / RangeSlider ────────────────────────────────────────────── */

export interface SliderProps extends OneBase {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  /** 松手时回调（只在提交点触发，用于落盘/请求） */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  showValue?: boolean;
  format?: (value: number) => string;
  "aria-label"?: string;
}

function useSliderGeometry(min: number, max: number) {
  return useCallback((n: number) => {
    const ratio = max === min ? 0 : (n - min) / (max - min);
    return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }, [min, max]);
}

export function Slider({ value, defaultValue, onChange, onCommit, min = 0, max = 100, step = 1, disabled, showValue, format, scope, className, ...aria }: SliderProps): ReactNode {
  const [inner, setInner] = useState(defaultValue ?? min);
  const current = value ?? inner;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const pos = useSliderGeometry(min, max)(current);

  const commit = useCallback((n: number, final: boolean) => {
    let v = Math.round((n - min) / step) * step + min;
    v = Math.max(min, Math.min(max, v));
    if (value === undefined) setInner(v);
    onChange?.(v);
    if (final) onCommit?.(v);
  }, [min, max, step, value, onChange, onCommit]);

  const fromEvent = useCallback((clientX: number, final: boolean) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    commit(min + ratio * (max - min), final);
  }, [commit, min, max]);

  return (
    <div
      {...scopeProps(scope)}
      className={cx(one("slider").state("disabled", disabled).state("dragging", dragging).toString(), className)}
    >
      <div
        ref={trackRef}
        className="og-slider-track"
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setDragging(true);
          fromEvent(e.clientX, false);
        }}
        onPointerMove={(e) => { if (dragging && !disabled) fromEvent(e.clientX, false); }}
        onPointerUp={(e) => { if (!dragging) return; setDragging(false); fromEvent(e.clientX, true); }}
        onPointerCancel={() => setDragging(false)}
      >
        <span className="og-slider-fill" data-og-dynamic="slider" style={{ ["--og-c-slider-pos" as string]: pos } as React.CSSProperties} />
        <span
          className="og-slider-thumb"
          data-og-dynamic="slider"
          style={{ ["--og-c-slider-pos" as string]: pos } as React.CSSProperties}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current}
          aria-label={aria["aria-label"]}
          aria-disabled={disabled || undefined}
          onKeyDown={(e) => {
            if (disabled) return;
            const big = step * 10;
            const map: Record<string, number> = { ArrowRight: current + step, ArrowUp: current + step, ArrowLeft: current - step, ArrowDown: current - step, PageUp: current + big, PageDown: current - big, Home: min, End: max };
            const next = map[e.key];
            if (next !== undefined) { e.preventDefault(); commit(next, true); }
          }}
        />
      </div>
      {showValue ? <span className="og-slider-value">{format ? format(current) : current}</span> : null}
    </div>
  );
}

export interface RangeSliderProps extends Omit<SliderProps, "value" | "defaultValue" | "onChange" | "onCommit"> {
  value?: [number, number];
  defaultValue?: [number, number];
  onChange?: (value: [number, number]) => void;
  onCommit?: (value: [number, number]) => void;
}

export function RangeSlider({ value, defaultValue, onChange, onCommit, min = 0, max = 100, step = 1, disabled, showValue, scope, className }: RangeSliderProps): ReactNode {
  const { t: guiText } = useOneGUILocale();
  const [inner, setInner] = useState<[number, number]>(defaultValue ?? [min, max]);
  const [a, b] = value ?? inner;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<"a" | "b" | null>(null);
  const pct = useSliderGeometry(min, max);

  const commit = useCallback((next: [number, number], final: boolean) => {
    const clamp = (n: number): number => Math.max(min, Math.min(max, Math.round((n - min) / step) * step + min));
    let [x, y] = [clamp(next[0]), clamp(next[1])];
    if (x > y) [x, y] = [y, x];
    if (value === undefined) setInner([x, y]);
    onChange?.([x, y]);
    if (final) onCommit?.([x, y]);
  }, [min, max, step, value, onChange, onCommit]);

  const fromEvent = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return min;
    return min + ((clientX - rect.left) / rect.width) * (max - min);
  }, [min, max]);

  const pick = useCallback((n: number): "a" | "b" => (Math.abs(n - a) <= Math.abs(n - b) ? "a" : "b"), [a, b]);

  return (
    <div {...scopeProps(scope)} className={cx(one("slider").variant("range").state("disabled", disabled).toString(), className)}>
      <div
        ref={trackRef}
        className="og-slider-track"
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const n = fromEvent(e.clientX);
          const which = pick(n);
          setActive(which);
          commit(which === "a" ? [n, b] : [a, n], false);
        }}
        onPointerMove={(e) => {
          if (!active || disabled) return;
          const n = fromEvent(e.clientX);
          commit(active === "a" ? [n, b] : [a, n], false);
        }}
        onPointerUp={(e) => {
          if (!active) return;
          const n = fromEvent(e.clientX);
          commit(active === "a" ? [n, b] : [a, n], true);
          setActive(null);
        }}
        onPointerCancel={() => setActive(null)}
      >
        <span className="og-slider-fill" data-og-dynamic="slider" style={{ ["--og-c-slider-pos-a" as string]: pct(a), ["--og-c-slider-pos-b" as string]: pct(b) } as React.CSSProperties} />
        <span className="og-slider-thumb" data-og-dynamic="slider" style={{ ["--og-c-slider-pos" as string]: pct(a) } as React.CSSProperties} role="slider" tabIndex={disabled ? -1 : 0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={a} aria-label={guiText("gui.range.lower")} />
        <span className="og-slider-thumb" data-og-dynamic="slider" style={{ ["--og-c-slider-pos" as string]: pct(b) } as React.CSSProperties} role="slider" tabIndex={disabled ? -1 : 0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={b} aria-label={guiText("gui.range.upper")} />
      </div>
      {showValue ? <span className="og-slider-value">{a}–{b}</span> : null}
    </div>
  );
}
