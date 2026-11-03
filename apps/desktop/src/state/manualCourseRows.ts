/**
 * 「今日课程」的手动补充课程：读事件仓、订阅内容变更。
 *
 * 为什么是订阅而不是一次性读：用户刚在日程页补了一门课，首页应该立刻出现——
 * 事件仓的增删改都会经 onCloudCalChange 广播一次（writeLocal / 云同步落盘后），
 * 这里跟着重算当天的课行即可，不用等下次冷启动。
 *
 * 预览树（引导、演示）一律给空：它只能读预览自带的假数据，不能把真实用户的
 * 补课带进演示画面（与 dataScope 的其它消费者同一条规矩）。
 */
import { useEffect, useMemo, useState } from "react";
import type { ScheduleEntry } from "@onethu/core";
import { ensureCloudCalLoaded, getCloudEvents, getLocalEvents, onCloudCalChange } from "./cloudCal.js";
import { useDataScope } from "./dataScope.js";
import { manualCourseRows } from "../lib/manualCourses.js";

export function useManualCourseRows(day: string): ScheduleEntry[] {
  const { preview } = useDataScope();
  /** 事件仓内容版本：变更一次加一，作为 useMemo 的失效信号 */
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (preview) return undefined;
    let alive = true;
    const bump = (): void => { if (alive) setVersion((v) => v + 1); };
    // 盘上那份还没装载时先装载：装载完会广播一次，首屏就能带上已有的课
    void ensureCloudCalLoaded().then(bump).catch(() => undefined);
    const off = onCloudCalChange(bump);
    return () => {
      alive = false;
      off();
    };
  }, [preview]);
  return useMemo(
    () => (preview ? [] : manualCourseRows([...getCloudEvents(), ...getLocalEvents()], day)),
    [preview, day, version],
  );
}
