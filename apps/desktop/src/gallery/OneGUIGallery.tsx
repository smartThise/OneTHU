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
  FocalImage, Accordion, AccordionItem, AppShell, Avatar, Badge, Banner, Breadcrumb, Btn, Card, Checkbox, Chip, CodeBlock, Divider,
  Drawer, EmptyState, Fab, Field, Grid, Icon, IconBtn, Inline, Input, KeyValue, List, LoadingBlock, Modal, MobileTabBar, NavRail,
  BtnGroup, ContextMenu, DataList, Grow, Menu, NumberField, Page, PageHead, Pagination, Popover, Progress, Radio, RadioGroup, RangeSlider, Ring, Row, SearchField, Section,
  SectionCard, Segment, Select, SettingsList, Sheet, SettingsRow, Skeleton, Slider, Spacer, Spinner, Stack, StatTile,
  Surface, Switch, Table, TabStrip, Tabs, Tag, Text, TextArea, Tile, Timeline, Toolbar, Tooltip, useAxes, useOneGUI,
  VerticalTabs, type OGTheme,
} from "@onethu/gui";
import { IconFolder, IconLearn, IconRefresh, IconSettings, IconToday } from "@onethu/gui";

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
      <Group title="Field / Input / TextArea / Search" hint="输入壳共享同一套描边与聚焦环">
        <Stack gap={3} className="og-w-320">
          <Field label="学号" hint="用于登录校园服务" required>
            <Input value={text} onChange={setText} placeholder="请输入学号" />
          </Field>
          <Field label="备注" error="这一项必填">
            <TextArea rows={2} placeholder="多行输入" />
          </Field>
          <Field label="搜索">
            <SearchField defaultValue="" placeholder="搜课程 / 文件 / 邮件" />
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

      <Group title="NumberField / Select / Checkbox / Radio" hint="右侧是控件，左侧是内容">
        <Stack gap={3} className="og-w-320">
          <NumberField value={num} onChange={setNum} min={0} max={10} unit="门" />
          <Select value={pick} onChange={setPick} options={[{ value: "a", label: "选项 A" }, { value: "b", label: "选项 B" }, { value: "c", label: "选项 C（禁用）", disabled: true }]} />
          <Inline gap={4} wrap>
            <Checkbox label="记住我" defaultChecked />
            <Checkbox label="半选" indeterminate />
            <Checkbox label="禁用" disabled />
          </Inline>
          <RadioGroup value={pick} onChange={setPick} direction="row">
            <Radio value="a" label="甲" />
            <Radio value="b" label="乙" />
            <Radio value="c" label="丙" disabled />
          </RadioGroup>
        </Stack>
      </Group>

      <Group title="FocalImage" hint="图片取景由受控焦点与缩放决定，外观沿用媒体令牌">
        <FocalImage src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 160'%3E%3Crect width='320' height='160' fill='silver'/%3E%3Ccircle cx='110' cy='80' r='48' fill='white'/%3E%3C/svg%3E" alt="OneTHU" focusX={.5} focusY={.5} zoom={1} className="og-w-320" />
      </Group>

      <Group title="Switch / Slider / RangeSlider" hint="拖拽用 pointer capture；方向键可调">
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

      <Group title="Modal / Drawer / Menu / ActionSheet" hint="portal 到 body；退场有相位">
        <Btn variant="outline" onClick={() => setModal(true)}>打开弹窗</Btn>
        <Btn variant="outline" onClick={() => setDrawer(true)}>打开抽屉</Btn>
        <Btn variant="outline" onClick={() => setMenuOpen(true)}>打开菜单</Btn>
        <Sheet open={false} onClose={() => undefined} title="底部抽屉" />
        <Tooltip content="这是工具提示"><Btn variant="ghost">悬停看提示</Btn></Tooltip>
      </Group>

      <Group title="Page / Toolbar / SettingsList / Banner" hint="页面骨架与设置行">
        <Stack gap={4} className="og-w-560">
          <Banner tone="info" title="这是一条信息横幅">可用于校内服务维护通知。</Banner>
          <Banner tone="warning" title="会话即将过期" action={<Btn size="sm" variant="outline">重新登录</Btn>} />
          <Banner tone="error" title="同步失败" onDismiss={() => undefined}>网络不可达。</Banner>
          <SettingsList title="外观">
            <SettingsRow icon={<IconSettings />} title="跟随系统明暗" control={<Switch checked={on} onChange={setOn} />} />
            <SettingsRow icon={<IconRefresh />} title="玻璃浓淡" sub="只在玻璃皮肤下生效" value="磨砂" caret onClick={() => undefined} />
            <SettingsRow icon={<IconLearn />} title="网络学堂自动刷新" control={<Switch checked={false} onChange={() => undefined} />} />
          </SettingsList>
        </Stack>
      </Group>

      <Group title="Tabs / VerticalTabs / Segment" hint="一条共享的滑动指示器">
        <Stack gap={4} className="og-w-560">
          <Tabs value={tab} onChange={setTab} items={[{ id: "all", label: "全部", badge: 12 }, { id: "todo", label: "待办", badge: 3 }, { id: "done", label: "已完成" }, { id: "old", label: "归档" }]} />
          <Tabs variant="pill" value={tab} onChange={setTab} items={[{ id: "all", label: "胶囊" }, { id: "todo", label: "待办" }, { id: "done", label: "已完成" }]} />
          <Tabs variant="soft" value={tab} onChange={setTab} items={[{ id: "all", label: "软底" }, { id: "todo", label: "待办" }]} />
          <Segment value={seg} onChange={setSeg} options={[{ value: "day", label: "日" }, { value: "week", label: "周" }, { value: "month", label: "月" }]} />
          <VerticalTabs value={vtab} onChange={setVtab} items={[{ id: "learn", label: "网络学堂", icon: <IconLearn />, badge: 3 }, { id: "today", label: "今日", icon: <IconToday /> }, { id: "files", label: "云盘", icon: <IconFolder /> }]} />
        </Stack>
      </Group>

      <Group title="Avatar / Tile / StatTile / Progress / Ring" hint="计数与进度">
        <Inline gap={3} wrap>
          <Avatar name="张三" />
          <Avatar name="李四" size="lg" />
          <Avatar name="Alice" size="xl" tone="info" />
          <Avatar size="sm" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23c33'/%3E%3C/svg%3E" />
        </Inline>
      </Group>

      <Grid min="sm">
        <Tile icon={<IconToday />} label="今日" sub="3 节课" />
        <Tile icon={<IconLearn />} label="网络学堂" badge={<Badge count={3} standalone tone="error" />} active />
        <Tile icon={<IconFolder />} label="云盘" disabled />
        <StatTile label="待交作业" value={3} unit="门" hint="最近一门 2 天后截止" tone="warning" />
        <StatTile label="云盘占用" value="1.2" unit="GB" tone="info" />
        <StatTile label="今日课次" value={5} tone="accent" onClick={() => undefined} />
      </Grid>

      <Stack gap={3} className="og-w-560">
        <Progress value={0.42} label="云盘配额" showValue />
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
                { key: "name", title: "课程", value: (r: { name: string }) => r.name },
                { key: "credit", title: "学分", align: "right", mono: true, value: (r: { credit: string }) => r.credit },
                { key: "score", title: "成绩", align: "right", mono: true, value: (r: { score: string }) => r.score },
              ] as never}
              rows={[{ name: "高等数学", credit: "4", score: "92" }, { name: "线性代数", credit: "3", score: "88" }, { name: "大学物理", credit: "3", score: "85" }]}
              rowKey={(r: { name: string }) => r.name}
            />
          </Stack>
          <Card flush>
            <Accordion openKeys={openKeys} onToggle={(id) => setOpenKeys((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]))}>
              <AccordionItem id="a" title="折叠面板 A" sub="点开看详情">
                <Text tone="quiet">面板内容：展开用 grid-template-rows，不动画 height。</Text>
              </AccordionItem>
              <AccordionItem id="b" title="折叠面板 B" trailing={<Tag tone="info">新</Tag>}>
                <Text tone="quiet">另一块内容。</Text>
              </AccordionItem>
            </Accordion>
          </Card>
          <Stack gap={3} className="og-w-560">
            <Timeline
              items={[
                { time: "09:00", title: "高数作业截止", sub: "第 3 章习题", tone: "warning" },
                { time: "12:30", title: "提交完成", tone: "success" },
                { time: "18:00", title: "晚课开始", sub: "六教 6A205" },
              ]}
            />
            <Breadcrumb items={[{ label: "云盘", onClick: () => undefined }, { label: "课程资料", onClick: () => undefined }, { label: "高数" }]} />
            <Pagination page={page} pageCount={12} onChange={setPage} />
            <CodeBlock code={"pnpm --filter @onethu/desktop dev"} lang="bash" />
            <LoadingBlock rows={2} />
            <Inline gap={2}><Spinner /><Spinner size="sm" /><Spinner size="lg" /></Inline>
          </Stack>
        </Stack>
      </Group>

      <Group title="组合：BtnGroup / DataList / Grow / Popover / ContextMenu" hint="装配件也是组件，不是页面自己拼">
        <Stack gap={4} className="og-w-560">
          <Inline gap={0}>
            <BtnGroup>
              <Btn variant="outline" size="sm">左</Btn>
              <Btn variant="outline" size="sm">中</Btn>
              <Btn variant="outline" size="sm">右</Btn>
            </BtnGroup>
            <Grow><Text slot="label" tone="faint">Grow：占满剩余宽度</Text></Grow>
          </Inline>
          <DataList
            items={[{ id: "1", name: "高数作业", meta: "2 天后截止" }, { id: "2", name: "线代作业", meta: "已提交" }]}
            keyOf={(r: { id: string }) => r.id}
            render={(r: { name: string; meta: string }) => <Row title={r.name} sub={r.meta} caret onClick={() => undefined} />}
            divided
          />
          <Inline gap={2}>
            <Popover open={false} onClose={() => undefined} anchor={null}><Text>气泡内容</Text></Popover>
            <ContextMenu open={false} x={0} y={0} onClose={() => undefined} items={[{ id: "a", label: "右键菜单项" }]} />
            <Text slot="micro" tone="faint">Popover / ContextMenu 由触发点控制开合，这里只登记存在</Text>
          </Inline>
        </Stack>
      </Group>

      <Group title="Skeleton / Empty / 图标集">
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
        title="确认操作"
        foot={<><Btn variant="ghost" onClick={() => setModal(false)}>取消</Btn><Btn variant="solid" tone="brand" onClick={() => setModal(false)}>确定</Btn></>}
      >
        <Text>弹窗内容：桌面居中、手机底部抽屉，同一份实现。</Text>
      </Modal>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="抽屉标题">
        <Text>侧边抽屉：只动 transform，退场有相位。</Text>
      </Drawer>

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          { id: "open", label: "打开" },
          { id: "rename", label: "重命名" },
          "separator",
          { id: "del", label: "删除", danger: true },
        ]}
      />
    </Stack>
  );
}


/** 整壳预览：外框（竖栏/顶栏/内容/底部条）就是 AppShell，页面内容就是 Page —— 没有第二种写法 */
function ShellPreview(): ReactNode {
  const [active, setActive] = useState("home");
  const tabs = [
    { id: "home", label: "首页", pinned: true, icon: <IconToday /> },
    { id: "learn", label: "网络学堂", icon: <IconLearn />, badge: 3, onClose: () => undefined },
    { id: "cloud", label: "清华云盘", icon: <IconFolder />, onClose: () => undefined },
    { id: "settings", label: "设置", icon: <IconSettings />, onClose: () => undefined },
  ];
  return (
    <Stack gap={3}>
      <Section title="整壳预览 · 桌面（竖栏）" hint="AppShell: rail + topbar + content" />
      <div className="og-preview-frame">
        <AppShell
          tabs={tabs}
          activeTab={active}
          onSelectTab={setActive}
          desktopLayout="rail"
          brand={<Text slot="subtitle" as="span">OneTHU</Text>}
          railActions={<><IconBtn label="复制标签页" size="sm" variant="ghost" icon={<Icon><path d="M8 8h11v11H8z" /><path d="M5 16V5h11" /></Icon>} /><IconBtn label="设置" size="sm" variant="ghost" icon={<IconSettings />} /></>}
          actions={<><IconBtn label="刷新" size="sm" variant="ghost" icon={<IconRefresh />} /><IconBtn label="设置" size="sm" variant="ghost" icon={<IconSettings />} /></>}
        >
          <Page title="网络学堂" sub="3 门待办 · 最近同步 2 分钟前" actions={<Btn size="sm" variant="outline" icon={<IconRefresh />}>刷新</Btn>}>
            <Toolbar align="between">
              <Tabs value="hw" onChange={() => undefined} items={[{ id: "hw", label: "作业", badge: 3 }, { id: "notice", label: "通知" }, { id: "file", label: "文件" }]} />
            </Toolbar>
            <SettingsList title="待办">
              <SettingsRow icon={<IconLearn />} title="高等数学 · 第 3 章习题" sub="2 天后截止" value="待交" caret onClick={() => undefined} />
              <SettingsRow icon={<IconLearn />} title="大学物理 · 实验报告" sub="已提交" value="已交" caret onClick={() => undefined} />
            </SettingsList>
          </Page>
        </AppShell>
      </div>

      <Section title="整壳预览 · 手机（底栏 + 标签页抽屉）" hint="同一份 AppShell，platform=mobile" />
      <div className="og-preview-frame og-preview-frame--phone">
        <div className="og-phone-mock">
          <AppShell
            tabs={tabs}
            activeTab={active}
            onSelectTab={setActive}
            platform="mobile"
            onMore={() => undefined}
            brand={<Text slot="label" as="span">OneTHU</Text>}
            actions={<IconBtn label="刷新" size="sm" variant="ghost" icon={<IconRefresh />} />}
          >
            <Page title="首页" sub="今天 3 节课">
              <Card title="今日课程">
                <List divided>
                  <Row flush title="高等数学" meta="08:00" sub="六教 6A205" caret onClick={() => undefined} />
                  <Row flush title="大学物理" meta="10:00" sub="三教 3302" caret onClick={() => undefined} />
                </List>
              </Card>
            </Page>
          </AppShell>
        </div>
      </div>
      <Section title="导航件单独看" hint="NavRail / TabStrip / MobileTabBar 也可以单独用" />
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
      <Group title="Btn · 形态" hint="solid / tonal / outline / ghost / plain">
        <Btn variant="solid" tone="brand">主要操作</Btn>
        <Btn variant="tonal" tone="brand">次强调</Btn>
        <Btn variant="outline">描边</Btn>
        <Btn variant="ghost">幽灵</Btn>
        <Btn variant="plain">纯文字</Btn>
        <Btn variant="solid" tone="brand" loading>加载中</Btn>
        <Btn variant="solid" tone="brand" disabled>禁用</Btn>
      </Group>

      <Group title="Btn · 色调" hint="tone 只换色料，形态不动">
        <Btn variant="solid" tone="brand">brand</Btn>
        <Btn variant="solid" tone="error">error</Btn>
        <Btn variant="solid" tone="warning">warning</Btn>
        <Btn variant="solid" tone="success">success</Btn>
        <Btn variant="solid" tone="info">info</Btn>
        <Btn variant="tonal" tone="error">tonal error</Btn>
        <Btn variant="outline" tone="info">outline info</Btn>
      </Group>

      <Group title="Btn · 尺寸与图标" hint="sm / md / lg + 图标槽">
        <Btn size="sm" variant="outline">小</Btn>
        <Btn size="md" variant="outline">中</Btn>
        <Btn size="lg" variant="outline">大</Btn>
        <Btn variant="solid" tone="brand" icon={<Icon><path d="M12 5v14M5 12h14" /></Icon>}>新建</Btn>
        <IconBtn label="设置" variant="outline" icon={<Icon><circle cx="12" cy="12" r="3" /></Icon>} />
        <IconBtn label="刷新" round variant="tonal" tone="brand" icon={<Icon><path d="M20 12a8 8 0 1 1-2.34-5.66" /></Icon>} />
      </Group>

      <Group title="Text · 六档字阶" hint="display / title / subtitle / body / label / micro">
        <Stack gap={1}>
          <Text slot="display">显示 36</Text>
          <Text slot="title">标题 24</Text>
          <Text slot="subtitle">小标题 16</Text>
          <Text slot="body">正文 14 —— 每档一个语义位。</Text>
          <Text slot="label">标签 13</Text>
          <Text slot="micro">微标 11</Text>
          <Inline gap={3} wrap>
            <Text tone="quiet">次文 content-2</Text>
            <Text tone="faint">弱文 content-3</Text>
            <Text tone="brand">强调色文字</Text>
            <Text tone="error">错误文字</Text>
            <Text tone="success">成功文字</Text>
            <Text mono>mono 1234.56</Text>
          </Inline>
        </Stack>
      </Group>

      <Group title="Chip / Tag / Badge">
        <Chip>默认胶囊</Chip>
        <Chip tone="brand">品牌</Chip>
        <Chip tone="error">错误</Chip>
        <Chip tone="success" selected>选中</Chip>
        <Chip onClick={() => undefined}>可点</Chip>
        <Chip onRemove={() => undefined}>可删</Chip>
        <Tag>标签</Tag>
        <Tag tone="info">info</Tag>
        <Badge count={3} standalone />
        <Badge dot standalone />
        <Badge count={12}>
          <IconBtn label="通知" variant="outline" icon={<Icon><path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z" /></Icon>} />
        </Badge>
      </Group>

      <Stack gap={3}>
        <Section title="Surface / Card · 面阶" hint="level 0–3 / elevation / sunken 井" />
        <Grid min="sm">
          <Surface level={0} pad="md"><Text slot="label">level 0</Text></Surface>
          <Surface level={1} pad="md"><Text slot="label">level 1</Text></Surface>
          <Surface level={2} pad="md"><Text slot="label">level 2</Text></Surface>
          <Surface level={3} pad="md"><Text slot="label">level 3</Text></Surface>
          <Surface level={0} elevation={1} pad="md"><Text slot="label">elev 1</Text></Surface>
          <Surface level={0} elevation={2} pad="md"><Text slot="label">elev 2</Text></Surface>
          <Surface sunken pad="md"><Text slot="label">sunken 井</Text></Surface>
          <Surface level={0} pad="md" interactive selected><Text slot="label">selected</Text></Surface>
        </Grid>
      </Stack>

      <Grid min="md">
        <Card
          title="卡片标题"
          headAside={<Btn size="sm" variant="ghost">更多</Btn>}
          foot={<><Btn size="sm" variant="ghost">取消</Btn><Btn size="sm" variant="solid" tone="brand">确定</Btn></>}
        >
          <Text tone="quiet">卡片正文：面 + 圆角，描边只是 hairline，阴影克制。</Text>
        </Card>

        <Card flush>
          <List divided>
            <Row flush caret onClick={() => undefined} title="云盘文件" sub="2.4 MB · 今天" trailing="查看"
              leading={<Icon><circle cx="12" cy="12" r="9" /></Icon>} />
            <Row flush caret onClick={() => undefined} title="作业提交" sub="第 3 章习题" trailing={<Tag tone="warning">待交</Tag>}
              leading={<Icon><path d="M4 7h16v10H4z" /></Icon>} />
            <Row flush title="不可点的行" meta="meta" trailing="—" leading={<Icon><path d="M12 5v14M5 12h14" /></Icon>} />
          </List>
        </Card>

        <Card title="键值对">
          <KeyValue rows={[{ k: "学号", v: "2021••••" }, { k: "余额", v: "¥ 42.00" }, { k: "连接", v: "已连接" }]} />
        </Card>

        <Card title="空状态">
          <EmptyState
            icon={<Icon size="xl"><path d="M4 6h16v12H4z" /></Icon>}
            title="这里还什么都没有"
            hint="可以先从网络学堂同步一次。"
            action={<Btn variant="solid" tone="brand">去同步</Btn>}
          />
        </Card>

        <Card title="栅格与列表卡">
          <Grid min="sm">
            {["高数", "线代", "大物", "思修"].map((name) => (
              <Surface key={name} level={1} pad="md" interactive>
                <Stack gap={1}>
                  <Text slot="subtitle">{name}</Text>
                  <Text slot="label" tone="faint">课程</Text>
                </Stack>
              </Surface>
            ))}
          </Grid>
        </Card>

        <Card title="分隔线">
          <Stack gap={2}>
            <Text>上面</Text>
            <Divider />
            <Text>下面</Text>
            <Divider inset />
            <Text>缩进分隔线</Text>
            <Inline gap={2}>
              <Text>左</Text>
              <Divider vertical />
              <Text>右</Text>
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
        <Text slot="display">OneGUI 画廊</Text>
        <Text tone="quiet">
          六轴：皮肤 / 明暗 / 密度 / 动效 / 强调色 / 平台。下面是同一批组件在不同轴取值下的表现 ——
          组件本身零改动，改的全是管线里的令牌。
        </Text>
      </Stack>

      <Surface level={1} pad="md" sticky>
        <Stack gap={2}>
          <Inline gap={3} wrap>
            <AxisPicker label="皮肤" values={["neutral", "glass"] as const} value={axes.skin === "glass" ? "glass" : "neutral"} onPick={(v) => director.set({ skin: v })} />
            {axes.skin === "glass" ? (
              <AxisPicker label="浓淡" values={SKIN_LEVELS} value={axes.skinLevel as typeof SKIN_LEVELS[number]} onPick={(v) => director.set({ skinLevel: v })} />
            ) : null}
            <AxisPicker label="明暗" values={["auto", "light", "dark"] as const} value={axes.scheme} onPick={(v) => director.set({ scheme: v })} />
            <AxisPicker label="密度" values={["compact", "comfortable", "touch"] as const} value={axes.density} onPick={(v) => director.set({ density: v })} />
            <AxisPicker label="动效" values={["full", "reduced"] as const} value={axes.motion} onPick={(v) => director.set({ motion: v })} />
          </Inline>
          <Inline gap={1} wrap>
            <Text slot="label" tone="quiet">强调色</Text>
            {THEMES.map((t, i) => (
              <Chip key={t.id} size="sm" selected={themeIdx === i} onClick={() => { setThemeIdx(i); director.set({ theme: t }, { persist: false }); }}>
                {t.name}
              </Chip>
            ))}
            <Chip size="sm" selected={themeIdx === -1} onClick={() => { setThemeIdx(-1); director.set({ theme: null }, { persist: false }); }}>默认</Chip>
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
