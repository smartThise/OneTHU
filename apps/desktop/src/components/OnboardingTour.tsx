import { TourIllustration } from "./TourIllustration.js";
import { ExperienceModePicker } from "./ExperienceModePicker.js";
import { useEffect, useState } from "react";
import { Btn, Modal, Stack, Text, Inline, Spacer, Progress, SettingsList, SettingsRow, Switch } from "@onethu/gui";
import { experienceMode, setExperienceMode, type ExperienceMode } from "../state/experienceMode.js";
import { openTab } from "../state/explorer.js";
import { OptionalConnections } from "./SimpleSettings.js";
import { TOUR_CARD_SCOPE, defineOnboardingScopes } from "./OnboardingTourScope.js";
import { t as i18n } from "../i18n/index.js";
import { mcpServerEnabled, setMcpServer } from "../state/userext.js";

const KEY="onethu.onboarded.flow4";
const REPLAY="onethu.onboarding.replay";
export function replayOnboarding(){window.dispatchEvent(new Event(REPLAY));}
type Lesson={id:string;title:string;lead:string;steps:string[];page?:"homepage"|"vault"|"contacts";action?:string};
export const FULL_LESSONS:Lesson[]=[
 {id:"board",title:"白板与 OnePage：首页由你摆",lead:"首页是一块自由画布，位置和大小随手调。",steps:["编辑态从组件抽屉挑卡片，拖动换位置。","拉四角或边把手改大小，双击就地编辑。","底部模板一键套用；OnePage 可另建多块。"],page:"homepage",action:"去看看白板"},
 {id:"explorer",title:"标签页与工作区：多任务不打架",lead:"每个页面都是一枚标签，工作区存一组状态。",steps:["点顶栏＋或搜索开新标签，拖动可换序。","在 OneGO! 保存工作区，下次一键恢复。","标签栏可横排或竖排，关前先存工作区。"],page:"homepage",action:"打开工作区入口"},
 {id:"vault",title:"暂存箱：什么都能先收进来",lead:"按住内容拖进暂存箱，文件会自动存到云盘。",steps:["长按文件/日程/项目/标签页，拖到箱子上。","点箱子开雷达：整理、分享或交给小 OH。","日程拖入只是快照，点开再选是否加入日程。"],page:"vault",action:"打开暂存箱"},
 {id:"code",title:"一个短口令，传递一组内容",lead:"整组内容生成短口令，对方无需云盘账号。",steps:["暂存箱点分享口令并复制，可设有效期。","对方点接收粘贴口令或扫二维码。","分享前先确认内容；口令只是钥匙。"],page:"vault",action:"查看收发入口"},
 {id:"nfc",title:"碰一碰：名片与内容接力",lead:"有 NFC 可贴近传送口令，没有也能用口令。",steps:["两台设备分别选 NFC 传送与接收。","看到成功反馈再分开。","失败请手动改用口令或二维码。"],page:"vault",action:"查看设备支持"},
 {id:"organization",title:"组织：人、文件、项目一处管",lead:"建组织后成员共享云盘与 GitLab 项目。",steps:["邀请成员时可用口令，并设有效期。","组织里共享资料库、建项目、发公告。","组织名片与个人名片分开管理。"],page:"contacts",action:"打开组织"},
 {id:"onego",title:"OneGO!：全局入口与自动化",lead:"搜索、快捷指令、工作区和 OneFlow 都在这里。",steps:["⌘/Ctrl+K 唤出搜索，直跳页面或内容。","OneFlow 把一串操作固化成步骤。","可按需触发：手动、定时或事件。"],page:"homepage",action:"打开 OneGO!"},
 {id:"plugin",title:"插件与 OH：把能力装进来",lead:"装插件扩展组件、主题与 MCP 工具。",steps:["插件页安装管理，给 OH 配模型源。","悬浮球默认关闭，可在 OH 设置里开启。","可给本机应用开放 OH MCP（默认关闭）。","自制内容可发布为 OnePage 或组件。","OH 支持语音、多模态与 IM 接入。"],page:"homepage",action:"看看插件页"},
 {id:"customize",title:"外观与工作台：全都可调",lead:"主题、壁纸、密度和入口排布都能改。",steps:["设置→外观与布局：主题、壁纸、字号。","小组件、Dock、标签栏、OneShot 可调。","改坏可恢复默认布局，不动数据。"],page:"homepage",action:"打开外观设置"},
 {id:"campus",title:"校园服务：完整模式的聚合",lead:"学习、生活、预约、云盘、GitLab 全聚合。",steps:["学习：作业/通知/文件/成绩/讨论。","生活：校园卡、电费网费、洗衣、场馆。","云盘、邮箱、GitLab、寻迹都在这一层。"],page:"homepage",action:"去学习页"},
 {id:"data",title:"数据与同步：跨设备继续",lead:"日程、暂存箱和组织资料都能跨设备带走。",steps:["日程支持云日历与系统日历同步。","口令与 NFC 让内容跨设备接力。","切换模式不清数据，设置里可导出。"],page:"vault",action:"查看数据设置"},
];
const SIMPLE_LESSONS:Lesson[]=[
 {id:"today",title:"首页，只关心今天",lead:"打开就看到今日待办与要上的课程，没有需要整理的标签和白板。",steps:["点一条待办查看详情，点课程直接进入课程内容。","随时点左上角「首页」回来，退出再进仍是今天。","想加更多功能时，到设置切「实用模式」或「完整模式」。"]},
 {id:"quick",title:"五个功能，固定在手边",lead:"极简模式仅保留学习、预约、生活、课表、信息五个功能，全部固定在底部。",steps:["学习里看课程与作业；预约里找场馆、研讨间与来访报备。","生活与信息汇集校园服务；课表里看时间安排。","OH 搜索胶囊始终可用；可在设置里填自己的 API。"],page:"homepage",action:"看看底部五入口"},
];
const PRACTICAL_LESSONS:Lesson[]=[
 {id:"today",title:"首页，只关心今天",lead:"打开就看到今日待办与要上的课程；实用模式包含所有基础功能，但不摆白板。",steps:["点一条待办查看详情，点课程进入课程内容。","随时点左上角「首页」回来，退出再进仍是今天。"]},
 {id:"more",title:"更多功能：所有基础功能都在这里",lead:"实用模式包含所有基础功能；第五格「更多功能」按目录展开全部，点名称直接打开。",steps:["按学习、日程、生活、预约等目录分组，先找目录再点功能。","暂存箱、通讯录、白板、插件等完整模式专属能力不在此列，切到完整模式即可用。"],page:"homepage",action:"展开更多功能"},
 {id:"swap",title:"四个入口，随你安排",lead:"学习、预约、生活、课表默认在下排；想把哪个功能放在手边，就换进去。",steps:["在「更多功能」里点功能右侧的 + 号。","选择要替换的入口（入口 1 到 4），该功能就固定在底部。","换过的入口一直保持；切到其他模式也不受影响。"]},
];
function shouldStart(){
 try{
  /* dev/验收：?tour=1 强制打开导览（正式版不受影响，仍看完成标记） */
  if(typeof location!=="undefined"&&new URLSearchParams(location.search).get("tour")==="1")return true;
  return !localStorage.getItem(KEY)&&!localStorage.getItem("onethu.onboarded.flow3")&&!localStorage.getItem("onethu.onboarded.phone");
 }catch{return false;}
}
export function OnboardingTour(){
 const [open,setOpen]=useState(shouldStart),[chosen,setChosen]=useState<ExperienceMode>(experienceMode),[step,setStep]=useState(-1),[practice,setPractice]=useState(false),[connect,setConnect]=useState(false),[mcpOn,setMcpOn]=useState(()=>mcpServerEnabled());
 const lessons=chosen==="simple"?SIMPLE_LESSONS:chosen==="practical"?PRACTICAL_LESSONS:FULL_LESSONS;
 const last=step===lessons.length, lesson=lessons[step] ?? lessons[0]!;
 useEffect(()=>{const replay=()=>{setChosen(experienceMode());setStep(-1);setPractice(false);setConnect(false);setOpen(true);};window.addEventListener(REPLAY,replay);return()=>window.removeEventListener(REPLAY,replay);},[]);
 const finish=()=>{try{localStorage.setItem(KEY,"1");}catch{}setOpen(false);setPractice(false);};
 if(!open)return null;
 defineOnboardingScopes();
 if(practice)return <aside className="tour-resume" role="status"><Text>{i18n("auto.components.OnboardingTour.1")}{lesson?.title}</Text><Btn variant="solid" onClick={()=>setPractice(false)}>{i18n("auto.components.OnboardingTour.2")}</Btn><Btn variant="ghost" onClick={finish}>{i18n("auto.components.OnboardingTour.3")}</Btn></aside>;
 return <Modal open onClose={finish} closeButton={false} size={step<0?"lg":"md"} className="experience-tour" scope={TOUR_CARD_SCOPE} aria-label={i18n("auto.components.OnboardingTour.4")} foot={<Inline gap={2} wrap>
 <Btn variant="outline" disabled={step<0} onClick={()=>{setStep(s=>s-1);setConnect(false);}}>{i18n("auto.components.OnboardingTour.5")}</Btn><Spacer/>
 <Btn variant="ghost" onClick={finish}>{i18n("auto.components.OnboardingTour.6")}</Btn>
 <Btn variant="solid" onClick={()=>{if(step===-1)setExperienceMode(chosen);if(last)finish();else setStep(s=>s+1);}}>{step===-1?"按此模式开始":last?"开始使用":"下一步"}</Btn>
 </Inline>}>
 <Stack gap={4}>
 <Text slot="micro" tone="faint">{step<0?"欢迎来到 OneTHU":`${chosen==="simple"?"极简":chosen==="practical"?"实用":"完整"}模式 · ${step+1} / ${lessons.length+1}`}</Text>
 <Progress size="sm" value={step<0?0:(step+1)/(lessons.length+1)}/>
 {step<0?<><Text as="h2" slot="title">{i18n("auto.components.OnboardingTour.7")}</Text>
 <Text>{i18n("auto.components.OnboardingTour.8")}</Text>
 <ExperienceModePicker value={chosen} onChange={setChosen}/>
 <Text tone="faint">{i18n("auto.components.OnboardingTour.9")}</Text></>:last?<>
 <Text as="h2" slot="title">{i18n("auto.components.OnboardingTour.10")}</Text><Text>{i18n("auto.components.OnboardingTour.11")}</Text>
 <SettingsList>
  <SettingsRow
   title={i18n("tour.mcp.title")}
   sub={mcpOn ? i18n("tour.mcp.subOn") : i18n("tour.mcp.subOff")}
   control={<Switch checked={mcpOn} aria-label={i18n("tour.mcp.aria")} onChange={(v)=>{setMcpServer(v);setMcpOn(v);}}/>}
  />
 </SettingsList>
 <Btn variant="outline" onClick={()=>setConnect(!connect)}>{connect?"收起连接选项":"选择扫码连接"}</Btn>{connect?<OptionalConnections/>:null}
 </>:<><Text as="h2" slot="title">{lesson.title}</Text><Text>{lesson.lead}</Text><TourIllustration lesson={lesson.id}/><ol className="tour-steps">{lesson.steps.map(s=><li key={s}>{s}</li>)}</ol>
 {lesson.page?<Btn variant="outline" onClick={()=>{openTab(lesson.page!, lesson.page==="contacts"?{section:"orgs"} as never:null);setPractice(true);}}>{lesson.action}</Btn>:null}</>}
 </Stack></Modal>;
}
