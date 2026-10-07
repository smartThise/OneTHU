/**
 * 收藏首页（UI/UX 改造方案 §2.2，M1 beta）：底部导航「收藏」tab 直达。
 * - **收藏机制一字不改**（红线）：本页只是根收藏夹的一级列表视图，数据与操作
 *   全部来自既有 state/favs.tsx（order/folders/create）；夹内仍是原 FolderPage；
 * - 空状态给行动出口（新建收藏夹），不给空白页（§3.9 空态规范方向）。
 */
import { type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { FolderIcon, IconFolderPlus } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useFavs } from "../state/favs.js";

export function FavsHomePage(): ReactNode {
  const { navigate } = useApp();
  const favs = useFavs();
  const ids = favs.data.order;
  return (
    <>
      <PageHead title="收藏" meta="常用的功能与实体入口，长按任意页面页头星标即可收录" />
      {ids.length === 0 ? (
        <Card>
          <Empty text="还没有收藏夹。新建一个，把常用的功能收进来。" />
          <div className="svc-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                const id = favs.create("新建收藏夹", null);
                if (id) navigate("folder", { folderId: id });
              }}
            >
              新建收藏夹
            </button>
          </div>
        </Card>
      ) : (
        <Card className="svc-card">
          {ids.map((id) => {
            const f = favs.data.folders[id];
            if (!f) return null;
            return (
              <button
                key={id}
                className="svc-row"
                onClick={() => navigate("folder", { folderId: id })}
              >
                <span className="svc-row-icon"><FolderIcon name={f.icon} /></span>
                <span className="svc-row-main">
                  <span className="svc-row-name">{f.title}</span>
                </span>
              </button>
            );
          })}
          <button
            className="svc-row svc-row-new"
            onClick={() => {
              const id = favs.create("新建收藏夹", null);
              if (id) navigate("folder", { folderId: id });
            }}
          >
            <span className="svc-row-icon"><IconFolderPlus /></span>
            <span className="svc-row-main"><span className="svc-row-name">新建收藏夹</span></span>
          </button>
        </Card>
      )}
    </>
  );
}
