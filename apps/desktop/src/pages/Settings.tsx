import { useEffect, useState } from "react";
import { Card, PageHead, SectionHead } from "../components/Layout.js";
import { invoke } from "@tauri-apps/api/core";
import { clearRemembered, loadRemembered, session } from "../lib/clients.js";
import { clearHomeLayout } from "../lib/homeCards.js";
import { useApp } from "../state/context.js";

export function SettingsPage() {
  const { user, logout } = useApp();
  const [hasSaved, setHasSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 首页布局恢复：点击后短暂显示「已恢复默认」，到点回位
  const [homeResetAt, setHomeResetAt] = useState(0);
  const [eidMsg, setEidMsg] = useState<string | null>(null);

  useEffect(() => {
    void loadRemembered().then((r) => setHasSaved(!!r));
  }, []);

  useEffect(() => {
    if (!homeResetAt) return;
    const t = setTimeout(() => setHomeResetAt(0), 2400);
    return () => clearTimeout(t);
  }, [homeResetAt]);

  const onClear = async () => {
    setClearing(true);
    try {
      await clearRemembered();
      setHasSaved(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <PageHead title="设置" />

      <SectionHead title="设备诊断" />
      <Card>
        <div style={{ display: "grid", gap: 4, fontSize: "var(--text-xs)", fontFamily: "var(--font-mono, monospace)", wordBreak: "break-all" }}>
          <span>视口 {window.innerWidth}×{window.innerHeight} · DPR {window.devicePixelRatio}</span>
          <span>触点 {navigator.maxTouchPoints} · coarse={window.matchMedia("(pointer: coarse)").matches ? "是" : "否"} · ≤860={window.matchMedia("(max-width: 860px)").matches ? "是" : "否"} · 竖屏={window.matchMedia("(orientation: portrait)").matches ? "是" : "否"}</span>
          <span>密度层 is-phone={document.documentElement.classList.contains("is-phone") ? "生效" : "未生效"} · 缩放 textZoom={(() => { try { return String((window as unknown as { visualViewport?: VisualViewport }).visualViewport?.scale ?? 1); } catch { return "1"; } })()}</span>
        </div>
      </Card>

      <SectionHead title="账户" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">统一认证</div>
            <div className="setting-desc">{user?.displayName || user?.username || "未登录"}</div>
          </div>
          <button className="btn" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </Card>

      <SectionHead title="账户设置" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="setting-title">清华电子身份（信任因子 / 密码管理）</div>
            <div className="setting-desc">
              在原生窗口打开 id.tsinghua.edu.cn，自动填入账号密码（有图形验证码时需手动输入）。
              <b>注意：删除信任因子或修改密码可能导致 OneTHU 退出登录</b>，需重新登录一次。
            </div>
            {eidMsg ? (
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{eidMsg}</div>
            ) : null}
          </div>
          <button
            className="btn"
            onClick={() => {
              const creds = session.getIdCredentials();
              if (!creds) {
                setEidMsg("当前会话没有内存密码（重启恢复的会话），请在窗口中手动输入账号密码。");
                void invoke("open_eid_window", { username: "", password: "" });
                return;
              }
              void invoke("open_eid_window", { username: creds.username, password: creds.password })
                .then(() => setEidMsg("已打开电子身份窗口（账号密码已自动填入）"))
                .catch((e: unknown) => setEidMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`));
            }}
          >
            打开电子身份
          </button>
        </div>
      </Card>

      <SectionHead title="首页" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">恢复默认首页布局</div>
            <div className="setting-desc">
              清除「今日」页卡片的排列、折叠与隐藏记录（onethu.home.layout /
              onethu.home.defaults 两个本地键），下次打开首页回到默认版式（主栏：
              日程与提醒 / 未提交作业 / 最近通知；侧栏：校园卡余额 / 今日预约 /
              今日课程 / 订阅新闻；入口卡全部隐藏）。
            </div>
          </div>
          <button className="btn" onClick={() => { clearHomeLayout(); setHomeResetAt(Date.now()); }}>
            {homeResetAt ? "已恢复默认" : "恢复默认布局"}
          </button>
        </div>
      </Card>

      <SectionHead title="安全" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">记住的密码</div>
            <div className="setting-desc">
              {hasSaved
                ? "已在本机保存（混淆存储，应用数据目录，非明文）；刷新/重启后自动登录。"
                : "未保存。登录页勾选「记住密码」即可启用。"}
            </div>
          </div>
          {hasSaved ? (
            <button className="btn" disabled={clearing} onClick={() => void onClear()}>
              {clearing ? "清除中…" : "清除"}
            </button>
          ) : null}
        </div>
      </Card>
    </>
  );
}
