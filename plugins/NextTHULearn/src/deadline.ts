import { parseLearnTime } from '../../../packages/core/src/learn/time.js';
export function deadlineInfo(value:string,submitted=false,now=Date.now()):{tone:'urgent'|'soon'|'upcoming'|'neutral';label:string} {
  if(submitted)return {tone:'neutral',label:''};
  const date=parseLearnTime(value);if(!date)return {tone:'neutral',label:''};
  const hours=(date.getTime()-now)/3600000;
  if(hours<0)return {tone:'urgent',label:`已逾期 ${Math.max(1,Math.ceil(-hours/24))} 天`};
  if(hours<=24)return {tone:'soon',label:hours<1?'不足 1 小时截止':`还剩 ${Math.ceil(hours)} 小时`};
  if(hours<=72)return {tone:'upcoming',label:`还剩 ${Math.ceil(hours/24)} 天`};
  return {tone:'neutral',label:`还剩 ${Math.ceil(hours/24)} 天`};
}
