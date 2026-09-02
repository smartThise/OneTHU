declare const __APP_VERSION__: string;
import { useEffect, useState } from "react";
import { Card, PageHead, SectionHead } from "../components/Layout.js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { uploadCoursesToCourseX } from "@onethu/core";
import { clearRemembered, learn, loadRemembered, logLine, session } from "../lib/clients.js";
import { clearHomeLayout } from "../lib/homeCards.js";
import { getCourseXSession, loadCourseXConfig, saveCourseXConfig } from "../lib/coursex.js";
import { universalFetch } from "../lib/transport.js";
import { useApp } from "../state/context.js";

export function SettingsPage() {
  const { user, logout } = useApp();
  const [hasSaved, setHasSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 首页布局恢复：点击后短暂显示「已恢复默认」，到点回位
  const [homeResetAt, setHomeResetAt] = useState(0);
  const [eidMsg, setEidMsg] = useState<string | null>(null);

  /* —— 课程共享计划（courseX）—— */
  const [cxConfig, setCxConfig] = useState(() => loadCourseXConfig());
  const [cxInput, setCxInput] = useState("");
  const [cxMsg, setCxMsg] = useState<string | null>(null);
  const [cxTesting, setCxTesting] = useState(false);
  const [cxSharing, setCxSharing] = useState(false);

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

  /** 保存并测试连接：换 accessToken 成功即视为凭证有效 */
  const onCxSave = async () => {
    const token = cxInput.trim();
    if (!token) return;
    setCxTesting(true);
    setCxMsg(null);
    try {
      const s = getCourseXSession(token);
      await s!.getAccessToken(true);
      const cfg = { refreshToken: token, autoShare: cxConfig?.autoShare ?? false };
      saveCourseXConfig(cfg);
      setCxConfig(cfg);
      setCxInput("");
      setCxMsg("连接成功，课程信息页即可查询全校开课的上课地点。");
    } catch (err) {
      void logLine("PAGE-ERR COURSEX-SAVE " + (err instanceof Error ? err.message : String(err))).catch(() => undefined);
      setCxMsg(`连接失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCxTesting(false);
    }
  };

  /** 立即共享本学期课程：网络学堂课程列表 + 时间地点 → courseX 共享库 */
  const onCxShare = async () => {
    const s = getCourseXSession();
    if (!s) return;
    setCxSharing(true);
    setCxMsg(null);
    try {
      const semester = await learn.getCurrentSemester();
      const courses = await learn.getCourseListForSharing(semester.id);
      const n = await uploadCoursesToCourseX(
        universalFetch,
        s,
        courses.map((c) => ({
          id: c.id,
          name: c.name,
          englishName: c.englishName || undefined,
          // 教师号（jsh）缺失时 core 自动省略 teacher 嵌套对象
          teacherId: c.teacherNumber || undefined,
          teacherName: c.teacherName,
          timeLocation: c.timeAndLocation,
          semesterId: semester.id,
          number: c.courseNumber,
          index: c.courseIndex,
        })),
      );
      const cfg = { ...(cxConfig ?? { refreshToken: s.refreshToken, autoShare: false }), lastSharedAt: Date.now(), lastSharedCount: n };
      saveCourseXConfig(cfg);
      setCxConfig(cfg);
      setCxMsg(`已共享本学期 ${courses.length} 门课程（影响 ${n} 行）——感谢回馈共享库！`);
    } catch (err) {
      void logLine("PAGE-ERR COURSEX-SHARE " + (err instanceof Error ? err.message : String(err))).catch(() => undefined);
      setCxMsg(`共享失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCxSharing(false);
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

      <SectionHead title="课程共享计划" />
      <Card>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="setting-title">共享回馈（可选）· 连接 courseX</div>
            <div className="setting-desc">
              「信息 → 课程信息」的查询走公开网页，无需任何配置；只有把自己的课程
              时间地点上传回馈共享库时才需要连接。在浏览器注册并登录 tsinghua.app，
              开发者工具（F12）→ Application → Cookies 复制 __Host-refresh_token 的值粘贴到此处。
              {cxConfig
                ? cxConfig.lastSharedAt
                  ? ` 已连接 · 上次共享 ${new Date(cxConfig.lastSharedAt).toLocaleString()}（${cxConfig.lastSharedCount ?? 0} 行）。`
                  : " 已连接。"
                : " 当前未连接（不影响查询，仅不能上传回馈）。"}
            </div>
            {cxMsg ? (
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>{cxMsg}</div>
            ) : null}
            {cxConfig ? null : (
              <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 420 }}>
                <input
                  className="input"
                  type="password"
                  style={{ flex: 1 }}
                  value={cxInput}
                  onChange={(e) => setCxInput(e.target.value)}
                  placeholder="粘贴 __Host-refresh_token"
                  aria-label="courseX refresh token"
                />
                <button className="btn" disabled={cxTesting || !cxInput.trim()} onClick={() => void onCxSave()}>
                  {cxTesting ? "测试中…" : "保存并测试"}
                </button>
              </div>
            )}
          </div>
          {cxConfig ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" disabled={cxSharing} onClick={() => void onCxShare()}>
                {cxSharing ? "共享中…" : "立即共享本学期课程"}
              </button>
              <button
                className="btn"
                disabled={cxTesting}
                onClick={() => {
                  saveCourseXConfig(null);
                  setCxConfig(null);
                  setCxMsg("已断开连接（本地凭证已清除）。");
                }}
              >
                断开
              </button>
            </div>
          ) : null}
        </div>
        {cxConfig ? (
          <div className="setting-row">
            <div>
              <div className="setting-title">共享说明</div>
              <div className="setting-desc">
                「立即共享」会上传本学期课程的时间地点（课号、课序、课名、教师、上课时间地点），
                不包含任何个人信息——与 learnX 官方口径一致。共享后全校用户都能查到这些课在哪里上。
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => void openUrl("https://tsinghua.app/courses")}>
              访问 courseX
            </button>
          </div>
        ) : null}
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
