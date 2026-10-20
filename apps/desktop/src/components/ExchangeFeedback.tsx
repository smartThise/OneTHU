import {Btn,Modal} from '@onethu/gui';
import {IconCheck} from './Icons.js';
import { t as i18n } from "../i18n/index.js";

export type ExchangeState={phase:'reading'|'ready'|'success'|'error';message:string};
export function ExchangeFeedback({state,onClose}:{state:ExchangeState|null;onClose:()=>void}){return <Modal open={!!state} onClose={onClose} title={state?.phase==='success'?'已收到':state?.phase==='error'?'未完成交换':'碰一碰 · 交换内容'} size="sm"><div className={'exchange-feedback is-'+state?.phase} role="status" aria-live="polite"><div className="exchange-stage"><i/><i/><i/>{state?.phase==='success'?<IconCheck width={130} height={130}/>:state?.phase==='error'?<span className="exchange-error">!</span>:<div className="exchange-card"><span>OneTHU</span><b>{i18n("auto.components.ExchangeFeedback.1")}</b></div>}</div><p>{state?.message}</p><Btn variant="solid" onClick={onClose}>{state?.phase==='reading'||state?.phase==='ready'?'收起进度':'完成'}</Btn></div></Modal>;}
