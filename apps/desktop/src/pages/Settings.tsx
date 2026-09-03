declare const __APP_VERSION__: string;
import { useEffect, useRef, useState } from "react";
import { Card, PageHead, SectionHead } from "../components/Layout.js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearRemembered, loadRemembered, session } from "../lib/clients.js";
import { clearHomeLayout } from "../lib/homeCards.js";
import {
  APP_ICON_OPTIONS,
  CUSTOM_ICON_ID,
  applyAppIcon,
  loadAppIconId,
  loadCustomIconB64,
  removeCustomIcon,
  saveCustomIcon,
} from "../lib/appIcon.js";
import { useApp } from "../state/context.js";

export function SettingsPage() {
  const { user, logout } = useApp();
  const [hasSaved, setHasSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 首页布局恢复：点击后短暂显示「已恢复默认」，到点回位
  const [homeResetAt, setHomeResetAt] = useState(0);
  const [eidMsg, setEidMsg] = useState<string | null>(null);

  /* —— 主题：应用图标 —— */
  const [iconId, setIconId] = useState(() => loadAppIconId());
  const fileRef = useRef<HTMLInputElement>(null);
  const [customB64, setCustomB64] = useState<string | null>(null);
  const [iconMsg, setIconMsg] = useState<string | null>(null);

  useEffect(() => {
    void loadCustomIconB64().then(setCustomB64);
  }, []);

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

      <SectionHead title="主题" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="setting-title">应用图标</div>
            <div className="setting-desc">
              更改窗口与任务栏图标，点击即时生效、重启保持。点「+」上传自定义图片
              （自动居中裁方缩到 256×256）。注意：应用文件（.exe）本身的图标为编译期
              资源不变；macOS 与 Android 暂不支持自定义/运行时更换。
            </div>
            {iconMsg ? (
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--danger, #e5484d)" }}>{iconMsg}</div>
            ) : null}
            <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
              {APP_ICON_OPTIONS.map((o) => {
                const active = o.id === iconId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setIconId(o.id);
                      void applyAppIcon(o.id);
                    }}
                    aria-pressed={active}
                    title={o.label}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "10px 14px",
                      border: active ? "2px solid var(--accent)" : "2px solid transparent",
                      background: active ? "var(--accent-soft)" : "transparent",
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                  >
                    <img src={o.src} alt={o.label} width={48} height={48} style={{ borderRadius: 10 }} />
                    <span style={{ fontSize: 12, color: "var(--text-2)" }}>{o.label}</span>
                  </button>
                );
              })}
              {customB64 ? (
                <button
                  key={CUSTOM_ICON_ID}
                  type="button"
                  onClick={() => {
                    setIconId(CUSTOM_ICON_ID);
                    void applyAppIcon(CUSTOM_ICON_ID);
                  }}
                  onContextMenu={(e) => {
                    // 长按/右键移除自定义图标
                    e.preventDefault();
                    void removeCustomIcon().then(() => {
                      setCustomB64(null);
                      setIconId(loadAppIconId());
                    });
                  }}
                  aria-pressed={iconId === CUSTOM_ICON_ID}
                  title="自定义图标（右键移除）"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    padding: "10px 14px",
                    border: iconId === CUSTOM_ICON_ID ? "2px solid var(--accent)" : "2px solid transparent",
                    background: iconId === CUSTOM_ICON_ID ? "var(--accent-soft)" : "transparent",
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  <img
                    src={`data:image/png;base64,${customB64}`}
                    alt="自定义图标"
                    width={48}
                    height={48}
                    style={{ borderRadius: 10 }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-2)" }}>自定义</span>
                </button>
              ) : null}
              <button
                key="__upload"
                type="button"
                title="上传自定义图标"
                onClick={() => fileRef.current?.click()}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "10px 14px",
                  border: "2px dashed var(--border, #ccc)",
                  background: "transparent",
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden
                  style={{ fontSize: 30, lineHeight: "48px", width: 48, textAlign: "center", color: "var(--text-2)" }}
                >
                  +
                </span>
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>上传</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // 允许重复选择同一文件
                  if (!file) return;
                  void saveCustomIcon(file)
                    .then(() => {
                      setIconId(CUSTOM_ICON_ID);
                      return loadCustomIconB64();
                    })
                    .then((b64) => {
                      setCustomB64(b64);
                      setIconMsg(null);
                    })
                    .catch((err: unknown) =>
                      setIconMsg(err instanceof Error ? err.message : String(err)),
                    );
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      <SectionHead title="关于" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">OneTHU {__APP_VERSION__}</div>
            <div className="setting-desc">清华园随身工具箱 · 开源于 GitHub</div>
          </div>
          <button className="btn" onClick={() => void openUrl("https://github.com/smartThise/OneTHU")}>
            GitHub 项目页
          </button>
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
                void openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg("已在系统浏览器打开电子身份，请手动输入账号密码。"))
                  .catch((e: unknown) => setEidMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`));
                return;
              }
              const openInBrowser = () =>
                openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg("已在系统浏览器打开电子身份（多窗口自动填入仅桌面端支持）"))
                  .catch((e: unknown) => setEidMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`));
              void invoke("open_eid_window", { username: creds.username, password: creds.password })
                .then(() => setEidMsg("已打开电子身份窗口（账号密码已自动填入）"))
                .catch(() => void openInBrowser());
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
