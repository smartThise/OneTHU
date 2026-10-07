import { useCallback, useEffect, useRef, useState } from "react";

/** 退场时长：与 CSS 的 --dur-2（= --md-sys-motion-duration-short-4）同源，改令牌要同步改这里，护栏盯着。 */
export const EXIT_MS = 200;

/**
 * 弹层退场相位：返回 [closing, requestClose]。
 *
 * 用法约定（B3c）：
 * 1. 把所有关闭入口（遮罩点击、✕、取消、Escape）从直接的 onClose 换成 requestClose；
 * 2. 容器与面板的 className 挂 `closing ? " is-closing" : ""`，退场动画由 CSS 的 .is-closing 规则提供；
 * 3. 受控弹层（父级只把 open 置 false、组件不卸载）**必须**把 open 传进来 —— 否则 closing 残留会让
 *    第二次打开永远关不掉（霖实测：校园卡充值）。
 */
export function useExitPhase(onClose: () => void, open?: boolean): [boolean, () => void] {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 受控弹层重新打开时复位（组件没卸载，残留的 closing 会让它关不掉）
  useEffect(() => {
    if (open === true) {
      closingRef.current = false;
      setClosing(false);
    }
  }, [open]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timer.current = window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  return [closing, requestClose];
}
