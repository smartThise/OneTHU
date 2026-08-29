/**
 * 个人信息页 —— getUserInfo（demo basics.getUserInfo 同款：yyfw 漫游 F315577F…
 * 后正则取名/邮箱；grjbxx 对本应用 403 无权限，仅作兜底）。
 * demo 该接口只提供姓名+邮箱，其余字段留空。
 */
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useProfile } from "../../state/data.js";
import { useApp } from "../../state/context.js";

export function ProfileTab() {
  const { user } = useApp();
  const { data, state, error, reload } = useProfile();

  const rows: Array<[string, string | undefined]> = [
    ["姓名", data?.name],
    ["学号", data?.studentId || user?.username],
    ["性别", data?.gender],
    ["院系", data?.department],
    ["专业", data?.major],
    ["登录账号", user?.username],
  ];

  return (
    <>
      <SectionHead
        title="个人信息"
        aside="yyfw 漫游（demo 同款）"
        /* actions 参数不存在，刷新按钮放下方标题行右缘 */
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
          <IconRefresh width={14} height={14} />
          刷新
        </button>
      </div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : !data ? (
        <Card>
          <Empty text="暂无个人信息。" />
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {rows.map(([label, value]) => (
            <div className="setting-row" key={label}>
              <div>
                <div className="setting-title">{value || "–"}</div>
                <div className="setting-desc">{label}</div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
