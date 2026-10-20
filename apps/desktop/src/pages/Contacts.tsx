import { useApp } from "../state/context.js";
/**
 * 通讯录：一级功能区页面（名片夹 + 我的组织）。
 *
 * 入口：一级功能区 / 全局搜索 / 收藏（page=contacts，NAV_REGISTRY 已登记）。
 * 结构：完整页头（标题 / 说明 / 收藏星标）→ 段切换 → 名片夹或组织。
 * 名片夹本体在 components/NameCardSection.tsx（拟物纸卡 + 堆叠 + Modal 大卡）；
 * 组织页签 = 组织名片 + 组织成员/邀请口令（OrganizationSection，与设置页共用同一份实现）。
 */
import { useState } from "react";
import { Btn, Inline, Segment, Stack, Text } from "@onethu/gui";
import { PageHead } from "../components/Layout.js";
import { PageAtomStar } from "../components/Collect.js";
import { NameCardSection, OrgCardsSection } from "../components/NameCardSection.js";
import { OrganizationSection } from "../components/OrganizationSection.js";
import { t as i18n } from "../i18n/index.js";


type ContactsTab = "cards" | "orgs";

export function ContactsPage() {
  const { navParams } = useApp();
  const [tab, setTab] = useState<ContactsTab>((navParams as {section?:string}|null)?.section==="orgs"?"orgs":"cards");
  return (
    <div className="contacts-page">
      <PageHead
        title={i18n("auto.pages.Contacts.1")}
        meta="交换一张名片，让联结留在这里。"
        actions={<PageAtomStar atomKey="contacts" title={i18n("auto.pages.Contacts.1")} />}
      />
      <div className="contacts-tabs">
        <Segment
          value={tab}
          onChange={(v) => setTab(v as ContactsTab)}
          options={[
            { value: "cards", label: i18n("auto.pages.Contacts.p1") },
            { value: "orgs", label: i18n("auto.pages.Contacts.p2") },
          ]}
        />
      </div>
      {tab === "cards" ? (
        <NameCardSection view="contacts" />
      ) : (
        <Stack gap={6}>

          <div className="contacts-orgs">
            <Text slot="label" tone="faint">
              {i18n("auto.pages.Contacts.2")}</Text>
            <OrganizationSection />
          </div>
          <Inline gap={2} wrap>
            <Btn variant="ghost" onClick={() => setTab("cards")}>
              {i18n("auto.pages.Contacts.3")}</Btn>
          </Inline>
        </Stack>
      )}
    </div>
  );
}