import { Btn } from "@onethu/gui";
/**
 * 「具体项」选择器（霖 2026-10-11 定）。
 *
 * 课程文件 / 通知 / 作业这类条目**个数不可数**（每学期都在变），所以每一类做成一个模板组件，
 * 具体显示哪一条由这里选择：**列表 + 搜索框**，选完把定位参数写进条目的 spec.props。
 *
 * 观感与「添加组件」抽屉一致：半屏高、避让底栏、portal 到 body、返回键先关自己。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayBack } from "../state/navStack.js";
import { t as i18n } from "../i18n/index.js";


export interface PickerItem {
  /** 稳定键（写进 props 的原始定位信息由调用方决定） */
  key: string;
  label: string;
  sub?: string;
  props: Record<string, unknown>;
}

const CLOSE_MS = 200;

export function BoardItemPicker({
  open,
  title,
  searchHint,
  items,
  currentKey,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  searchHint?: string;
  items: readonly PickerItem[];
  currentKey?: string;
  onPick: (props: Record<string, unknown>) => void;
  onClose: () => void;
}): ReactNode {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [q, setQ] = useState("");

  useOverlayBack("board-picker", shown, onClose);

  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
      setQ("");
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open, shown]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((it) => (it.label + " " + (it.sub ?? "")).toLowerCase().includes(kw));
  }, [items, q]);

  if (!shown) return null;

  return createPortal(
    <>
      <div className="add-drawer-mask" data-picker-mask="1" onClick={onClose} />
      <div className={"add-drawer" + (leaving ? " is-out" : "")} role="dialog" aria-label={title} data-item-picker="1">
        <div className="add-drawer-inner">
          <div className="picker-head">
            <span className="picker-title">{title}</span>
            <Btn variant="outline" onClick={onClose}>{i18n("auto.components.BoardItemPicker.1")}</Btn>
          </div>
          <input
            className="picker-search"
            type="search"
            value={q}
            placeholder={searchHint ?? "搜索…"}
            onChange={(ev) => setQ(ev.target.value)}
          />
          <div className="picker-list">
            {list.length === 0 ? (
              <div className="wg-card-empty">{i18n("auto.components.BoardItemPicker.2")}</div>
            ) : (
              list.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={"picker-row" + (it.key === currentKey ? " is-current" : "")}
                  data-picker-key={it.key}
                  onClick={() => onPick(it.props)}
                >
                  <span className="picker-row-label">{it.label}</span>
                  {it.sub ? <span className="picker-row-sub">{it.sub}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
