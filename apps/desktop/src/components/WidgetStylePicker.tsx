import { t as i18n } from "../i18n/index.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { WidgetDef, WidgetStyle } from "../state/widgetMeta.js";
import { WidgetStyleList } from "./WidgetSizes.js";
import type { WidgetRenderer } from "./WidgetHost.js";

/** 右键「显示样式」：横向可预览的样式选择层，带返回/关闭。 */
export function WidgetStylePicker({
  open,
  def,
  styles,
  value,
  renderer,
  onPick,
  onClose,
}: {
  open: boolean;
  def: WidgetDef | null;
  styles: readonly WidgetStyle[];
  value?: Record<string, unknown>;
  renderer?: WidgetRenderer;
  onPick: (style: WidgetStyle) => void;
  onClose: () => void;
}): ReactNode {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  indexRef.current = index;
  useEffect(() => {
    if (!open) return;
    const hit = styles.findIndex((s) => Object.entries(s.props ?? {}).every(([k, v]) => value?.[k] === v));
    setIndex(hit >= 0 ? hit : 0);
  }, [open, styles, value]);
  if (!open || !def) return null;
  return createPortal(
    <>
      <div className="style-picker-mask" onClick={onClose} />
      <div className="style-picker" role="dialog" aria-modal="true" aria-label={i18n("state.widgetstyle.3d2ba1c5d50f")}>
        <div className="style-picker-head">
          <button type="button" className="style-picker-back" onClick={onClose} aria-label={i18n("components.freeboard.3fd47edce45b")}>
            ← {i18n("components.freeboard.3fd47edce45b")}
          </button>
          <div>
            <div className="style-picker-kicker">{i18n("state.widgetstyle.3d2ba1c5d50f")}</div>
            <div className="style-picker-title">{def.title}</div>
          </div>
          <button type="button" className="style-picker-confirm" onClick={() => { const s = styles[indexRef.current]; if (s) onPick(s); }}>
            {i18n("components.boardadddrawer.06c29e13f8a5")}
          </button>
        </div>
        <WidgetStyleList def={def} styles={styles} index={index} renderer={renderer} onSelect={setIndex} />
      </div>
    </>,
    document.body,
  );
}
