import { useCallback, type ReactNode } from "react";
/**
 * 通讯录「我的组织」页签：组织列表 + 新建/加入。
 *
 * 组织本身是完整页面（page=org，pages/Organization.tsx）：成员 / 资料库 / GitLab / 项目 / 公告。
 * 这里只做列表与入口，不再有管理弹层（2026-10-19 用户拍板「组织不能只是一张卡片」）。
 */
import { Btn, Card, List, Row, Text } from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import { openFormModal } from "../lib/formModal.js";
import { showToast } from "../state/toast.js";
import { openTab } from "../state/explorer.js";
import {
  acceptOrgInvite, createOrg, currentOrgEmail, deleteOrg, useOrgs,
} from "../state/org.js";
import { confirmOk } from "../lib/confirm.js";
import { t as i18n } from "../i18n/index.js";


defineSearchRows([
  {
    id: "set-orgs", tab: "账号", section: "我的组织", title: "我的组织",
    aliases: ["组织", "建组织", "成员", "邀请"], desc: "建立组织、邀请成员、共享资料库与 GitLab 仓库",
    breadcrumb: ["设置", "账号", "我的组织", "我的组织"],
  },
  {
    id: "set-org-invite", tab: "账号", section: "我的组织", title: "组织邀请口令",
    aliases: ["邀请口令", "加入组织", "组织名片"], desc: "生成/接受组织邀请口令（可限定接收邮箱）",
    breadcrumb: ["设置", "账号", "我的组织", "组织邀请口令"],
  },
]);

export function OrganizationSection(): ReactNode {
  const doc = useOrgs();

  const create = useCallback(async (): Promise<void> => {
    const email = await currentOrgEmail();
    const f = await openFormModal("新建组织", [
      { key: "name", label: i18n("auto.components.OrganizationSection.p1"), required: true },
      { key: "brief", label: i18n("auto.components.OrganizationSection.p2"), kind: "textarea" },
      { key: "joinUrl", label: i18n("auto.components.OrganizationSection.p3") },
    ]);
    if (!f?.name) return;
    const org = createOrg({ name: f.name, brief: f.brief, joinUrl: f.joinUrl, ownerEmail: email });
    openTab("org", { orgId: org.id }, { title: org.name });
    showToast(`已创建「${org.name}」`);
  }, []);

  const join = useCallback(async (): Promise<void> => {
    const f = await openFormModal("加入组织", [
      { key: "code", label: i18n("auto.components.OrganizationSection.p4"), kind: "textarea", required: true },
      { key: "name", label: i18n("auto.components.OrganizationSection.p5"), default: "我" },
    ]);
    if (!f?.code) return;
    const r = await acceptOrgInvite(f.code, f.name || "我");
    if (!r.ok) {
      showToast(r.reason ?? "邀请口令无法识别");
      return;
    }
    showToast(i18n("auto.components.OrganizationSection.msg1"));
    if (r.orgId) openTab("org", { orgId: r.orgId }, { title: i18n("auto.components.OrganizationSection.p6") });
  }, []);

  return (
    <Card>
      <div className="name-card">
        <div className="name-card-actions">
          <Btn variant="solid" tone="brand" size="sm" onClick={() => void create()}>{i18n("auto.components.OrganizationSection.1")}</Btn>
          <Btn variant="ghost" size="sm" onClick={() => void join()}>{i18n("auto.components.OrganizationSection.2")}</Btn>
        </div>
        {doc.orgs.length === 0 ? (
          <Text slot="micro" tone="faint">{i18n("auto.components.OrganizationSection.3")}</Text>
        ) : (
          <List divided>
            {doc.orgs.map((o) => (
              <Row
                key={o.id}
                flush
                title={o.name}
                onClick={() => openTab("org", { orgId: o.id }, { title: o.name })}
                sub={`${o.members.length} 名成员 · ${(o.libraries ?? []).length} 个资料库 · ${(o.gitlabRepos ?? []).length} 个仓库${o.joinUrl ? " · 已设加入方式" : ""}`}
                trailing={
                  <span className="name-card-actions">
                    <Btn variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openTab("org", { orgId: o.id }, { title: o.name }); }}>{i18n("auto.components.OrganizationSection.4")}</Btn>
                    <Btn variant="ghost" size="sm" tone="error" onClick={(e) => { e.stopPropagation(); void confirmOk(`删除组织「${o.name}」？成员清单会一起删除（云盘资料库与 GitLab 仓库不动）。`).then((ok) => { if (ok) deleteOrg(o.id); }); }}>{i18n("auto.components.OrganizationSection.5")}</Btn>
                  </span>
                }
              />
            ))}
          </List>
        )}
      </div>
    </Card>
  );
}
