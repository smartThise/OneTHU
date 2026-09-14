/**
 * info-lib 数据层探针页（2026-09-14 硬换数据层的验收台）。
 *
 * 用户令「照抄 info app」。本页用 thu-info-lib（MIT，THU Info 同款核心，
 * 经我们的 Rust 连接池传输）跑完整链：登录 → 课程表 → 个人信息 → 图书馆楼层。
 * 四项全绿 = 新数据层在真机蜂窝网可用，随后逐模块迁移。
 */
import { useState } from "react";
import { Card } from "../components/Layout.js";
import { helper, infoLibLogin, initInfoLib } from "../lib/infoLib.js";
import { session } from "../lib/clients.js";

type Row = { name: string; state: "idle" | "run" | "ok" | "err"; ms: number; note: string };

const initial: Row[] = [
  { name: "① 登录（id 链）", state: "idle", ms: 0, note: "" },
  { name: "② 课程表 getSchedule", state: "idle", ms: 0, note: "" },
  { name: "③ 个人信息 getUserInfo", state: "idle", ms: 0, note: "" },
  { name: "④ 图书馆 getLibraryList", state: "idle", ms: 0, note: "" },
];

export function InfoLibProbePage() {
  const [rows, setRows] = useState<Row[]>(initial);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) => setLog((v) => [`${new Date().toLocaleTimeString()} ${line}`, ...v].slice(0, 40));
  const set = (i: number, patch: Partial<Row>) =>
    setRows((v) => v.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const timed = async (i: number, fn: () => Promise<string>) => {
    set(i, { state: "run" });
    const t0 = Date.now();
    try {
      const note = await fn();
      set(i, { state: "ok", ms: Date.now() - t0, note });
      append(`✅ ${rows[i]!.name} ${Date.now() - t0}ms ${note}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set(i, { state: "err", ms: Date.now() - t0, note: msg });
      append(`❌ ${rows[i]!.name} ${Date.now() - t0}ms ${msg}`);
      throw err;
    }
  };

  const runAll = async () => {
    setBusy(true);
    setLog([]);
    try {
      const cred = session.getIdCredentials();
      if (!cred) {
        append("⚠️ 主会话没有存凭据，无法自动登录（先正常登录 app）");
        return;
      }
      await timed(0, async () => {
        initInfoLib();
        await infoLibLogin(cred.username, cred.password);
        return `ok 学号=${helper.userId}`;
      });
      await timed(1, async () => {
        const { schedule } = await helper.getSchedule();
        return `ok ${schedule.length} 门课`;
      });
      await timed(2, async () => {
        const info = await helper.getUserInfo();
        return `ok ${info.fullName}`;
      });
      await timed(3, async () => {
        const libs = await helper.getLibraryList();
        return `ok ${libs.length} 个馆`;
      });
    } catch {
      /* 行内已记录 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">info-lib 数据层验收</div>
            <div className="text-xs opacity-60">
              THU Info 同款核心（MIT）· 走 Rust 连接池传输 · 四项全绿即可逐模块迁移
            </div>
          </div>
          <button
            className="rounded bg-[#6b21a8] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={busy}
            onClick={() => void runAll()}
          >
            {busy ? "跑测中…" : "一键验收"}
          </button>
        </div>
        <div className="mt-3 space-y-1">
          {rows.map((r) => (
            <div key={r.name} className="flex items-baseline gap-2 text-sm">
              <span>
                {r.state === "ok" ? "✅" : r.state === "err" ? "❌" : r.state === "run" ? "⏳" : "▫️"}
              </span>
              <span className="min-w-32">{r.name}</span>
              <span className="text-xs opacity-70">
                {r.ms > 0 ? `${r.ms}ms ` : ""}
                {r.note}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="text-xs font-semibold opacity-70">日志</div>
        <textarea
          readOnly
          value={log.join("\n")}
          className="mt-1 h-56 w-full resize-none rounded bg-black/5 p-2 font-mono text-[11px] leading-4"
        />
      </Card>
    </div>
  );
}
