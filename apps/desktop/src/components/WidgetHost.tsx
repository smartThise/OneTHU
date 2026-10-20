/**
 * 白板组件宿主：把 BoardItem 画出来。
 *
 * 判定逻辑在 state/widgetRender.ts（纯核心，可被 node 护栏驱动）；本文件只做 kind → JSX 映射。
 * 依赖注入：跳转交给 onOpen（宿主不直接依赖路由上下文），卡片/自定义类的渲染器由白板页注入
 * （昂贵档口径见方案 §4.4：本轮先复用现有外壳）。
 */
import type { ReactNode } from "react";
import { resolveAtom } from "../state/atoms.js";
import { atomRefFromKey } from "../state/favorites.js";
import type { BoardItem } from "../state/boardCore.js";
import type { WidgetDef, WidgetSize } from "../state/widgetMeta.js";
import { planForItem } from "../state/widgetRender.js";
import { t as i18n } from "../i18n/index.js";


/**
 * 卡体渲染器：第二个参数是**当前档位尺寸**（挡位控制的组件据此切换排版）。
 * 不关心尺寸的渲染器忽略它即可（JS 允许少写形参）。
 */
export type WidgetRenderer = (props?: Record<string, unknown>, size?: WidgetSize) => ReactNode;

export interface WidgetHostProps {
  item: BoardItem;
  defs?: readonly WidgetDef[];
  /** 跳转/入口类被点按（白板页负责真正导航）。 */
  onOpen?: (item: BoardItem) => void;
  /**
   * 卡片与页面自带组件的渲染器：键取目录 id（如 custom:balance-strip）或 spec 的 kind。
   *
   * **可带 props**：从页面采集来的"某一个具体条目"（§7 的行级元素）把定位参数写在
   * `spec.props` 里（如 courseId/itemId），渲染器据此取数——这样白板上显示的是那条**真实信息**，
   * 而不是一个跳转入口（霖 2026-10-11 口径 B）。
   */
  renderers?: Record<string, WidgetRenderer>;
}

export function WidgetHost({ item, defs, onOpen, renderers }: WidgetHostProps): ReactNode {
  const plan = planForItem(item, defs ?? []);
  const id = item.spec.kind === "custom" ? "custom:" + item.spec.id : item.spec.kind === "card" ? "card:" + item.spec.card : "";
  const custom = id ? renderers?.[id] : undefined;

  if (plan.kind === "empty") {
    return (
      <div className="wg-empty" role="note">
        <span className="wg-empty-title">{i18n("auto.components.WidgetHost.1")}</span>
        <span className="wg-empty-hint">{i18n("auto.components.WidgetHost.2")}</span>
      </div>
    );
  }
  if (plan.kind === "divider") return <hr className="wg-divider" />;
  if (plan.kind === "text-title") return <h3 className="wg-title">{plan.text ?? plan.title}</h3>;
  if (plan.kind === "text-label") return <p className="wg-label">{plan.text ?? plan.title}</p>;

  if (plan.kind === "nav" || plan.kind === "atom-link") {
    /* atom-link：标题与可用性按原子注册表**运行时**解析（板文档里只存引用键——
       数据会过期，标题不能跟着过期，PR 55 方案 §10 的硬性规则）。 */
    let title = plan.title;
    let missing = false;
    if (plan.kind === "atom-link") {
      const ref = item.spec.kind === "atom-link" ? atomRefFromKey(item.spec.ref) : null;
      const view = ref ? resolveAtom(ref) : null;
      if (view) title = view.title;
      else missing = true;
    }
    if (missing) {
      return (
        <div className="wg-empty" role="note">
          <span className="wg-empty-title">{i18n("auto.components.WidgetHost.3")}</span>
        </div>
      );
    }
    return (
      <button type="button" className="wg-entry" onClick={() => onOpen?.(item)}>
        <span className="wg-entry-title">{title}</span>
        <span className="wg-entry-arrow" aria-hidden="true">›</span>
      </button>
    );
  }

  /* card / custom 有两种不同的「没有内容」，不能混用同一句文案：
     ① 有注入渲染器但此刻返回空（如当天没有下一节课）→ 说「暂无内容」；
     ② 根本没有注入渲染器（白板页尚未接上该卡）→ 说「内容由原页面提供」，这是降级而非空。 */
  return (
    <div className="wg-card">
      {custom && item.spec.kind === "custom" && ["classes", "homework", "notices", "news"].includes(item.spec.id) && plan.size.h >= 2
        ? <div className="workbench-widget-title">{plan.title}</div> : null}
      {custom ? (
        custom(item.spec.kind === "custom" ? item.spec.props : undefined, plan.size) ?? (
          <div className="wg-card-shell">
            <span className="wg-card-hint">{i18n("auto.components.WidgetHost.4")}</span>
          </div>
        )
      ) : (
        <div className="wg-card-shell">
          <span className="wg-card-title">{plan.title}</span>
          <span className="wg-card-hint">{i18n("auto.components.WidgetHost.5")}</span>
        </div>
      )}
    </div>
  );
}
