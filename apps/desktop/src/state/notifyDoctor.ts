/**
 * 通知与小组件自检（编排可测，副作用全部注入）。
 *
 * 存在的理由很实际：这套链路横跨 JS 调度、原生桥、系统权限、系统设置四层，
 * 出问题时用户只能描述「没收到」，而排查需要知道「卡在哪一层」。这个自检把每一层
 * 单独探一遍并给出结论，用户点一下就能把结果贴回来——把「真机验证」从一轮对话
 * 压缩成一次截图。
 *
 * 顺序刻意如此：先探不需要用户操作的前提（后端、授权），再做会真正弹出通知的投递
 * 测试；未授权时立即停止并只讲「先授权」，不拿一串注定失败的结果淹没用户。
 */
import type { NativeNotifyStatus } from "./notifyBridge.js";
import type { NativeWidgetStatus } from "./widgetBridge.js";

export interface DoctorStep {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  steps: DoctorStep[];
  /** 一句话结论（含通过/警告/失败计数） */
  summary: string;
}

export interface NotifyDoctorDeps {
  status: (request: boolean) => Promise<NativeNotifyStatus>;
  scheduleProbe: (probe: { id: string; at: number; title: string; body: string }) => Promise<{ ok: boolean; reason?: string }>;
  pending: () => Promise<string[]>;
  cancel: (ids: string[]) => Promise<void>;
  testSend: () => Promise<boolean>;
  /** 桌面端没有小组件：注入方返回 null 时跳过该步 */
  widgetStatus?: () => Promise<NativeWidgetStatus | null>;
  now?: () => number;
}

/** 探针 id：既不是插件 id 空间（plugin:），也不与宿主计划 id 撞（<kind>:<key>:<offset>） */
export const DOCTOR_PROBE_ID = "doctor:probe";
/** 探针时刻：给足余量，确保写进去时不会因为「已过时刻」被原生拒绝 */
const PROBE_LEAD_MS = 120_000;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function runNotifyDoctor(deps: NotifyDoctorDeps): Promise<DoctorReport> {
  const now = (deps.now ?? Date.now)();
  const steps: DoctorStep[] = [];
  const push = (id: string, label: string, status: DoctorStep["status"], detail: string): void => {
    steps.push({ id, label, status, detail });
  };
  const finish = (): DoctorReport => {
    const failed = steps.filter((s) => s.status === "fail").length;
    const warned = steps.filter((s) => s.status === "warn").length;
    const ok = failed === 0;
    const summary = ok
      ? `自检通过：${steps.length} 项${warned ? `（${warned} 项提示）` : ""}`
      : `自检失败：${failed} 项不通过${warned ? `、${warned} 项提示` : ""}——见下方第一处「不通过」`;
    return { ok, steps, summary };
  };

  /* ① 平台后端 */
  const st = await deps.status(false);
  if (!st.backend || st.backend === "none") {
    push("backend", "平台后端", "fail", "本平台没有通知后端，提醒不会发出（桌面端 Linux 等未接入平台属正常）");
    return finish();
  }
  push("backend", "平台后端", "ok", st.backend);

  /* ② 授权 */
  if (!st.granted) {
    push("permission", "通知授权", "fail", "未授权：提醒发不出去。请在系统设置里为本应用打开通知权限，然后重新自检");
    return finish();
  }
  push("permission", "通知授权", "ok", "已授权");

  /* ③ 精确提醒（仅 Android 有此概念） */
  if (st.backend === "android") {
    push(
      "exact",
      "精确提醒",
      st.exact ? "ok" : "warn",
      st.exact ? "已允许精确提醒" : "未允许：系统可能延迟几分钟投递（不会丢）。可在系统设置「闹钟与提醒」里允许",
    );
  }

  /* ④ 小组件快照与落地（仅 Android；桌面端注入方返回 null 即跳过） */
  if (deps.widgetStatus) {
    const ws = await deps.widgetStatus().catch(() => null);
    if (ws) {
      const placed = ws.hostPlaced + Object.values(ws.slotsPlaced).reduce((a, b) => a + b, 0);
      const slotInfo = Object.entries(ws.slotsPlaced)
        .map(([k, v]) => `槽位${k}:${v}`)
        .join(" ");
      const titles = Object.entries(ws.slotTitles).map(([k, t]) => `可自选尺寸${k}=${t}`).join("；");
      const providerInfo =
        ws.providersRegistered.length === 0
          ? "系统没有读到任何小组件尺寸（清单合并可能没生效，请把这条反馈给开发者）"
          : `系统读到 ${ws.providersRegistered.length} 个小组件尺寸（${ws.providersRegistered.join("、")}）`;
      const widgetStatus: DoctorStep["status"] = ws.providersRegistered.length === 0 ? "fail" : ws.hasSnapshot ? "ok" : "warn";
      push(
        "widget",
        "小组件",
        widgetStatus,
        [
          providerInfo,
          ws.hasSnapshot ? `快照已于 ${fmtTime(ws.snapshotAt)} 生成` : "还没有快照（打开应用并刷新一次数据即可生成）",
          placed > 0 ? `桌面已放 ${placed} 个（宿主 ${ws.hostPlaced}）${slotInfo}` : "桌面尚未放置任何小组件",
          titles || "（当前无插件占用槽位）",
        ].join("；"),
      );
    }
  }

  /* ⑤ 排程写入 + 回读（证明原生真的收下了） */
  let probeScheduled = false;
  try {
    const r = await deps.scheduleProbe({
      id: DOCTOR_PROBE_ID,
      at: now + PROBE_LEAD_MS,
      title: "OneTHU 自检探针",
      body: "这条是自检写入的探针，稍后会被撤销。",
    });
    probeScheduled = r.ok;
    if (!r.ok) {
      push("schedule", "排程写入", "fail", `原生拒绝了排程：${r.reason ?? "未知原因"}`);
    } else {
      const ids = await deps.pending().catch(() => [] as string[]);
      const seen = ids.includes(DOCTOR_PROBE_ID);
      push(
        "schedule",
        "排程写入",
        seen ? "ok" : "warn",
        seen ? "已写入系统调度并可回读" : "写入成功，但系统待投递列表里读不到（可能被系统限流或立即触发）",
      );
    }
  } catch (e) {
    push("schedule", "排程写入", "fail", `排程调用异常：${String(e).slice(0, 100)}`);
  } finally {
    // 无论成败都撤掉探针，不给用户留垃圾通知
    await deps.cancel([DOCTOR_PROBE_ID]).catch(() => undefined);
    push("cleanup", "探针清理", "ok", probeScheduled ? "已撤销探针" : "无探针需要撤销");
  }

  /* ⑥ 真实投递（会弹一条通知，放最后） */
  const sent = await deps.testSend().catch(() => false);
  push("deliver", "投递测试", sent ? "ok" : "fail", sent ? "已发出测试通知——若没看到，检查系统「勿扰」或通知分组" : "投递被拒绝（见上一步与权限状态）");

  return finish();
}
