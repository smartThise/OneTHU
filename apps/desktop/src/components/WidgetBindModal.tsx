/**
 * 小组件绑定层：把「这块小组件显示什么」这件事一次问清。
 *
 * 两个方向共用一个界面：
 *   ① 从实例出发（桌面点未绑定的那块 / 设置页点「换内容」）→ 先问内容（四选一）；
 *   ② 从内容出发（收藏夹页「上桌面」、收藏项长卡「桌」）→ 先问放到哪一块。
 *
 * 为什么必须支持②：桌面上放几块、放多大是用户在自己桌面上决定的，应用无法替他添加
 * 小组件；所以「把收藏夹放上桌面」的落地方式是绑定到某一块已存在的实例上。
 *
 * 界面沿用既有弹层与收藏搜索层；内容候选与清单另用一套卡片样式（wb-*）：这里的选择
 * 不是「浏览一长串搜索结果」，用列表行会把两行字挤成一条灰杠，四类用法反而看不出来。
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../lib/useExitPhase.js";
import { FavAtomPicker } from "./FavAtomPicker.js";
import { IconCard, IconFile, IconFolder, IconToday } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { resolveAtom } from "../state/atoms.js";
import { showToast } from "../state/toast.js";
import { fetchWidgetInstances } from "../state/widgetBridge.js";
import { ensureWidgetRuntime } from "../state/notifySources.js";
import type { WidgetInstanceInfo } from "../state/widgetRuntime.js";
import {
  bindWidgetInstance, describeBinding, loadWidgetInstances, unbindWidgetInstance, type WidgetBinding,
} from "../state/widgetInstances.js";
import { clearWidgetBind, useWidgetBindRequest } from "../state/widgetBindUi.js";
import { useNotifyBackend } from "./useNotifyBackend.js";

/** provider 类名 → 形态标签（原生报回类名，这里给用户看得懂的名字） */
const SHAPES: Record<string, string> = {
  OnethuWidgetShape1Shortcut: "1×1 快捷方式",
  OnethuWidgetShape2Narrow: "2×1 窄条",
  OnethuWidgetShape3Square: "2×2 方块",
  OnethuWidgetShape4Standard: "3×2 标准",
  OnethuWidgetShape5Strip: "4×1 长条",
};

export function shapeLabel(inst: WidgetInstanceInfo): string {
  return SHAPES[inst.provider ?? ""] ?? `${inst.w}×${inst.h}dp`;
}

/** 收藏夹里的收藏项数（子收藏夹不算：图标组里只有收藏项有图标可画） */
function atomsIn(folder: { items: Array<{ t: string }> }): number {
  return folder.items.filter((it) => it.t === "a").length;
}

/** 内容摘要（实例清单与设置页共用） */
export function bindingSummary(binding: WidgetBinding, favs: { folders: Record<string, { title: string }> }): string {
  const names = {
    folder: binding.kind === "folder" ? favs.folders[binding.folderId]?.title : undefined,
    atom: binding.kind === "detail" || binding.kind === "shortcut"
      ? (resolveAtom(binding.atom)?.title ?? "（已失效）")
      : undefined,
  };
  return describeBinding(binding, names);
}

/** 四类内容的说明（选择界面文案与设置页共用一份口径） */
export const CONTENT_KINDS: Array<{
  kind: "today" | "detail" | "folder" | "shortcut";
  label: string;
  desc: string;
  icon: typeof IconToday;
}> = [
  { kind: "today", label: "日程与 DDL", desc: "今天的课、考试与作业截止（最常用的一块）", icon: IconToday },
  { kind: "detail", label: "一个收藏项占满", desc: "课程、作业、洗衣机…显示它的详情，拉得越高行数越多", icon: IconFile },
  { kind: "folder", label: "收藏夹图标组", desc: "把某个收藏夹嵌到桌面：若干收藏项图标并列，各自可点", icon: IconFolder },
  { kind: "shortcut", label: "快捷方式", desc: "一个功能页或收藏项的图标快捷方式（1×1 起）", icon: IconCard },
];

export function WidgetBindModal(): ReactNode {
  const [closing, requestClose] = useExitPhase(() => close());
  const req = useWidgetBindRequest();
  const favs = useFavs();
  const backend = useNotifyBackend();
  const [instances, setInstances] = useState<WidgetInstanceInfo[] | null>(null);
  /** 读取失败与「一块都没有」是两回事，不能都说成「正在读取」 */
  const [readFailed, setReadFailed] = useState(false);
  const [picker, setPicker] = useState<null | "detail" | "shortcut">(null);
  /** 收藏夹图标组：先选哪个收藏夹（可能有很多个） */
  const [folderPick, setFolderPick] = useState(false);
  /* 夹选择是模态内的二级视图：它自己的关闭（遮罩/返回）也走退场，不然遮罩先消失、面板还在动 */
  const [pickClosing, requestPickClose] = useExitPhase(() => setFolderPick(false), folderPick);

  useEffect(() => {
    if (!req) return;
    let alive = true;
    void (async () => {
      const list = await fetchWidgetInstances();
      if (!alive) return;
      setReadFailed(list === null);
      setInstances(list ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [req]);

  if (!req || backend !== "android") return null;

  const done = (msg: string): void => {
    showToast(msg);
    clearWidgetBind();
    setPicker(null);
    setFolderPick(false);
  };

  const bind = (id: number | string, binding: WidgetBinding): void => {
    bindWidgetInstance(id, binding);
    // 用户此刻正看着桌面：立刻重推一次，别等订阅链上的防抖。
    // 再补一次：放置流程里系统可能还没把这块登记进 AppWidgetManager（配置活动刚返回），
    // 第一次推送里没有它，补推这一次才不会让用户看到「绑好了但桌面还是占位」。
    void (async () => {
      const rt = await ensureWidgetRuntime();
      await rt.syncNow();
      await new Promise((r) => setTimeout(r, 2500));
      await rt.syncNow();
    })();
    done(`已绑定：${bindingSummary(binding, favs.data)}`);
  };

  const close = (): void => {
    clearWidgetBind();
    setPicker(null);
    setFolderPick(false);
  };

  /* 从内容出发：先选放到哪一块 */
  if (req.to === "pick") {
    const binding = req.binding;
    return createPortal(
      <div className={"home-modal-mask" + (closing ? " is-closing" : "")} onClick={requestClose}>
        <div className={"home-modal" + (closing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label="放到哪一块小组件" onClick={(e) => e.stopPropagation()}>
          <div className="home-modal-head">
            <h3>放到哪一块小组件？</h3>
            <button className="btn btn-ghost" onClick={requestClose}>关闭</button>
          </div>
          <div className="home-modal-body">
            <div className="wb-current">
              要显示：{bindingSummary(binding, favs.data)}
              <br />
              应用不能替你往桌面添加小组件，只能给已经存在的那些换内容。
            </div>
            {readFailed ? (
              <div className="home-modal-hint">读取桌面上的小组件失败：应用刚更新时请先完全退出再打开一次。</div>
            ) : null}
            {instances === null && !readFailed ? <div className="home-modal-hint">正在读取桌面上的小组件…</div> : null}
            {instances?.length === 0 ? (
              <div className="home-modal-hint">
                桌面上还没有 OneTHU 小组件。长按桌面 → 小组件 → 选「OneTHU」，放好一块再回来。
              </div>
            ) : null}
            <div className="wb-list">
              {(instances ?? []).map((inst) => (
                <button key={inst.id} className="wb-row" onClick={() => bind(inst.id, binding)}>
                  <span className="wb-kind-icon"><IconCard width={17} height={17} /></span>
                  <div className="wb-row-main">
                    <div className="wb-row-name">{shapeLabel(inst)}</div>
                    <div className="wb-row-sub">
                      当前：{bindingSummary(loadWidgetInstances().byId[String(inst.id)] ?? { kind: "today" }, favs.data)}
                    </div>
                  </div>
                  <span className="wb-row-shape">点它</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  /* 从实例出发：先选内容 */
  const id = req.id;
  const cur = loadWidgetInstances().byId[id] ?? { kind: "today" as const };
  return createPortal(
    <div className={"home-modal-mask" + (closing ? " is-closing" : "")} onClick={requestClose}>
      <div className={"home-modal" + (closing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label="这块小组件显示什么" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>这块小组件显示什么？</h3>
          <button className="btn btn-ghost" onClick={requestClose}>关闭</button>
        </div>
        <div className="home-modal-body">
          <div className="wb-current">
            当前显示：{bindingSummary(cur, favs.data)}
            <br />
            桌面上可以同时放多块，各显示各的（点卡片即可换）。
          </div>
          <div className="wb-kinds">
            {CONTENT_KINDS.map((k) => {
              const Icon = k.icon;
              const active = cur.kind === k.kind;
              return (
                <button
                  key={k.kind}
                  className={"wb-kind" + (active ? " is-active" : "")}
                  onClick={() => {
                    if (k.kind === "today") bind(id, { kind: "today" });
                    else if (k.kind === "folder") {
                      if (Object.keys(favs.data.folders).length === 0) {
                        showToast("还没有收藏夹：先在收藏夹页建一个再放上桌面");
                        return;
                      }
                      setFolderPick(true);
                    } else setPicker(k.kind);
                  }}
                >
                  <span className="wb-kind-icon"><Icon width={17} height={17} /></span>
                  <span className="wb-kind-name">{k.label}</span>
                  <span className="wb-kind-desc">{k.desc}</span>
                </button>
              );
            })}
          </div>

          {cur.kind !== "today" ? (
            <button
              className="btn btn-ghost"
              onClick={() => {
                unbindWidgetInstance(id);
                done("已恢复为「日程与 DDL」");
              }}
            >
              恢复默认（日程与 DDL）
            </button>
          ) : null}
        </div>
      </div>

      {folderPick ? (
        <div className={"home-modal-mask" + (pickClosing ? " is-closing" : "")} onClick={requestPickClose}>
          <div className={"home-modal" + (pickClosing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-label="选一个收藏夹" onClick={(e) => e.stopPropagation()}>
            <div className="home-modal-head">
              <h3>选一个收藏夹</h3>
              <button className="btn btn-ghost" onClick={requestPickClose}>返回</button>
            </div>
            <div className="home-modal-body">
              <div className="home-modal-hint">夹里的收藏项会以图标并列显示在这块小组件上（放不下的自动略过）。</div>
              <div className="wb-list">
                {Object.values(favs.data.folders).map((f) => (
                  <button key={f.id} className="wb-row" onClick={() => bind(id, { kind: "folder", folderId: f.id })}>
                    <span className="wb-kind-icon"><IconFolder width={17} height={17} /></span>
                    <div className="wb-row-main">
                      <div className="wb-row-name">{f.title}</div>
                      <div className="wb-row-sub">{f.items.filter((it) => it.t === "a").length} 个收藏项（放不下的自动略过）</div>
                    </div>
                    <span className="wb-row-shape">{atomsIn(f)} 个</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {picker ? (
        <FavAtomPicker
          title={picker === "shortcut" ? "选一个收藏项做快捷方式" : "选一个收藏项显示详情"}
          hint={picker === "shortcut" ? "图标 + 名称，放成 1×1 就像桌面快捷方式。" : "这块小组件会被它占满：拉得越高，显示的细节越多。"}
          onPick={(atom) => bind(id, { kind: picker, atom })}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
