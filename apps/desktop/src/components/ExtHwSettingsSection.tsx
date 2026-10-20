/* ══════════════════════════════════════════════════════════════════════════════
 * 外部作业源分节（2026-10-14 自 Settings.tsx 机械搬运，YE 逻辑零改动）：
 * 本文件是换血后剩余最大的单文件独立样式收敛点——exthw-* 卡片族、
 * OjSourceRow、OJ 折叠组全挂在这里；整节孤立后才能单独成轮收编。
 * 依赖与 Settings 原有 import 一致（见下）。
 * ══════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AccordionItem, Btn, Card, Checkbox, Inline, Input, Tag, Text as OGText, TextArea } from "@onethu/gui";
import { SectionHead } from "./Layout.js";
import { YktQrPanel, YktWebLoginPanel } from "./ExtHwLoginModal.js";
import { YKT_WEB_LOGIN_AVAILABLE } from "../lib/yktWebview.js";
import { confirmOk } from "../lib/confirm.js";
import {
  clearTuojAutoStatus,
  clearTycheLogoutSuppress,
  consumeExtHwScrollRequest,
  ensureExtHwCredsLoaded,
  extHwLogin,
  refreshExtHw,
  removeExtHwCreds,
  runYktSessionCheck,
  saveExtHwCreds,
  useExternalHomework,
} from "../state/exthw.js";
import {
  buildYktCookieExportJson,
  parseYktCookieExportJson,
  SOURCE_CATEGORY_NAMES,
  SOURCE_NAMES,
  type ExtHwCreds,
  type ExtHwSourceId,
  type TuojSourceId,
} from "@onethu/core";
import { t as i18n } from "../i18n/index.js";


/** R15 20.3：OJ 源统一行范式 —— `源名 + 状态徽标 …… 主操作 + 「更多」折叠`。
 *  备选登录方式一律收进 more 折叠；行内只在需要用户动作时出现提示（会话失效 / 自动登录失败）。 */
function OjSourceRow({
  name,
  logged,
  via,
  primary,
  more,
  note,
  children,
}: {
  name: string;
  logged: boolean;
  /** 已登录方式（统一认证 / 账号密码），显示在徽标内 */
  via?: string;
  primary: ReactNode;
  more?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="exthw-src">
      <div className="exthw-src-head">
        <OGText weight="semibold" nowrap={false}>{name}</OGText>
        <Tag tone={logged ? "success" : undefined}>{logged ? `已登录${via ? `·${via}` : ""}` : "未登录"}</Tag>
        <span className="exthw-src-actions">
          {primary}
          {more}
        </span>
      </div>
      {note}
      {children}
    </div>
  );
}

/* ── 外部作业源（雨课堂 / TUOJ 系 / Tyche / DSA OJ）── */
export function ExtHwSettingsSection(): ReactNode {
  const ext = useExternalHomework();
  // 雨课堂
  const [yktPhone, setYktPhone] = useState("");
  const [yktCookie, setYktCookie] = useState("");
  const [yktQrOpen, setYktQrOpen] = useState(false);
  // R18 24.2：官方网页登录（应用内 WebView，支持扫码 / 短信）
  const [yktWebOpen, setYktWebOpen] = useState(false);
  // TUOJ（AI 版）
  const [tuojUser, setTuojUser] = useState("");
  const [tuojPwd, setTuojPwd] = useState("");
  const [tuojCookie, setTuojCookie] = useState("");
  const [tuojVia, setTuojVia] = useState<"cas" | "password" | undefined>(undefined);
  const [tuojPwdOpen, setTuojPwdOpen] = useState(false);
  // TUOJ（经典版）
  const [classicUser, setClassicUser] = useState("");
  const [classicPwd, setClassicPwd] = useState("");
  const [classicCookie, setClassicCookie] = useState("");
  const [classicVia, setClassicVia] = useState<"cas" | "password" | undefined>(undefined);
  const [classicPwdOpen, setClassicPwdOpen] = useState(false);
  // Tyche
  const [tycheUser, setTycheUser] = useState("");
  const [tychePwd, setTychePwd] = useState("");
  const [tycheCookie, setTycheCookie] = useState("");
  const [tycheFormOpen, setTycheFormOpen] = useState(false);
  // R21-A：记住密码（勾选后 username+password 随凭据信封 AES-GCM 存本机；
  // 会话失效时用存档账密静默自动重登一次。tycheSavedPwd = 已存档密码的内存回填，
  // 与 tycheCookie 同性质：只在内存态用于组装保存，不显示明文）
  const [tycheRemember, setTycheRemember] = useState(false);
  const [tycheSavedPwd, setTycheSavedPwd] = useState("");
  // DSA OJ
  const [dsaUser, setDsaUser] = useState("");
  const [dsaPwd, setDsaPwd] = useState("");
  const [dsaCookie, setDsaCookie] = useState("");
  const [dsaFormOpen, setDsaFormOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [advanced, setAdvanced] = useState(false);
  // R14 19.2：OJ 平台组默认折叠（展开态不持久化，符合需求下限）
  const [ojOpen, setOjOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // R17 23.4：操作反馈「就近显示」——按触发区域归属，渲染在对应卡片内，
  // 而不是统一堆在页面底部（真机实测在屏幕外，用户以为什么都没发生）。
  const [msgArea, setMsgArea] = useState<"yuketang" | "oj" | "range">("range");
  const notify = (area: "yuketang" | "oj" | "range", text: string): void => {
    setMsgArea(area);
    setMsg(text);
  };

  // 凭据在 localStorage 里是密文：首次挂载异步解密后回填表单
  useEffect(() => {
    let alive = true;
    void ensureExtHwCredsLoaded().then((c) => {
      if (!alive) return;
      setYktPhone(c.yuketang?.phone ?? "");
      setYktCookie(c.yuketang?.cookie ?? "");
      setTuojUser(c.tuoj?.username ?? "");
      setTuojCookie(c.tuoj?.cookie ?? "");
      setTuojVia(c.tuoj?.via);
      setClassicUser(c.tuojClassic?.username ?? "");
      setClassicCookie(c.tuojClassic?.cookie ?? "");
      setClassicVia(c.tuojClassic?.via);
      setTycheUser(c.tyche?.username ?? "");
      setTycheCookie(c.tyche?.cookie ?? "");
      setTycheRemember(Boolean(c.tyche?.password));
      setTycheSavedPwd(c.tyche?.password ?? "");
      setDsaUser(c.dsa?.username ?? "");
      setDsaCookie(c.dsa?.cookie ?? "");
      setDays(String(c.days ?? 30));
    });
    return () => {
      alive = false;
    };
  }, []);

  // R11 16.3 的「滚动到本区」已上移 SettingsPage（R23：先切页签再滚动，否则分区在
  // display:none 里滚动无效）——此处不再重复消费标记。

  // R11 16.2：自动登录在本区打开后才完成时，把凭据回填到表单（否则状态 ✅ 与「未登录」打架）
  useEffect(() => {
    if (ext.tuojAuto.tuoj.kind !== "ok" && ext.tuojAuto.tuojClassic.kind !== "ok") return;
    let alive = true;
    void ensureExtHwCredsLoaded().then((c) => {
      if (!alive) return;
      setTuojCookie(c.tuoj?.cookie ?? "");
      setTuojVia(c.tuoj?.via);
      setClassicCookie(c.tuojClassic?.cookie ?? "");
      setClassicVia(c.tuojClassic?.via);
    });
    return () => {
      alive = false;
    };
  }, [ext.tuojAuto.tuoj.kind, ext.tuojAuto.tuojClassic.kind]);

  const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /** 组装待保存凭据；o.* 传入刚登录拿到的 Cookie（state 尚未刷新时用）。
   *  R21-A：o.tychePwd = 刚登录成功、且勾选「记住密码」时要存档的密码（随 AES-GCM
   *  信封加密落盘）；未勾选 → 不存密码（并清掉旧存档，即「取消记住」）。 */
  const credsWith = (
    o: {
      ykt?: string;
      tuoj?: string;
      tuojVia?: "cas" | "password";
      classic?: string;
      classicVia?: "cas" | "password";
      tyche?: string;
      tychePwd?: string;
      dsa?: string;
    } = {},
  ): ExtHwCreds => {
    const yk = (o.ykt ?? yktCookie).trim();
    const tj = (o.tuoj ?? tuojCookie).trim();
    const cj = (o.classic ?? classicCookie).trim();
    const tc = (o.tyche ?? tycheCookie).trim();
    const ds = (o.dsa ?? dsaCookie).trim();
    return {
      yuketang: yk ? { cookie: yk, phone: yktPhone.trim() || undefined } : undefined,
      tuoj: tj ? { cookie: tj, username: tuojUser.trim() || undefined, via: o.tuojVia ?? tuojVia } : undefined,
      tuojClassic: cj
        ? { cookie: cj, username: classicUser.trim() || undefined, via: o.classicVia ?? classicVia }
        : undefined,
      tyche: tc
        ? {
            cookie: tc,
            username: tycheUser.trim() || undefined,
            password: tycheRemember ? (o.tychePwd ?? (tycheSavedPwd || undefined)) : undefined,
          }
        : undefined,
      dsa: ds ? { cookie: ds, username: dsaUser.trim() || undefined } : undefined,
      days: Math.max(1, Number(days) || 30),
    };
  };

  const onSave = () => {
    void saveExtHwCreds(credsWith()).then(() => notify("range", "已保存到本机。"));
  };

  const onRefresh = () => {
    setBusy("refresh");
    setMsg(null);
    void saveExtHwCreds(credsWith())
      .then(() => refreshExtHw())
      .then(() => notify("range", "刷新完成。"))
      .catch((e: unknown) => notify("range", `刷新失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /* ── R21-B：雨课堂会话健康 + Cookie 导出/导入（侦查结论：服务端无续期端点，
   *    保活只能周期性轻量试探；失效只能重登；多设备迁移用导出/导入缓解）── */

  /** 手动触发一次会话健康检查（与 6h 心跳同款：GET basic-info） */
  const onYktCheckSession = () => {
    setBusy("ykt-check");
    setMsg(null);
    void runYktSessionCheck()
      .then((st) => {
        if (!st) {
          notify("yuketang", "未配置雨课堂登录状态——请先登录。");
          return;
        }
        if (st.alive === true) notify("yuketang", `会话有效${st.userName ? `（${st.userName}）` : ""}。`);
        else if (st.alive === false) notify("yuketang", `会话已失效（${st.reason ?? "未知原因"}）——可扫码重登，或导入其他设备导出的 Cookie。`);
        else notify("yuketang", "检查未成功：网络异常，登录状态未知");
      })
      .finally(() => setBusy(null));
  };

  /** 导出雨课堂 Cookie：文件即完整登录凭据（自带 sensitive 标注），仅存本机自选位置 */
  const onYktExportCookie = () => {
    setBusy("ykt-export");
    setMsg(null);
    void (async (): Promise<string> => {
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error("浏览器预览不支持导出，请在桌面端操作");
      }
      const c = await ensureExtHwCredsLoaded();
      if (!c.yuketang?.cookie?.trim()) throw new Error("尚未登录雨课堂，无可导出的登录状态");
      const json = buildYktCookieExportJson(c.yuketang);
      const { invoke } = await import("@tauri-apps/api/core");
      const date = new Date().toISOString().slice(0, 10);
      const path = await invoke<string | null>("save_text_file", {
        filename: `onethu-yuketang-cookie-${date}.json`,
        contents: json,
      });
      if (!path) return "已取消导出。";
      return `已导出到 ${path}。⚠️ 该文件等同账号凭据：勿放同步盘 / 群聊 / 仓库，导入完成后请删除。`;
    })()
      .then((m) => notify("yuketang", m))
      .catch((e: unknown) => notify("yuketang", `导出失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** 导入另一台设备导出的 Cookie（免重新扫码）；导入后立即刷新外部作业 */
  const onYktImportCookie = () => {
    setBusy("ykt-import");
    setMsg(null);
    void (async (): Promise<string> => {
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error("浏览器预览不支持导入，请在桌面端操作");
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const sel = await open({ multiple: false, filters: [{ name: "雨课堂登录状态", extensions: ["json"] }] });
      if (!sel || typeof sel !== "string") return "已取消导入。";
      const text = await invoke<string>("read_file_text", { path: sel });
      const parsed = parseYktCookieExportJson(text);
      const cur = await ensureExtHwCredsLoaded();
      await saveExtHwCreds({
        ...cur,
        yuketang: {
          cookie: parsed.cookie,
          uvId: parsed.uvId ?? cur.yuketang?.uvId,
          phone: parsed.phone ?? cur.yuketang?.phone,
        },
      });
      setYktCookie(parsed.cookie);
      if (parsed.phone) setYktPhone(parsed.phone);
      void refreshExtHw();
      return "已导入雨课堂登录状态，正在刷新外部作业。";
    })()
      .then((m) => notify("yuketang", m))
      .catch((e: unknown) => notify("yuketang", `导入失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** TUOJ 系主路径：清华统一认证漫游（零凭据；AI 版 / 经典版仅 base 不同） */
  const onTuojCasLogin = (source: TuojSourceId) => {
    setBusy(`tuoj-cas-${source}`);
    setMsg(null);
    void extHwLogin
      .tuojCas(source)
      .then(async (r) => {
        if (source === "tuoj") {
          setTuojCookie(r.cookie);
          setTuojVia("cas");
        } else {
          setClassicCookie(r.cookie);
          setClassicVia("cas");
        }
        clearTuojAutoStatus(source);
        await saveExtHwCreds(
          source === "tuoj" ? credsWith({ tuoj: r.cookie, tuojVia: "cas" }) : credsWith({ classic: r.cookie, classicVia: "cas" }),
        );
        notify("oj", `${SOURCE_NAMES[source]} 已通过清华统一认证登录，已保存。`);
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `${SOURCE_NAMES[source]} 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** TUOJ 系备选：账号密码登录（收在「更多」折叠内） */
  const onTuojPwdLogin = (source: TuojSourceId) => {
    const user = source === "tuoj" ? tuojUser : classicUser;
    const pwd = source === "tuoj" ? tuojPwd : classicPwd;
    setBusy(`tuoj-pwd-${source}`);
    setMsg(null);
    const run = source === "tuoj" ? extHwLogin.tuoj(user, pwd) : extHwLogin.tuojClassic(user, pwd);
    void run
      .then(async (r) => {
        if (source === "tuoj") {
          setTuojCookie(r.cookie);
          setTuojVia("password");
          setTuojPwd("");
        } else {
          setClassicCookie(r.cookie);
          setClassicVia("password");
          setClassicPwd("");
        }
        clearTuojAutoStatus(source);
        await saveExtHwCreds(
          source === "tuoj"
            ? credsWith({ tuoj: r.cookie, tuojVia: "password" })
            : credsWith({ classic: r.cookie, classicVia: "password" }),
        );
        notify("oj", `${SOURCE_NAMES[source]} 登录成功，已保存。`);
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `${SOURCE_NAMES[source]} 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onTycheLogin = () => {
    setBusy("tyche-login");
    setMsg(null);
    const pwdNow = tychePwd; // async 回调前留档（下面 setTychePwd("") 会清空输入框）
    void extHwLogin
      .tyche(tycheUser, pwdNow)
      .then(async (r) => {
        setTycheCookie(r.cookie);
        // R21-A：勾选「记住密码」→ 把刚输的密码随凭据信封（AES-GCM）存档，会话失效时静默重登；
        // 未勾选 → 不存档（credsWith 里 password=undefined，同时覆盖清掉旧存档）
        if (tycheRemember) setTycheSavedPwd(pwdNow);
        // R21-A：手动登录成功 → 解除「显式退出」对自动重登的抑制
        clearTycheLogoutSuppress();
        setTychePwd("");
        setTycheFormOpen(false);
        await saveExtHwCreds(credsWith({ tyche: r.cookie, tychePwd: tycheRemember ? pwdNow : undefined }));
        notify("oj", tycheRemember ? "Tyche 登录成功，已记住密码" : "Tyche 登录成功，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `Tyche 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  const onDsaLogin = () => {
    setBusy("dsa-login");
    setMsg(null);
    void extHwLogin
      .dsa(dsaUser, dsaPwd)
      .then(async (r) => {
        setDsaCookie(r.cookie);
        setDsaPwd("");
        setDsaFormOpen(false);
        await saveExtHwCreds(credsWith({ dsa: r.cookie }));
        notify("oj", "DSA OJ 登录成功，已保存。");
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", `DSA OJ 登录失败：${errMsg(e)}`))
      .finally(() => setBusy(null));
  };

  /** R12 17.2：单源退出登录 —— 确认后只清该源凭据，不影响其他源 */
  const onLogout = (source: ExtHwSourceId) => {
    const label = SOURCE_NAMES[source];
    void confirmOk(`确定退出${label}登录？将清除本机保存的${label}凭据，不影响其他源。`).then(
      async (ok) => {
        if (!ok) return;
        setBusy(`logout-${source}`);
        setMsg(null);
        try {
          await removeExtHwCreds(source);
          // 同步清空表单，避免随后点「保存」把旧 Cookie 又写回去
          if (source === "yuketang") {
            setYktCookie("");
          } else if (source === "tuoj") {
            setTuojCookie("");
            setTuojVia(undefined);
            setTuojPwd("");
          } else if (source === "tuojClassic") {
            setClassicCookie("");
            setClassicVia(undefined);
            setClassicPwd("");
          } else if (source === "tyche") {
            setTycheCookie("");
            setTychePwd("");
            // R21-A：退出 = 清掉「记住密码」态（removeExtHwCreds 已清存档并抑制自动重登）
            setTycheRemember(false);
            setTycheSavedPwd("");
          } else {
            setDsaCookie("");
            setDsaPwd("");
          }
          notify(source === "yuketang" ? "yuketang" : "oj", `已退出${label}登录。`);
          void refreshExtHw();
        } catch (e: unknown) {
          notify(source === "yuketang" ? "yuketang" : "oj", `退出${label}登录失败：${errMsg(e)}`);
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const configured: Record<ExtHwSourceId, boolean> = {
    yuketang: Boolean(yktCookie.trim()),
    tuoj: Boolean(tuojCookie.trim()) || tuojVia === "cas" || ext.tuojAuto.tuoj.kind === "ok",
    tuojClassic: Boolean(classicCookie.trim()) || classicVia === "cas" || ext.tuojAuto.tuojClassic.kind === "ok",
    tyche: Boolean(tycheCookie.trim()),
    dsa: Boolean(dsaCookie.trim()),
  };
  /** R15 20.3：仅在需要用户动作时提示（会话失效 / 自动登录失败 / 无课程） */
  const tuojNote = (source: TuojSourceId): ReactNode => {
    const st = ext.tuojAuto[source];
    return (
      <>
        {ext.errors[source] ? <OGText as="div" slot="label" tone="error">{ext.errors[source]}</OGText> : null}
        {st.kind === "failed" ? (
          <OGText as="div" slot="label" tone="warning">
            {i18n("auto.components.ExtHwSettingsSection.1")}{st.message ? `（${st.message.slice(0, 160)}）` : ""}{i18n("auto.components.ExtHwSettingsSection.2")}</OGText>
        ) : null}
        {st.kind === "no-courses" ? (
          <OGText as="div" slot="label" tone="faint">{i18n("auto.components.ExtHwSettingsSection.3")}</OGText>
        ) : null}
      </>
    );
  };
  const fieldStyle = { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } as const;
  const srcRows: Array<{ id: ExtHwSourceId; label: string; logged: boolean }> = (
    ["yuketang", "tuoj", "tuojClassic", "tyche", "dsa"] as const
  ).map((id) => ({ id, label: SOURCE_NAMES[id], logged: configured[id] }));

  return (
    <div id="settings-exthw">
      <OGText as="div" slot="label" tone="faint">
        {i18n("auto.components.ExtHwSettingsSection.4")}</OGText>

      {/* ── R14 19.1 / R15 20.3：雨课堂独立 Card，统一行范式 ── */}
      <SectionHead title={SOURCE_CATEGORY_NAMES.courseware} />
      <Card>
        <div className="exthw-src">
          <div className="exthw-src-head">
            <OGText weight="semibold">{i18n("auto.components.ExtHwSettingsSection.5")}</OGText>
            <Tag tone={configured.yuketang ? "success" : undefined}>
              {configured.yuketang ? "已登录" : "未登录"}
            </Tag>
            <span className="exthw-src-actions">
              {configured.yuketang ? (
                <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("yuketang")}>{busy === "logout-yuketang" ? "退出中…" : "退出"}</Btn>
              ) : (
                <>
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => {
                      setYktWebOpen(false);
                      setYktQrOpen((v) => !v);
                    }}>{yktQrOpen ? "收起扫码" : "微信扫码登录"}</Btn>
                  {/* R18 24.2：官方网页登录通道（应用内 WebView，支持扫码 / 短信）
                      R18b 25.3.2：桌面端原生窗口实测白屏卡死 → 隐藏该入口（二维码可用），仅 Android 保留 */}
                  {YKT_WEB_LOGIN_AVAILABLE ? (
                    <Btn variant="outline" disabled={busy !== null} titleAttr={i18n("auto.components.ExtHwSettingsSection.6")} onClick={() => {
                        setYktQrOpen(false);
                        setYktWebOpen((v) => !v);
                      }}>{yktWebOpen ? "收起网页登录" : "官方网页登录"}</Btn>
                  ) : null}
                </>
              )}
              <Btn variant="ghost" disabled titleAttr={i18n("auto.components.ExtHwSettingsSection.7")}>{i18n("auto.components.ExtHwSettingsSection.8")}</Btn>
            </span>
          </div>
          {/* R17 23.2：官方登录页发短信前先取图形验证码（TencentCaptcha/hCaptcha），
              纯接口无法内嵌 → 直接短信通道停用；R18 24.2 起可在「官方网页登录」
              应用内网页里正常使用短信（图形验证码由官方页自己完成）。
              R18b 25.3.2：桌面端该入口隐藏，文案不再引导到它。 */}
          <OGText as="div" slot="label" tone="faint">
            {YKT_WEB_LOGIN_AVAILABLE
              ? "雨课堂已开启图形验证码：请用微信扫码，或选「官方网页登录」。"
              : "雨课堂已启用图形验证码，直接短信登录暂不可用；请用微信或雨豆APP 扫码登录。"}
          </OGText>
          {msg && msgArea === "yuketang" ? (
            <div role="status"><OGText as="div" slot="label" tone="faint">{msg}</OGText></div>
          ) : null}
          {ext.errors.yuketang ? <OGText as="div" slot="label" tone="error">{ext.errors.yuketang}</OGText> : null}
          {/* R21-B：会话健康 + 保活状态 + 导出/导入（仅已登录时） */}
          {configured.yuketang ? (
            <>
              <OGText as="div" slot="label" tone="faint">
                {ext.yktSession.checkedAt === null
                  ? "登录状态：尚未检查（应用启动后会自动检查，约每 6 小时一次，也可手动检查）。"
                  : ext.yktSession.alive === true
                    ? `会话健康：有效${ext.yktSession.userName ? `（${ext.yktSession.userName}）` : ""} · 检查于 ${new Date(ext.yktSession.checkedAt).toLocaleTimeString()}`
                    : ext.yktSession.alive === false
                      ? `会话健康：已失效（${ext.yktSession.reason}）· 检查于 ${new Date(ext.yktSession.checkedAt).toLocaleTimeString()}`
                      : "登录状态：未知（上次检查时网络异常，不判定为失效）"}
              </OGText>
              <div style={fieldStyle}>
                <Btn variant="outline" disabled={busy !== null} onClick={onYktCheckSession}>{busy === "ykt-check" ? "检查中…" : "检查登录状态"}</Btn>
                <Btn variant="outline" disabled={busy !== null} titleAttr={i18n("auto.components.ExtHwSettingsSection.9")} onClick={onYktExportCookie}>{busy === "ykt-export" ? "导出中…" : "导出登录状态"}</Btn>
                <Btn variant="outline" disabled={busy !== null} titleAttr={i18n("auto.components.ExtHwSettingsSection.10")} onClick={onYktImportCookie}>{busy === "ykt-import" ? "导入中…" : "导入登录状态"}</Btn>
              </div>
              {ext.yktSession.alive === false ? (
                <OGText as="div" slot="label" tone="error">
                  {i18n("auto.components.ExtHwSettingsSection.11")}<div style={{ marginTop: 6 }}>
                    <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => {
                        setYktWebOpen(false);
                        setYktQrOpen(true);
                      }}>{i18n("auto.components.ExtHwSettingsSection.12")}</Btn>
                  </div>
                </OGText>
              ) : null}
            </>
          ) : null}
          {yktQrOpen ? (
            <YktQrPanel
              onCancel={() => setYktQrOpen(false)}
              onSuccess={(cookie) => {
                setYktCookie(cookie);
                setYktQrOpen(false);
                void saveExtHwCreds(credsWith({ ykt: cookie })).then(() => {
                  notify("yuketang", "雨课堂扫码登录成功，已保存。");
                  void refreshExtHw();
                });
              }}
            />
          ) : null}
          {yktWebOpen ? (
            <YktWebLoginPanel
              onCancel={() => setYktWebOpen(false)}
              onSuccess={(cookie) => {
                setYktCookie(cookie);
                setYktWebOpen(false);
                void saveExtHwCreds(credsWith({ ykt: cookie })).then(() => {
                  notify("yuketang", "雨课堂官方网页登录成功，已保存登录状态。");
                  void refreshExtHw();
                });
              }}
            />
          ) : null}
        </div>
      </Card>

      {/* ── R14 19.2 / R15 20.3：OJ 平台组默认折叠，标题行常显 4 源接入状态 ── */}
      <SectionHead title={SOURCE_CATEGORY_NAMES.oj} aside="按个人情况登录" />
      <Card>
        <AccordionItem
          id="oj"
          title={i18n("auto.components.ExtHwSettingsSection.13")}
          open={ojOpen}
          onToggle={() => setOjOpen((v) => !v)}
          trailing={
            <Inline gap={2} wrap>
              {(["tuoj", "tuojClassic", "tyche", "dsa"] as const).map((id) => (
                <Tag key={id} tone={configured[id] ? "success" : undefined}>
                  {SOURCE_NAMES[id]} {configured[id] ? "✅" : "未登录"}
                </Tag>
              ))}
              <OGText slot="label" tone="faint">{ojOpen ? "点击收起" : "点击展开登录"}</OGText>
            </Inline>
          }
        >        {msg && msgArea === "oj" ? (
          <div role="status"><OGText as="div" slot="label" tone="faint">{msg}</OGText></div>
        ) : null}
        <div className="exthw-oj-body">
            {/* TUOJ（AI 版）：主路径 = 清华统一认证漫游；账号密码收进「更多」 */}
            <OjSourceRow
              name={SOURCE_NAMES.tuoj}
              logged={configured.tuoj}
              via={
                tuojVia === "cas" || ext.tuojAuto.tuoj.kind === "ok"
                  ? "统一认证"
                  : tuojVia === "password"
                    ? "账号密码"
                    : undefined
              }
              primary={
                configured.tuoj ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("tuoj")}>{busy === "logout-tuoj" ? "退出中…" : "退出"}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => onTuojCasLogin("tuoj")}>{busy === "tuoj-cas-tuoj" ? "登录中…" : "统一认证登录"}</Btn>
                )
              }
              more={
                <Btn variant="ghost" onClick={() => setTuojPwdOpen((v) => !v)}>{tuojPwdOpen ? "▾" : "▸"}{i18n("auto.components.ExtHwSettingsSection.14")}</Btn>
              }
              note={tuojNote("tuoj")}
            >
              {tuojPwdOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input placeholder={i18n("auto.components.ExtHwSettingsSection.15")} value={tuojUser} onChange={(value) => setTuojUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("auto.components.ExtHwSettingsSection.16")} value={tuojPwd} onChange={(value) => setTuojPwd(value)} />}</div>
                    <Btn variant="outline" disabled={busy !== null || !tuojUser.trim() || !tuojPwd} onClick={() => onTuojPwdLogin("tuoj")}>{busy === "tuoj-pwd-tuoj" ? "登录中…" : "登录"}</Btn>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>

            {/* TUOJ（经典版）：同 AI 版范式，仅 base 不同 */}
            <OjSourceRow
              name={SOURCE_NAMES.tuojClassic}
              logged={configured.tuojClassic}
              via={
                classicVia === "cas" || ext.tuojAuto.tuojClassic.kind === "ok"
                  ? "统一认证"
                  : classicVia === "password"
                    ? "账号密码"
                    : undefined
              }
              primary={
                configured.tuojClassic ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("tuojClassic")}>{busy === "logout-tuojClassic" ? "退出中…" : "退出"}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => onTuojCasLogin("tuojClassic")}>{busy === "tuoj-cas-tuojClassic" ? "登录中…" : "统一认证登录"}</Btn>
                )
              }
              more={
                <Btn variant="ghost" onClick={() => setClassicPwdOpen((v) => !v)}>{classicPwdOpen ? "▾" : "▸"}{i18n("auto.components.ExtHwSettingsSection.14")}</Btn>
              }
              note={tuojNote("tuojClassic")}
            >
              {classicPwdOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input placeholder={i18n("auto.components.ExtHwSettingsSection.15")} value={classicUser} onChange={(value) => setClassicUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("auto.components.ExtHwSettingsSection.16")} value={classicPwd} onChange={(value) => setClassicPwd(value)} />}</div>
                    <Btn variant="outline" disabled={busy !== null || !classicUser.trim() || !classicPwd} onClick={() => onTuojPwdLogin("tuojClassic")}>{busy === "tuoj-pwd-tuojClassic" ? "登录中…" : "登录"}</Btn>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>

            {/* Tyche：用户名 + 密码（校内或 sslvpn）；R21-A 支持记住密码 + 会话失效静默自动重登 */}
            <OjSourceRow
              name={SOURCE_NAMES.tyche}
              logged={configured.tyche}
              primary={
                configured.tyche ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("tyche")}>{busy === "logout-tyche" ? "退出中…" : "退出"}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => setTycheFormOpen((v) => !v)}>{tycheFormOpen ? "收起" : "登录"}</Btn>
                )
              }
              more={
                configured.tyche ? (
                  <Btn variant="ghost" onClick={() => setTycheFormOpen((v) => !v)}>{tycheFormOpen ? "▾" : "▸"}{i18n("auto.components.ExtHwSettingsSection.17")}</Btn>
                ) : undefined
              }
              note={
                ext.errors.tyche ? (
                  <OGText as="div" slot="label" tone="error">{ext.errors.tyche}</OGText>
                ) : tycheRemember && configured.tyche ? (
                  <OGText as="div" slot="label" tone="faint">{i18n("auto.components.ExtHwSettingsSection.18")}</OGText>
                ) : undefined
              }
            >
              {tycheFormOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input placeholder={i18n("auto.components.ExtHwSettingsSection.15")} value={tycheUser} onChange={(value) => setTycheUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("auto.components.ExtHwSettingsSection.16")} value={tychePwd} onChange={(value) => setTychePwd(value)} />}</div>
                    <Btn variant="solid" tone="brand" disabled={busy !== null || !tycheUser.trim() || !tychePwd} onClick={onTycheLogin}>{busy === "tyche-login" ? "登录中…" : "登录"}</Btn>
                  </div>
                  {/* R21-A：记住密码 → 会话失效时用存档账密静默自动重登一次（同源 ≥10min、每进程 ≤3 次） */}
                  <Checkbox checked={tycheRemember} onChange={(v) => setTycheRemember(v)} label={i18n("auto.components.ExtHwSettingsSection.19")} />
                  <OGText as="div" slot="label" tone="faint">
                    {tycheRemember
                      ? "密码以密文存在本机，不上传、不进日志；退出登录即清除。"
                      : "不勾选则只保存本次登录状态，失效后需手动重新登录。"}
                  </OGText>
                </div>
              ) : null}
            </OjSourceRow>

            {/* DSA OJ：邮箱 + 密码（无统一认证） */}
            <OjSourceRow
              name={SOURCE_NAMES.dsa}
              logged={configured.dsa}
              primary={
                configured.dsa ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("dsa")}>{busy === "logout-dsa" ? "退出中…" : "退出"}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => setDsaFormOpen((v) => !v)}>{dsaFormOpen ? "收起" : "登录"}</Btn>
                )
              }
              more={
                configured.dsa ? (
                  <Btn variant="ghost" onClick={() => setDsaFormOpen((v) => !v)}>{dsaFormOpen ? "▾" : "▸"}{i18n("auto.components.ExtHwSettingsSection.17")}</Btn>
                ) : undefined
              }
              note={ext.errors.dsa ? <OGText as="div" slot="label" tone="error">{ext.errors.dsa}</OGText> : undefined}
            >
              {dsaFormOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="email" placeholder={i18n("auto.components.ExtHwSettingsSection.20")} value={dsaUser} onChange={(value) => setDsaUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("auto.components.ExtHwSettingsSection.16")} value={dsaPwd} onChange={(value) => setDsaPwd(value)} />}</div>
                    <Btn variant="solid" tone="brand" disabled={busy !== null || !dsaUser.trim() || !dsaPwd} onClick={onDsaLogin}>{busy === "dsa-login" ? "登录中…" : "登录"}</Btn>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>
          </div>
        </AccordionItem>
      </Card>

      {/* ── 共用：抓取范围 / 保存 / 刷新 / 高级（对所有源生效）── */}
      <div style={{ marginTop: 18 }}>
        <Card>
        <div>
          <OGText weight="semibold">{i18n("auto.components.ExtHwSettingsSection.21")}</OGText>
          <OGText as="div" slot="label" tone="faint">{i18n("auto.components.ExtHwSettingsSection.22")}</OGText>

            <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <OGText weight="medium">{i18n("auto.components.ExtHwSettingsSection.23")}</OGText>
                <Input inputMode="numeric" value={days} onChange={(value) => setDays(value.replace(/[^0-9]/g, ""))} />
                <OGText slot="label" tone="faint">{i18n("auto.components.ExtHwSettingsSection.24")}</OGText>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="solid" tone="brand" onClick={onSave}>{i18n("auto.components.ExtHwSettingsSection.25")}</Btn>
                <Btn variant="outline" disabled={busy !== null || ext.state === "loading"} onClick={onRefresh}>{busy === "refresh" || ext.state === "loading" ? "刷新中…" : "立即刷新"}</Btn>
              </div>

              {/* 高级：手动粘贴浏览器登录信息（一般用户用不到） */}
              <div>
                <Btn variant="ghost" onClick={() => setAdvanced((v) => !v)}>{advanced ? "▾" : "▸"}{i18n("auto.components.ExtHwSettingsSection.26")}</Btn>
                {advanced ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                    <TextArea mono placeholder={i18n("auto.components.ExtHwSettingsSection.27")} value={yktCookie} onChange={(value) => setYktCookie(value)} />
                    <TextArea mono placeholder={i18n("auto.components.ExtHwSettingsSection.28")} value={tuojCookie} onChange={(value) => setTuojCookie(value)} />
                    <TextArea mono placeholder={i18n("auto.components.ExtHwSettingsSection.29")} value={classicCookie} onChange={(value) => setClassicCookie(value)} />
                    <TextArea mono placeholder="Tyche Cookie（JSESSIONID / username / uid）" value={tycheCookie} onChange={(value) => setTycheCookie(value)} />
                    <TextArea mono placeholder="DSA OJ Cookie（PHPSESSID …）" value={dsaCookie} onChange={(value) => setDsaCookie(value)} />
                    <OGText as="div" slot="label" tone="faint">{i18n("auto.components.ExtHwSettingsSection.30")}</OGText>
                  </div>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                {srcRows.map(({ id, label, logged }) => {
                  const count = ext.items.filter((it) => it.source === id).length;
                  const err = ext.errors[id];
                  return (
                    <OGText as="div" key={id}>
                      {label}：{logged ? "已登录" : "未登录"} ·{" "}
                      {err ? <OGText tone="error">{i18n("auto.components.ExtHwSettingsSection.31")}</OGText> : `${count} 条`}
                    </OGText>
                  );
                })}
                {msg && msgArea === "range" ? (
                  <div role="status"><OGText as="div">{msg}</OGText></div>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
