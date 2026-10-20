
import { t as i18n } from "../i18n/index.js";
/** Small illustrative scenes explain the action without creating or changing user content. */
export function TourIllustration({lesson}:{lesson:string}) {
 return <div className={"tour-scene tour-scene--"+lesson} aria-label={i18n("auto.components.TourIllustration.1")}>
 <span className="tour-scene-caption">{i18n("auto.components.TourIllustration.1")}</span>
 {lesson==="board"?<div className="tour-board-demo"><div><small>{i18n("auto.components.TourIllustration.2")}</small><strong>{i18n("auto.components.TourIllustration.3")}</strong><span>{i18n("auto.components.TourIllustration.4")}</span></div><div><strong>{i18n("auto.components.TourIllustration.5")}</strong><span>{i18n("auto.components.TourIllustration.6")}</span><i aria-hidden="true">↘</i></div></div>
 :lesson==="vault"?<div className="tour-flow"><span className="tour-demo-card">{i18n("auto.components.TourIllustration.7")}</span><span className="tour-flow-arrow">→</span><span className="tour-demo-box">{i18n("auto.components.TourIllustration.8")}<small>{i18n("auto.components.TourIllustration.9")}</small></span></div>
 :lesson==="code"?<div className="tour-flow"><span className="tour-demo-card">{i18n("auto.components.TourIllustration.10")}</span><span className="tour-flow-arrow">→</span><span className="tour-demo-code">ON-XXXX-XXXX-XXXX-XXXX<small>{i18n("auto.components.TourIllustration.11")}</small></span><span className="tour-flow-arrow">→</span><span className="tour-demo-card">{i18n("auto.components.TourIllustration.12")}</span></div>
 :lesson==="nfc"?<div className="tour-flow"><span className="tour-demo-phone">{i18n("auto.components.TourIllustration.13")}<small>{i18n("auto.components.TourIllustration.10")}</small></span><span className="tour-nfc-pulse" aria-hidden="true">)))</span><span className="tour-demo-phone">{i18n("auto.components.TourIllustration.14")}<small>{i18n("auto.components.TourIllustration.15")}</small></span></div>
 :lesson==="organization"?<div className="tour-org-demo"><strong>{i18n("auto.components.TourIllustration.16")}</strong><div>{["成员","文件","项目","公告"].map(x=><span key={x}>{x}</span>)}</div></div>
 :lesson==="more"?<div className="tour-services-demo">{["课程","作业","校园卡","研讨间","校历","更多…"].map(x=><span key={x}>{x}</span>)}</div>
 :lesson==="swap"?<div className="tour-org-demo"><strong>{i18n("auto.components.TourIllustration.17")}</strong><div>{["01","02","03","04"].map(x=><span key={x}>{x}</span>)}</div></div>
 :lesson==="quick"?<div className="tour-services-demo">{["学习","预约","生活","信息","课表"].map(x=><span key={x}>{x}</span>)}</div>
 :<div className="tour-board-demo"><div><strong>{i18n("auto.components.TourIllustration.3")}</strong><span>{i18n("auto.components.TourIllustration.18")}</span></div><div><strong>{i18n("auto.components.TourIllustration.19")}</strong><span>{i18n("auto.components.TourIllustration.20")}</span></div></div>}
 </div>;
}
