import { Btn } from "@onethu/gui";
/**
 * 个人信息页 —— getUserInfo（yyfw 漫游 F315577F… 后正则取名/邮箱；
 * grjbxx 对本应用 403 无权限，仅作兜底）。
 * 脱敏版（demo 分支）：姓名 / 学号来自已脱敏的 profile；登录账号走 displayStudentId。
 */
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useProfile } from "../../state/data.js";
import { useApp } from "../../state/context.js";
import { displayStudentId } from "../../lib/privacy.js";
import { t as i18n } from "../../i18n/index.js";


export function ProfileTab() {
  const { user } = useApp();
  const { data, state, error, reload } = useProfile();

  const rows: Array<[string, string | undefined]> = [
    ["姓名", data?.name],
    ["学号", data?.studentId || displayStudentId(user?.username)],
    ["性别", data?.gender],
    ["院系", data?.department],
    ["专业", data?.major],
    ["登录账号", displayStudentId(user?.username)],
  ];

  return (
    <>
      <SectionHead
        title={i18n("auto.pages.info.ProfileTab.1")}
        aside="由信息门户提供"
        /* actions 参数不存在，刷新按钮放下方标题行右缘 */
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("auto.pages.info.ProfileTab.2")}</Btn>
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
