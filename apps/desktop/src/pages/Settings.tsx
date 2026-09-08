declare const __APP_VERSION__: string;
import { useEffect, useState } from "react";
import { Card, PageHead, SectionHead } from "../components/Layout.js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearRemembered, loadRemembered, session } from "../lib/clients.js";
import { clearHomeLayout } from "../lib/homeCards.js";
import { useFavs } from "../state/favs.js";
import { parseFavs, resetFavs } from "../state/favorites.js";
import { confirmOk } from "../lib/confirm.js";
import { useApp } from "../state/context.js";
import { useCloudCal, configureCloudCal, disconnectCloudCal, syncCloudCal } from "../state/cloudCal.js";

export function SettingsPage() {
  const { user, logout, navigate } = useApp();
  const favs = useFavs();
  const [favMsg, setFavMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [hasSaved, setHasSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 首页布局恢复：点击后短暂显示「已恢复默认」，到点回位
  const [homeResetAt, setHomeResetAt] = useState(0);
  const [eidMsg, setEidMsg] = useState<string | null>(null);
  // 云同步（清华邮箱 CalDAV 日历）
  const cloud = useCloudCal();
  const [calEmail, setCalEmail] = useState("");
  const [calPass, setCalPass] = useState("");
  const [calBusy, setCalBusy] = useState(false);
  const [calMsg, setCalMsg] = useState<string | null>(null);

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


      <SectionHead title="云同步" />
      <Card>
        {cloud.configured ? (
          <div className="setting-row">
            <div>
              <div className="setting-title">日程云同步 · 已连接</div>
              <div className="setting-desc">
                {cloud.email} · 通过清华邮箱日历（CalDAV）多设备同步日程；在「日程」页查看与编辑。
                {calMsg ? <div style={{ marginTop: 6, color: "var(--text-2)" }}>{calMsg}</div> : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                className="btn"
                onClick={() =>
                  void confirmOk(
                    "系统日历自动同步指引（推荐，一次设置）\n\n在系统的日历 App 里添加清华邮箱账户：\n· macOS：日历 → 设置 → 账户 → 添加 CalDAV 账户 → 高级\n· iPhone/iPad：设置 → 日历 → 账户 → 添加账户 → 其他 → CalDAV 账户\n· 服务器地址：https://mails.tsinghua.edu.cn/coremail/dav/users/你的邮箱/\n· 用户名：完整邮箱；密码：客户端专用密码（与本页一致）\n\n添加后系统日历与应用读写同一个云端日历，自动保持一致，无需再手动导出。",
                  )
                }
              >
                系统日历指引
              </button>
              <button
                className="btn"
                disabled={calBusy || cloud.syncing}
                onClick={() => {
                  setCalBusy(true);
                  setCalMsg(null);
                  void syncCloudCal()
                    .then((r) => setCalMsg(`已同步：云端共 ${r.total} 个日程（新增 ${r.added}、更新 ${r.updated}、移除 ${r.removed}）。`))
                    .catch((e: unknown) => setCalMsg(`同步失败：${e instanceof Error ? e.message : String(e)}`))
                    .finally(() => setCalBusy(false));
                }}
              >
                {calBusy || cloud.syncing ? "同步中…" : "立即同步"}
              </button>
              <button
                className="btn"
                onClick={() =>
                  void disconnectCloudCal().then(() => {
                    setCalEmail("");
                    setCalPass("");
                    setCalMsg(null);
                  })
                }
              >
                断开
              </button>
            </div>
          </div>
        ) : (
          <div className="setting-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="setting-title">日程云同步（清华邮箱日历）</div>
              <div className="setting-desc">
                用清华邮箱的日历服务在多台设备间同步日程——OneTHU 里添加的日程会出现在系统日历 / 其他设备（添加同一账号）。
                授权码获取：网页版邮箱（mails.tsinghua.edu.cn）→ 设置 → 客户端专用密码。
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ minWidth: 200, flex: 1 }}
                  placeholder="完整邮箱地址（如 someone@mails.tsinghua.edu.cn）"
                  value={calEmail}
                  onChange={(e) => setCalEmail(e.target.value.trim())}
                />
                <input
                  className="input"
                  type="password"
                  style={{ minWidth: 140, flex: 1 }}
                  placeholder="客户端专用密码"
                  value={calPass}
                  onChange={(e) => setCalPass(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  disabled={!/.+@.+/.test(calEmail) || !calPass || calBusy}
                  onClick={() => {
                    setCalBusy(true);
                    setCalMsg(null);
                    void configureCloudCal(calEmail, calPass)
                      .then((cals) => setCalMsg(`连接成功，发现日历：${cals.join("、")}。`))
                      .catch((e: unknown) => setCalMsg(`连接失败：${e instanceof Error ? e.message : String(e)}`))
                      .finally(() => setCalBusy(false));
                  }}
                >
                  {calBusy ? "连接中…" : "保存并测试"}
                </button>
              </div>
              {calMsg ? <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{calMsg}</div> : null}
            </div>
          </div>
        )}
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

      <SectionHead title="收藏夹" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="setting-title">恢复默认收藏夹</div>
            <div className="setting-desc">
              删除全部用户收藏夹与折叠记录（默认一级入口不受影响，永远在左侧栏）。
              各功能原子仍锚定在原位页面，收藏夹只是跳转入口层。
            </div>
            {favMsg ? <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{favMsg}</div> : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              className="btn"
              onClick={() => {
                const json = JSON.stringify(favs.data);
                const clip = navigator.clipboard;
                if (!clip?.writeText) {
                  setFavMsg("剪贴板不可用——请用「导入」框核对，或截图反馈。");
                  return;
                }
                void clip
                  .writeText(json)
                  .then(() => setFavMsg("收藏夹 JSON 已复制到剪贴板（" + favs.data.order.length + " 个根收藏夹）"))
                  .catch(() => setFavMsg("复制失败：剪贴板被拒绝，可改用导入框反向核对。"));
              }}
            >
              导出（复制 JSON）
            </button>
            <button className="btn" onClick={() => { setImportOpen((o) => !o); setImportText(""); setFavMsg(null); }}>
              导入
            </button>
            <button
              className="btn"
              onClick={() =>
                void confirmOk("删除全部用户收藏夹并复位折叠记录？默认一级入口不受影响。").then((ok) => {
                  if (!ok) return;
                  favs.replaceAll(resetFavs());
                  setFavMsg("已恢复默认。");
                })
              }
            >
              恢复默认
            </button>
          </div>
        </div>
        {importOpen ? (
          <div style={{ marginTop: 12 }}>
            <textarea
              className="input"
              style={{ width: "100%", minHeight: 120, fontFamily: "var(--mono, monospace)", fontSize: 12 }}
              placeholder={"粘贴收藏夹 JSON（设置页导出的格式）…"}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-primary"
                disabled={!importText.trim()}
                onClick={() => {
                  const parsed = parseFavs(importText);
                  if (!parsed) {
                    setFavMsg("导入失败：JSON 结构不合法（需要 onethu.favs.v1 导出格式）。");
                    return;
                  }
                  favs.replaceAll(parsed);
                  setImportOpen(false);
                  setImportText("");
                  setFavMsg("已导入 " + parsed.order.length + " 个根收藏夹。");
                }}
              >
                导入并覆盖
              </button>
              <button className="btn btn-ghost" onClick={() => setImportOpen(false)}>取消</button>
            </div>
          </div>
        ) : null}
      </Card>

      <SectionHead title="插件" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">插件管理</div>
            <div className="setting-desc">Rust 骨干与 JS 模块的安装、启停、权限与运行轨迹</div>
          </div>
          <button className="btn" onClick={() => navigate("plugins")}>
            进入插件页
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
