/**
 * OneGUI 画廊（dev 自检）：组件 × 皮肤 × 明暗 × 密度的验收矩阵。
 *
 * 打开方式：dev 服务器加 ?onegui-gallery=1
 *   http://127.0.0.1:5180/?onegui-gallery=1
 * 用途：① 人眼验收基准；② headless 截图存档；③ 新组件必须在这里登记（护栏 G6）。
 * 它是开发工具，不是产品页面 —— 正式构建里整块被静态删除（import.meta.env.DEV）。
 *
 * 本文件本身就是"页面怎么写"的样板：只用 OneGUI 组件，零 class、零内联样式。
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Accordion, AccordionItem, AppShell, Avatar, Badge, Banner, Breadcrumb, Btn, Card, Checkbox, Chip, CodeBlock, Divider,
  Drawer, EmptyState, Fab, Field, Grid, Icon, IconBtn, Inline, Input, KeyValue, List, LoadingBlock, Modal, MobileTabBar, NavRail,
  BtnGroup, ContextMenu, DataList, Grow, Menu, NumberField, Page, PageHead, Pagination, Popover, Progress, Radio, RadioGroup, RangeSlider, Ring, Row, SearchField, Section,
  SectionCard, Segment, Select, SettingsList, Sheet, SettingsRow, Skeleton, Slider, Spacer, Spinner, Stack, StatTile,
  Surface, Switch, Table, TabStrip, Tabs, Tag, Text, TextArea, Tile, Timeline, Toolbar, Tooltip, useAxes, useOneGUI,
  VerticalTabs, type OGTheme,
} from "@onethu/gui";
import { IconFolder, IconLearn, IconRefresh, IconSettings, IconToday } from "@onethu/gui";
import { t as i18n } from "../i18n/index.js";


const THEMES: OGTheme[] = [
  { id: "brand", name: "清华紫", accent: "#90399c" },
  { id: "blue", name: "湖蓝", accent: "#2f6fd0" },
  { id: "green", name: "松绿", accent: "#1f9d55" },
  { id: "amber", name: "琥珀", accent: "#c47a11" },
];

const SKIN_LEVELS = ["clear", "base", "rich", "deep"] as const;

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <Stack gap={3}>
      <Section title={title} hint={hint} />
      <Inline gap={2} wrap vAlign="center">
        {children}
      </Inline>
    </Stack>
  );
}

function AxisPicker<T extends string>({ label, values, value, onPick }: {
  label: string; values: readonly T[]; value: T; onPick: (v: T) => void;
}): ReactNode {
  return (
    <Inline gap={1}>
      <Text slot="label" tone="quiet">{label}</Text>
      {values.map((v) => (
        <Chip key={v} size="sm" selected={value === v} onClick={() => onPick(v)}>{v}</Chip>
      ))}
    </Inline>
  );
}


/** 第二批：表单 / 浮层 / 页面模式 / 展示件（新组件也要在这里登记） */
function CatalogExtra(): ReactNode {
  const [text, setText] = useState("www");
  const [num, setNum] = useState(3);
  const [pick, setPick] = useState("b");
  const [on, setOn] = useState(true);
  const [slide, setSlide] = useState(40);
  const [range, setRange] = useState<[number, number]>([20, 70]);
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState("all");
  const [vtab, setVtab] = useState("learn");
  const [seg, setSeg] = useState("week");
  const [page, setPage] = useState(3);
  const [openKeys, setOpenKeys] = useState<string[]>(["a"]);

  return (
    <Stack gap={7}>
      <Group title="Field / Input / TextArea / Search" hint={i18n("auto.gallery.OneGUIGallery.1")}>
        <Stack gap={3} className="og-w-320">
          <Field label={i18n("auto.gallery.OneGUIGallery.2")} hint={i18n("auto.gallery.OneGUIGallery.3")} required>
            <Input value={text} onChange={setText} placeholder={i18n("auto.gallery.OneGUIGallery.4")} />
          </Field>
          <Field label={i18n("auto.gallery.OneGUIGallery.5")} error="这一项必填">
            <TextArea rows={2} placeholder={i18n("auto.gallery.OneGUIGallery.6")} />
          </Field>
          <Field label={i18n("auto.gallery.OneGUIGallery.7")}>
            <SearchField defaultValue="" placeholder={i18n("auto.gallery.OneGUIGallery.8")} />
          </Field>
          <Inline gap={2}>
            <Input size="sm" placeholder="sm" />
            <Input size="md" placeholder="md" />
            <Input size="lg" placeholder="lg" />
            <Input invalid placeholder="invalid" />
            <Input disabled placeholder="disabled" />
          </Inline>
        </Stack>
      </Group>

      <Group title="NumberField / Select / Checkbox / Radio" hint={i18n("auto.gallery.OneGUIGallery.9")}>
        <Stack gap={3} className="og-w-320">
          <NumberField value={num} onChange={setNum} min={0} max={10} unit="门" />
          <Select value={pick} onChange={setPick} options={[{ value: "a", label: i18n("auto.gallery.OneGUIGallery.p1") }, { value: "b", label: i18n("auto.gallery.OneGUIGallery.p2") }, { value: "c", label: i18n("auto.gallery.OneGUIGallery.p3"), disabled: true }]} />
          <Inline gap={4} wrap>
            <Checkbox label={i18n("auto.gallery.OneGUIGallery.10")} defaultChecked />
            <Checkbox label={i18n("auto.gallery.OneGUIGallery.11")} indeterminate />
            <Checkbox label={i18n("auto.gallery.OneGUIGallery.12")} disabled />
          </Inline>
          <RadioGroup value={pick} onChange={setPick} direction="row">
            <Radio value="a" label={i18n("auto.gallery.OneGUIGallery.13")} />
            <Radio value="b" label={i18n("auto.gallery.OneGUIGallery.14")} />
            <Radio value="c" label={i18n("auto.gallery.OneGUIGallery.15")} disabled />
          </RadioGroup>
        </Stack>
      </Group>

      <Group title="Switch / Slider / RangeSlider" hint={i18n("auto.gallery.OneGUIGallery.16")}>
        <Stack gap={3} className="og-w-320">
          <Inline gap={3}>
            <Switch checked={on} onChange={setOn} />
            <Text slot="label">{on ? "已开启" : "已关闭"}</Text>
            <Switch checked={false} disabled />
          </Inline>
          <Slider value={slide} onChange={setSlide} showValue />
          <Slider defaultValue={65} showValue format={(v) => `${v}%`} />
          <Inline gap={2}>
            <Slider value={slide} onChange={setSlide} disabled />
            <Slider value={slide} onChange={setSlide} size="sm" />
          </Inline>
          <RangeSlider value={range} onChange={setRange} showValue />
        </Stack>
      </Group>

      <Group title="Modal / Drawer / Menu / ActionSheet" hint={i18n("auto.gallery.OneGUIGallery.17")}>
        <Btn variant="outline" onClick={() => setModal(true)}>{i18n("auto.gallery.OneGUIGallery.18")}</Btn>
        <Btn variant="outline" onClick={() => setDrawer(true)}>{i18n("auto.gallery.OneGUIGallery.19")}</Btn>
        <Btn variant="outline" onClick={() => setMenuOpen(true)}>{i18n("auto.gallery.OneGUIGallery.20")}</Btn>
        <Sheet open={false} onClose={() => undefined} title={i18n("auto.gallery.OneGUIGallery.21")} />
        <Tooltip content="这是工具提示"><Btn variant="ghost">{i18n("auto.gallery.OneGUIGallery.22")}</Btn></Tooltip>
      </Group>

      <Group title="Page / Toolbar / SettingsList / Banner" hint={i18n("auto.gallery.OneGUIGallery.23")}>
        <Stack gap={4} className="og-w-560">
          <Banner tone="info" title={i18n("auto.gallery.OneGUIGallery.24")}>{i18n("auto.gallery.OneGUIGallery.25")}</Banner>
          <Banner tone="warning" title={i18n("auto.gallery.OneGUIGallery.26")} action={<Btn size="sm" variant="outline">{i18n("auto.gallery.OneGUIGallery.27")}</Btn>} />
          <Banner tone="error" title={i18n("auto.gallery.OneGUIGallery.28")} onDismiss={() => undefined}>{i18n("auto.gallery.OneGUIGallery.29")}</Banner>
          <SettingsList title={i18n("auto.gallery.OneGUIGallery.30")}>
            <SettingsRow icon={<IconSettings />} title={i18n("auto.gallery.OneGUIGallery.31")} control={<Switch checked={on} onChange={setOn} />} />
            <SettingsRow icon={<IconRefresh />} title={i18n("auto.gallery.OneGUIGallery.32")} sub={i18n("auto.gallery.OneGUIGallery.33")} value="均衡" caret onClick={() => undefined} />
            <SettingsRow icon={<IconLearn />} title={i18n("auto.gallery.OneGUIGallery.34")} control={<Switch checked={false} onChange={() => undefined} />} />
          </SettingsList>
        </Stack>
      </Group>

      <Group title="Tabs / VerticalTabs / Segment" hint={i18n("auto.gallery.OneGUIGallery.35")}>
        <Stack gap={4} className="og-w-560">
          <Tabs value={tab} onChange={setTab} items={[{ id: "all", label: i18n("auto.gallery.OneGUIGallery.p4"), badge: 12 }, { id: "todo", label: i18n("auto.gallery.OneGUIGallery.p5"), badge: 3 }, { id: "done", label: i18n("auto.gallery.OneGUIGallery.p6") }, { id: "old", label: i18n("auto.gallery.OneGUIGallery.p7") }]} />
          <Tabs variant="pill" value={tab} onChange={setTab} items={[{ id: "all", label: i18n("auto.gallery.OneGUIGallery.p8") }, { id: "todo", label: i18n("auto.gallery.OneGUIGallery.p9") }, { id: "done", label: i18n("auto.gallery.OneGUIGallery.p10") }]} />
          <Tabs variant="soft" value={tab} onChange={setTab} items={[{ id: "all", label: i18n("auto.gallery.OneGUIGallery.p11") }, { id: "todo", label: i18n("auto.gallery.OneGUIGallery.p12") }]} />
          <Segment value={seg} onChange={setSeg} options={[{ value: "day", label: i18n("auto.gallery.OneGUIGallery.p13") }, { value: "week", label: i18n("auto.gallery.OneGUIGallery.p14") }, { value: "month", label: i18n("auto.gallery.OneGUIGallery.p15") }]} />
          <VerticalTabs value={vtab} onChange={setVtab} items={[{ id: "learn", label: i18n("auto.gallery.OneGUIGallery.p16"), icon: <IconLearn />, badge: 3 }, { id: "today", label: i18n("auto.gallery.OneGUIGallery.p17"), icon: <IconToday /> }, { id: "files", label: i18n("auto.gallery.OneGUIGallery.p18"), icon: <IconFolder /> }]} />
        </Stack>
      </Group>

      <Group title="Avatar / Tile / StatTile / Progress / Ring" hint={i18n("auto.gallery.OneGUIGallery.36")}>
        <Inline gap={3} wrap>
          <Avatar name="张三" />
          <Avatar name="李四" size="lg" />
          <Avatar name="Alice" size="xl" tone="info" />
          <Avatar size="sm" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23c33'/%3E%3C/svg%3E" />
        </Inline>
      </Group>

      <Grid min="sm">
        <Tile icon={<IconToday />} label={i18n("auto.gallery.OneGUIGallery.37")} sub={i18n("auto.gallery.OneGUIGallery.38")} />
        <Tile icon={<IconLearn />} label={i18n("auto.gallery.OneGUIGallery.39")} badge={<Badge count={3} standalone tone="error" />} active />
        <Tile icon={<IconFolder />} label={i18n("auto.gallery.OneGUIGallery.40")} disabled />
        <StatTile label={i18n("auto.gallery.OneGUIGallery.41")} value={3} unit="门" hint={i18n("auto.gallery.OneGUIGallery.42")} tone="warning" />
        <StatTile label={i18n("auto.gallery.OneGUIGallery.43")} value="1.2" unit="GB" tone="info" />
        <StatTile label={i18n("auto.gallery.OneGUIGallery.44")} value={5} tone="accent" onClick={() => undefined} />
      </Grid>

      <Stack gap={3} className="og-w-560">
        <Progress value={0.42} label={i18n("auto.gallery.OneGUIGallery.45")} showValue />
        <Progress value={0.8} tone="warning" size="lg" showValue />
        <Inline gap={4}>
          <Ring value={0.25}><Text slot="label">25%</Text></Ring>
          <Ring value={0.6} tone="success" size="lg">6/10</Ring>
          <Ring value={0.9} tone="error" size="sm" />
        </Inline>
      </Stack>

      <Group title="Table / Accordion / Timeline / Breadcrumb / Pagination">
        <Stack gap={4}>
          <Stack gap={3} className="og-w-560">
            <Table
              columns={[
                { key: "name", title: i18n("auto.gallery.OneGUIGallery.p19"), value: (r: { name: string }) => r.name },
                { key: "credit", title: i18n("auto.gallery.OneGUIGallery.p20"), align: "right", mono: true, value: (r: { credit: string }) => r.credit },
                { key: "score", title: i18n("auto.gallery.OneGUIGallery.p21"), align: "right", mono: true, value: (r: { score: string }) => r.score },
              ] as never}
              rows={[{ name: "高等数学", credit: "4", score: "92" }, { name: "线性代数", credit: "3", score: "88" }, { name: "大学物理", credit: "3", score: "85" }]}
              rowKey={(r: { name: string }) => r.name}
            />
          </Stack>
          <Card flush>
            <Accordion openKeys={openKeys} onToggle={(id) => setOpenKeys((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]))}>
              <AccordionItem id="a" title={i18n("auto.gallery.OneGUIGallery.46")} sub={i18n("auto.gallery.OneGUIGallery.47")}>
                <Text tone="quiet">{i18n("auto.gallery.OneGUIGallery.48")}</Text>
              </AccordionItem>
              <AccordionItem id="b" title={i18n("auto.gallery.OneGUIGallery.49")} trailing={<Tag tone="info">{i18n("auto.gallery.OneGUIGallery.50")}</Tag>}>
                <Text tone="quiet">{i18n("auto.gallery.OneGUIGallery.51")}</Text>
              </AccordionItem>
            </Accordion>
          </Card>
          <Stack gap={3} className="og-w-560">
            <Timeline
              items={[
                { time: "09:00", title: i18n("auto.gallery.OneGUIGallery.p22"), sub: i18n("auto.gallery.OneGUIGallery.p23"), tone: "warning" },
                { time: "12:30", title: i18n("auto.gallery.OneGUIGallery.p24"), tone: "success" },
                { time: "18:00", title: i18n("auto.gallery.OneGUIGallery.p25"), sub: i18n("auto.gallery.OneGUIGallery.p26") },
              ]}
            />
            <Breadcrumb items={[{ label: i18n("auto.gallery.OneGUIGallery.p27"), onClick: () => undefined }, { label: i18n("auto.gallery.OneGUIGallery.p28"), onClick: () => undefined }, { label: i18n("auto.gallery.OneGUIGallery.p29") }]} />
            <Pagination page={page} pageCount={12} onChange={setPage} />
            <CodeBlock code={"pnpm --filter @onethu/desktop dev"} lang="bash" />
            <LoadingBlock rows={2} />
            <Inline gap={2}><Spinner /><Spinner size="sm" /><Spinner size="lg" /></Inline>
          </Stack>
        </Stack>
      </Group>

      <Group title={i18n("auto.gallery.OneGUIGallery.52")} hint={i18n("auto.gallery.OneGUIGallery.53")}>
        <Stack gap={4} className="og-w-560">
          <Inline gap={0}>
            <BtnGroup>
              <Btn variant="outline" size="sm">{i18n("auto.gallery.OneGUIGallery.54")}</Btn>
              <Btn variant="outline" size="sm">{i18n("auto.gallery.OneGUIGallery.55")}</Btn>
              <Btn variant="outline" size="sm">{i18n("auto.gallery.OneGUIGallery.56")}</Btn>
            </BtnGroup>
            <Grow><Text slot="label" tone="faint">{i18n("auto.gallery.OneGUIGallery.57")}</Text></Grow>
          </Inline>
          <DataList
            items={[{ id: "1", name: "高数作业", meta: i18n("auto.gallery.OneGUIGallery.p30") }, { id: "2", name: "线代作业", meta: i18n("auto.gallery.OneGUIGallery.p31") }]}
            keyOf={(r: { id: string }) => r.id}
            render={(r: { name: string; meta: string }) => <Row title={r.name} sub={r.meta} caret onClick={() => undefined} />}
            divided
          />
          <Inline gap={2}>
            <Popover open={false} onClose={() => undefined} anchor={null}><Text>{i18n("auto.gallery.OneGUIGallery.58")}</Text></Popover>
            <ContextMenu open={false} x={0} y={0} onClose={() => undefined} items={[{ id: "a", label: i18n("auto.gallery.OneGUIGallery.p32") }]} />
            <Text slot="micro" tone="faint">{i18n("auto.gallery.OneGUIGallery.59")}</Text>
          </Inline>
        </Stack>
      </Group>

      <Group title={i18n("auto.gallery.OneGUIGallery.60")}>
        <Stack gap={3} className="og-w-320">
          <Skeleton lines={3} />
          <Inline gap={2}>
            <Skeleton width="xs" height="xs" circle />
            <Skeleton width="lg" height="lg" radius="md" />
            <Skeleton width="md" height="md" />
          </Inline>
        </Stack>
        <IconRefresh />
        <IconSettings />
        <IconFolder />
      </Group>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={i18n("auto.gallery.OneGUIGallery.61")}
        foot={<><Btn variant="ghost" onClick={() => setModal(false)}>{i18n("auto.gallery.OneGUIGallery.62")}</Btn><Btn variant="solid" tone="brand" onClick={() => setModal(false)}>{i18n("auto.gallery.OneGUIGallery.63")}</Btn></>}
      >
        <Text>{i18n("auto.gallery.OneGUIGallery.64")}</Text>
      </Modal>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title={i18n("auto.gallery.OneGUIGallery.65")}>
        <Text>{i18n("auto.gallery.OneGUIGallery.66")}</Text>
      </Drawer>

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          { id: "open", label: i18n("auto.gallery.OneGUIGallery.p33") },
          { id: "rename", label: i18n("auto.gallery.OneGUIGallery.p34") },
          "separator",
          { id: "del", label: i18n("auto.gallery.OneGUIGallery.p35"), danger: true },
        ]}
      />
    </Stack>
  );
}


/** 整壳预览：外框（竖栏/顶栏/内容/底部条）就是 AppShell，页面内容就是 Page —— 没有第二种写法 */
function ShellPreview(): ReactNode {
  const [active, setActive] = useState("home");
  const tabs = [
    { id: "home", label: i18n("auto.gallery.OneGUIGallery.p36"), pinned: true, icon: <IconToday /> },
    { id: "learn", label: i18n("auto.gallery.OneGUIGallery.p37"), icon: <IconLearn />, badge: 3, onClose: () => undefined },
    { id: "cloud", label: i18n("auto.gallery.OneGUIGallery.p38"), icon: <IconFolder />, onClose: () => undefined },
    { id: "settings", label: i18n("auto.gallery.OneGUIGallery.p39"), icon: <IconSettings />, onClose: () => undefined },
  ];
  return (
    <Stack gap={3}>
      <Section title={i18n("auto.gallery.OneGUIGallery.67")} hint="AppShell: rail + topbar + content" />
      <div className="og-preview-frame">
        <AppShell
          tabs={tabs}
          activeTab={active}
          onSelectTab={setActive}
          desktopLayout="rail"
          brand={<Text slot="subtitle" as="span">OneTHU</Text>}
          railActions={<><IconBtn label={i18n("auto.gallery.OneGUIGallery.68")} size="sm" variant="ghost" icon={<Icon><path d="M8 8h11v11H8z" /><path d="M5 16V5h11" /></Icon>} /><IconBtn label={i18n("auto.gallery.OneGUIGallery.69")} size="sm" variant="ghost" icon={<IconSettings />} /></>}
          actions={<><IconBtn label={i18n("auto.gallery.OneGUIGallery.70")} size="sm" variant="ghost" icon={<IconRefresh />} /><IconBtn label={i18n("auto.gallery.OneGUIGallery.69")} size="sm" variant="ghost" icon={<IconSettings />} /></>}
        >
          <Page title={i18n("auto.gallery.OneGUIGallery.39")} sub={i18n("auto.gallery.OneGUIGallery.71")} actions={<Btn size="sm" variant="outline" icon={<IconRefresh />}>{i18n("auto.gallery.OneGUIGallery.70")}</Btn>}>
            <Toolbar align="between">
              <Tabs value="hw" onChange={() => undefined} items={[{ id: "hw", label: i18n("auto.gallery.OneGUIGallery.p40"), badge: 3 }, { id: "notice", label: i18n("auto.gallery.OneGUIGallery.p41") }, { id: "file", label: i18n("auto.gallery.OneGUIGallery.p42") }]} />
            </Toolbar>
            <SettingsList title={i18n("auto.gallery.OneGUIGallery.72")}>
              <SettingsRow icon={<IconLearn />} title={i18n("auto.gallery.OneGUIGallery.73")} sub={i18n("auto.gallery.OneGUIGallery.74")} value="待交" caret onClick={() => undefined} />
              <SettingsRow icon={<IconLearn />} title={i18n("auto.gallery.OneGUIGallery.75")} sub={i18n("auto.gallery.OneGUIGallery.76")} value="已交" caret onClick={() => undefined} />
            </SettingsList>
          </Page>
        </AppShell>
      </div>

      <Section title={i18n("auto.gallery.OneGUIGallery.77")} hint={i18n("auto.gallery.OneGUIGallery.78")} />
      <div className="og-preview-frame og-preview-frame--phone">
        <div className="og-phone-mock">
          <AppShell
            tabs={tabs}
            activeTab={active}
            onSelectTab={setActive}
            platform="mobile"
            onMore={() => undefined}
            brand={<Text slot="label" as="span">OneTHU</Text>}
            actions={<IconBtn label={i18n("auto.gallery.OneGUIGallery.70")} size="sm" variant="ghost" icon={<IconRefresh />} />}
          >
            <Page title={i18n("auto.gallery.OneGUIGallery.79")} sub={i18n("auto.gallery.OneGUIGallery.80")}>
              <Card title={i18n("auto.gallery.OneGUIGallery.81")}>
                <List divided>
                  <Row flush title={i18n("auto.gallery.OneGUIGallery.82")} meta="08:00" sub={i18n("auto.gallery.OneGUIGallery.83")} caret onClick={() => undefined} />
                  <Row flush title={i18n("auto.gallery.OneGUIGallery.84")} meta="10:00" sub={i18n("auto.gallery.OneGUIGallery.85")} caret onClick={() => undefined} />
                </List>
              </Card>
            </Page>
          </AppShell>
        </div>
      </div>
      <Section title={i18n("auto.gallery.OneGUIGallery.86")} hint={i18n("auto.gallery.OneGUIGallery.87")} />
      <Stack gap={3} className="og-w-560">
        <Surface level={1} pad="sm">
          <TabStrip tabs={tabs} activeTab={active} onSelect={setActive} onMore={() => undefined} />
        </Surface>
        <Surface level={1} pad="sm" className="og-preview-phone">
          <MobileTabBar items={tabs} active={active} onSelect={setActive} />
        </Surface>
        <Surface level={1} pad="sm" className="og-preview-narrow">
          <NavRail tabs={tabs} activeTab={active} onSelect={setActive} />
        </Surface>
      </Stack>
    </Stack>
  );
}

/** 组件目录：新组件必须在这里出现（护栏 G6 会核对导出与登记） */
function Catalog(): ReactNode {
  return (
    <Stack gap={7}>
      <Group title={i18n("auto.gallery.OneGUIGallery.88")} hint="solid / tonal / outline / ghost / plain">
        <Btn variant="solid" tone="brand">{i18n("auto.gallery.OneGUIGallery.89")}</Btn>
        <Btn variant="tonal" tone="brand">{i18n("auto.gallery.OneGUIGallery.90")}</Btn>
        <Btn variant="outline">{i18n("auto.gallery.OneGUIGallery.91")}</Btn>
        <Btn variant="ghost">{i18n("auto.gallery.OneGUIGallery.92")}</Btn>
        <Btn variant="plain">{i18n("auto.gallery.OneGUIGallery.93")}</Btn>
        <Btn variant="solid" tone="brand" loading>{i18n("auto.gallery.OneGUIGallery.94")}</Btn>
        <Btn variant="solid" tone="brand" disabled>{i18n("auto.gallery.OneGUIGallery.12")}</Btn>
      </Group>

      <Group title={i18n("auto.gallery.OneGUIGallery.95")} hint={i18n("auto.gallery.OneGUIGallery.96")}>
        <Btn variant="solid" tone="brand">brand</Btn>
        <Btn variant="solid" tone="error">error</Btn>
        <Btn variant="solid" tone="warning">warning</Btn>
        <Btn variant="solid" tone="success">success</Btn>
        <Btn variant="solid" tone="info">info</Btn>
        <Btn variant="tonal" tone="error">tonal error</Btn>
        <Btn variant="outline" tone="info">outline info</Btn>
      </Group>

      <Group title={i18n("auto.gallery.OneGUIGallery.97")} hint={i18n("auto.gallery.OneGUIGallery.98")}>
        <Btn size="sm" variant="outline">{i18n("auto.gallery.OneGUIGallery.99")}</Btn>
        <Btn size="md" variant="outline">{i18n("auto.gallery.OneGUIGallery.55")}</Btn>
        <Btn size="lg" variant="outline">{i18n("auto.gallery.OneGUIGallery.100")}</Btn>
        <Btn variant="solid" tone="brand" icon={<Icon><path d="M12 5v14M5 12h14" /></Icon>}>{i18n("auto.gallery.OneGUIGallery.101")}</Btn>
        <IconBtn label={i18n("auto.gallery.OneGUIGallery.69")} variant="outline" icon={<Icon><circle cx="12" cy="12" r="3" /></Icon>} />
        <IconBtn label={i18n("auto.gallery.OneGUIGallery.70")} round variant="tonal" tone="brand" icon={<Icon><path d="M20 12a8 8 0 1 1-2.34-5.66" /></Icon>} />
      </Group>

      <Group title={i18n("auto.gallery.OneGUIGallery.102")} hint="display / title / subtitle / body / label / micro">
        <Stack gap={1}>
          <Text slot="display">{i18n("auto.gallery.OneGUIGallery.103")}</Text>
          <Text slot="title">{i18n("auto.gallery.OneGUIGallery.104")}</Text>
          <Text slot="subtitle">{i18n("auto.gallery.OneGUIGallery.105")}</Text>
          <Text slot="body">{i18n("auto.gallery.OneGUIGallery.106")}</Text>
          <Text slot="label">{i18n("auto.gallery.OneGUIGallery.107")}</Text>
          <Text slot="micro">{i18n("auto.gallery.OneGUIGallery.108")}</Text>
          <Inline gap={3} wrap>
            <Text tone="quiet">{i18n("auto.gallery.OneGUIGallery.109")}</Text>
            <Text tone="faint">{i18n("auto.gallery.OneGUIGallery.110")}</Text>
            <Text tone="brand">{i18n("auto.gallery.OneGUIGallery.111")}</Text>
            <Text tone="error">{i18n("auto.gallery.OneGUIGallery.112")}</Text>
            <Text tone="success">{i18n("auto.gallery.OneGUIGallery.113")}</Text>
            <Text mono>mono 1234.56</Text>
          </Inline>
        </Stack>
      </Group>

      <Group title="Chip / Tag / Badge">
        <Chip>{i18n("auto.gallery.OneGUIGallery.114")}</Chip>
        <Chip tone="brand">{i18n("auto.gallery.OneGUIGallery.115")}</Chip>
        <Chip tone="error">{i18n("auto.gallery.OneGUIGallery.116")}</Chip>
        <Chip tone="success" selected>{i18n("auto.gallery.OneGUIGallery.117")}</Chip>
        <Chip onClick={() => undefined}>{i18n("auto.gallery.OneGUIGallery.118")}</Chip>
        <Chip onRemove={() => undefined}>{i18n("auto.gallery.OneGUIGallery.119")}</Chip>
        <Tag>{i18n("auto.gallery.OneGUIGallery.120")}</Tag>
        <Tag tone="info">info</Tag>
        <Badge count={3} standalone />
        <Badge dot standalone />
        <Badge count={12}>
          <IconBtn label={i18n("auto.gallery.OneGUIGallery.121")} variant="outline" icon={<Icon><path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z" /></Icon>} />
        </Badge>
      </Group>

      <Stack gap={3}>
        <Section title={i18n("auto.gallery.OneGUIGallery.122")} hint={i18n("auto.gallery.OneGUIGallery.123")} />
        <Grid min="sm">
          <Surface level={0} pad="md"><Text slot="label">level 0</Text></Surface>
          <Surface level={1} pad="md"><Text slot="label">level 1</Text></Surface>
          <Surface level={2} pad="md"><Text slot="label">level 2</Text></Surface>
          <Surface level={3} pad="md"><Text slot="label">level 3</Text></Surface>
          <Surface level={0} elevation={1} pad="md"><Text slot="label">elev 1</Text></Surface>
          <Surface level={0} elevation={2} pad="md"><Text slot="label">elev 2</Text></Surface>
          <Surface sunken pad="md"><Text slot="label">{i18n("auto.gallery.OneGUIGallery.124")}</Text></Surface>
          <Surface level={0} pad="md" interactive selected><Text slot="label">selected</Text></Surface>
        </Grid>
      </Stack>

      <Grid min="md">
        <Card
          title={i18n("auto.gallery.OneGUIGallery.125")}
          headAside={<Btn size="sm" variant="ghost">{i18n("auto.gallery.OneGUIGallery.126")}</Btn>}
          foot={<><Btn size="sm" variant="ghost">{i18n("auto.gallery.OneGUIGallery.62")}</Btn><Btn size="sm" variant="solid" tone="brand">{i18n("auto.gallery.OneGUIGallery.63")}</Btn></>}
        >
          <Text tone="quiet">{i18n("auto.gallery.OneGUIGallery.127")}</Text>
        </Card>

        <Card flush>
          <List divided>
            <Row flush caret onClick={() => undefined} title={i18n("auto.gallery.OneGUIGallery.128")} sub={i18n("auto.gallery.OneGUIGallery.129")} trailing="查看"
              leading={<Icon><circle cx="12" cy="12" r="9" /></Icon>} />
            <Row flush caret onClick={() => undefined} title={i18n("auto.gallery.OneGUIGallery.130")} sub={i18n("auto.gallery.OneGUIGallery.131")} trailing={<Tag tone="warning">{i18n("auto.gallery.OneGUIGallery.132")}</Tag>}
              leading={<Icon><path d="M4 7h16v10H4z" /></Icon>} />
            <Row flush title={i18n("auto.gallery.OneGUIGallery.133")} meta="meta" trailing="—" leading={<Icon><path d="M12 5v14M5 12h14" /></Icon>} />
          </List>
        </Card>

        <Card title={i18n("auto.gallery.OneGUIGallery.134")}>
          <KeyValue rows={[{ k: "学号", v: "2021••••" }, { k: "余额", v: "¥ 42.00" }, { k: "连接", v: "已连接" }]} />
        </Card>

        <Card title={i18n("auto.gallery.OneGUIGallery.135")}>
          <EmptyState
            icon={<Icon size="xl"><path d="M4 6h16v12H4z" /></Icon>}
            title={i18n("auto.gallery.OneGUIGallery.136")}
            hint={i18n("auto.gallery.OneGUIGallery.137")}
            action={<Btn variant="solid" tone="brand">{i18n("auto.gallery.OneGUIGallery.138")}</Btn>}
          />
        </Card>

        <Card title={i18n("auto.gallery.OneGUIGallery.139")}>
          <Grid min="sm">
            {["高数", "线代", "大物", "思修"].map((name) => (
              <Surface key={name} level={1} pad="md" interactive>
                <Stack gap={1}>
                  <Text slot="subtitle">{name}</Text>
                  <Text slot="label" tone="faint">{i18n("auto.gallery.OneGUIGallery.140")}</Text>
                </Stack>
              </Surface>
            ))}
          </Grid>
        </Card>

        <Card title={i18n("auto.gallery.OneGUIGallery.141")}>
          <Stack gap={2}>
            <Text>{i18n("auto.gallery.OneGUIGallery.142")}</Text>
            <Divider />
            <Text>{i18n("auto.gallery.OneGUIGallery.143")}</Text>
            <Divider inset />
            <Text>{i18n("auto.gallery.OneGUIGallery.144")}</Text>
            <Inline gap={2}>
              <Text>{i18n("auto.gallery.OneGUIGallery.54")}</Text>
              <Divider vertical />
              <Text>{i18n("auto.gallery.OneGUIGallery.56")}</Text>
            </Inline>
          </Stack>
        </Card>
      </Grid>
    </Stack>
  );
}

export function OneGUIGallery(): ReactNode {
  const axes = useAxes();
  const director = useOneGUI();
  const [themeIdx, setThemeIdx] = useState(-1);

  // URL 轴覆盖（截图/验收用）：?onegui-gallery&skin=glass&scheme=dark&density=touch&level=rich
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const patch: Record<string, string> = {};
    const skin = q.get("skin");
    if (skin === "glass" || skin === "neutral") patch.skin = skin;
    const scheme = q.get("scheme");
    if (scheme === "light" || scheme === "dark" || scheme === "auto") patch.scheme = scheme;
    const density = q.get("density");
    if (density === "compact" || density === "comfortable" || density === "touch") patch.density = density;
    const level = q.get("level");
    if (level) patch.skinLevel = level;
    if (Object.keys(patch).length > 0) director.set(patch as never, { persist: false });
  }, [director]);

  return (
    <Stack gap={6} pad={6}>
      <Stack gap={2}>
        <Text slot="display">{i18n("auto.gallery.OneGUIGallery.145")}</Text>
        <Text tone="quiet">
          {i18n("auto.gallery.OneGUIGallery.146")}</Text>
      </Stack>

      <Surface level={1} pad="md" sticky>
        <Stack gap={2}>
          <Inline gap={3} wrap>
            <AxisPicker label={i18n("auto.gallery.OneGUIGallery.147")} values={["neutral", "glass"] as const} value={axes.skin === "glass" ? "glass" : "neutral"} onPick={(v) => director.set({ skin: v })} />
            {axes.skin === "glass" ? (
              <AxisPicker label={i18n("auto.gallery.OneGUIGallery.148")} values={SKIN_LEVELS} value={axes.skinLevel as typeof SKIN_LEVELS[number]} onPick={(v) => director.set({ skinLevel: v })} />
            ) : null}
            <AxisPicker label={i18n("auto.gallery.OneGUIGallery.149")} values={["auto", "light", "dark"] as const} value={axes.scheme} onPick={(v) => director.set({ scheme: v })} />
            <AxisPicker label={i18n("auto.gallery.OneGUIGallery.150")} values={["compact", "comfortable", "touch"] as const} value={axes.density} onPick={(v) => director.set({ density: v })} />
            <AxisPicker label={i18n("auto.gallery.OneGUIGallery.151")} values={["full", "reduced"] as const} value={axes.motion} onPick={(v) => director.set({ motion: v })} />
          </Inline>
          <Inline gap={1} wrap>
            <Text slot="label" tone="quiet">{i18n("auto.gallery.OneGUIGallery.152")}</Text>
            {THEMES.map((t, i) => (
              <Chip key={t.id} size="sm" selected={themeIdx === i} onClick={() => { setThemeIdx(i); director.set({ theme: t }, { persist: false }); }}>
                {t.name}
              </Chip>
            ))}
            <Chip size="sm" selected={themeIdx === -1} onClick={() => { setThemeIdx(-1); director.set({ theme: null }, { persist: false }); }}>{i18n("auto.gallery.OneGUIGallery.153")}</Chip>
            <Spacer />
            <Text slot="micro" tone="faint">platform = {axes.platform}</Text>
          </Inline>
        </Stack>
      </Surface>

      <ShellPreview />
      <Catalog />
      <CatalogExtra />
    </Stack>
  );
}
