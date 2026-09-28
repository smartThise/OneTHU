/**
 * 使用帮助（§4.6）：按「我想做什么」组织，不做功能罗列。
 *
 * 条目只引用功能注册表（state/navigation.ts）的 id，跳转目标由注册表给出——
 * 帮助页不硬编码路由，功能改名、换页面时这里自动跟着走，不会变成又一份过期清单。
 * 注册表里没有的（比如"改通知"）走设置页签请求，同样不写死栏目序号。
 */
import type { ReactNode } from "react";
import { NAV_REGISTRY, type NavEntry } from "../state/navigation.js";
import { useApp } from "../state/context.js";
import { requestSettingsTab } from "../state/settingsMode.js";

const byId = new Map(NAV_REGISTRY.map((e) => [e.id, e]));

/** 一件事一行：标题是用户嘴里的话，按钮是注册表里的功能名 */
const TASKS: Array<{ title: string; desc: string; ids: string[]; settingsTab?: string }> = [
  {
    title: "我要查成绩、看考试安排",
    desc: "成绩、考试、课程信息都在「信息」里。",
    ids: ["info-report", "info-exams"],
  },
  {
    title: "我要交作业",
    desc: "网络学堂、雨课堂、OJ 的作业都汇总在作业区；雨课堂要先扫码绑一次。",
    ids: ["learn-assignments", "yuketang-homework", "oj-homework"],
  },
  {
    title: "我要交宿舍电费、看校园卡",
    desc: "生活服务都在「生活」分组里。",
    ids: ["life-electricity", "life-card"],
  },
  {
    title: "我要预约图书馆座位、研讨间、体育",
    desc: "预约类的几项都归在「预约」分组。",
    ids: ["reserve-lib", "reserve-room", "reserve-sports"],
  },
  {
    title: "我要连校园网、查网费",
    desc: "校园网在「生活」里，进去按提示登录一次。",
    ids: ["life-network"],
  },
  {
    title: "我要把课表、日程同步到手机",
    desc: "绑定一次清华邮箱，日程就能多设备同步；iPhone 上也能看。",
    ids: ["schedule", "mail"],
  },
  {
    title: "我要改通知、桌面小组件、外观",
    desc: "这些都在设置里，下面直接带你到对应的栏目。",
    ids: [],
    settingsTab: "通知与提醒",
  },
];

export function HelpSection(): ReactNode {
  const { navigate } = useApp();
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {TASKS.map((task) => {
        const entries = task.ids
          .map((id) => byId.get(id))
          .filter((e): e is NavEntry => e !== undefined);
        return (
          <div key={task.title} className="setting-row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="setting-title">{task.title}</div>
              <div className="setting-desc">{task.desc}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {entries.map((e) => (
                <button key={e.id} className="btn" onClick={() => navigate(e.page, e.params)}>
                  {e.name}
                </button>
              ))}
              {task.settingsTab ? (
                <button
                  className="btn"
                  onClick={() => requestSettingsTab(task.settingsTab as string)}
                >
                  {task.settingsTab}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
