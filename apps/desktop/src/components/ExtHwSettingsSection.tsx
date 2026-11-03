import { labelForId } from "../i18n/staticLabels.js";
import { getLocale as getUiLocale } from "../i18n/index.js";
import { t as i18n, msg as i18nMsg, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
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
  getExtHwCreds,
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
  const uiLocale = useUiLocale();

  return (
    <div className="exthw-src">
      <div className="exthw-src-head">
        <OGText weight="semibold" nowrap={false}>{name}</OGText>
        <Tag tone={logged ? "success" : undefined}>{logged ? i18n("components.exthwsettingssection.32eed2adc456", { value: String(via ? `·${via}` : "") }) : i18n("components.exthwsettingssection.c1f658373079")}</Tag>
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
  const uiLocale = useUiLocale();

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
      yktUserId?: string;
      yktAuth?: string;
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
    // 扫描登录返回的 UserID/Auth 要随 Cookie 一起保存；手工改 Cookie 时沿用已保存的换票凭据。
    const existingYkt = getExtHwCreds().yuketang;
    const yktUserId = o.yktUserId ?? existingYkt?.userId;
    const yktAuth = o.yktAuth ?? existingYkt?.auth;
    return {
      yuketang: yk
        ? {
            cookie: yk,
            phone: yktPhone.trim() || undefined,
            ...(yktUserId ? { userId: yktUserId } : {}),
            ...(yktAuth ? { auth: yktAuth } : {}),
          }
        : undefined,
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
    void saveExtHwCreds(credsWith()).then(() => notify("range", i18n("components.exthwsettingssection.e4c4cca922f3")));
  };

  const onRefresh = () => {
    setBusy("refresh");
    setMsg(null);
    void saveExtHwCreds(credsWith())
      .then(() => refreshExtHw())
      .then(() => notify("range", i18n("components.exthwsettingssection.0cfeab7fbfd6")))
      .catch((e: unknown) => notify("range", i18n("components.exthwsettingssection.434a1a95686a", { value: String(errMsg(e)) })))
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
          notify("yuketang", i18n("components.exthwsettingssection.738b37dc7cba"));
          return;
        }
        if (st.alive === true) notify("yuketang", i18n("components.exthwsettingssection.ee5c26c496a4", { value: String(st.userName ? `（${st.userName}）` : "") }));
        else if (st.alive === false) notify("yuketang", i18n("components.exthwsettingssection.1f2ada659e8f", { value: String(st.reason ?? i18n("components.exthwsettingssection.a1a9da9ee6ed")) }));
        else notify("yuketang", i18n("components.exthwsettingssection.52ca90b5c7ad"));
      })
      .finally(() => setBusy(null));
  };

  /** 导出雨课堂 Cookie：文件即完整登录凭据（自带 sensitive 标注），仅存本机自选位置 */
  const onYktExportCookie = () => {
    setBusy("ykt-export");
    setMsg(null);
    void (async (): Promise<string> => {
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error(i18n("components.exthwsettingssection.7cf1f3f97fff"));
      }
      const c = await ensureExtHwCredsLoaded();
      if (!c.yuketang?.cookie?.trim()) throw new Error(i18n("components.exthwsettingssection.e980b77af601"));
      const json = buildYktCookieExportJson(c.yuketang);
      const { invoke } = await import("@tauri-apps/api/core");
      const date = new Date().toISOString().slice(0, 10);
      const path = await invoke<string | null>("save_text_file", {
        filename: `onethu-yuketang-cookie-${date}.json`,
        contents: json,
      });
      if (!path) return i18n("components.exthwsettingssection.84880323c334");
      return i18n("components.exthwsettingssection.59e30b592976", { path: String(path) });
    })()
      .then((m) => notify("yuketang", m))
      .catch((e: unknown) => notify("yuketang", i18n("components.exthwsettingssection.177a41a28139", { value: String(errMsg(e)) })))
      .finally(() => setBusy(null));
  };

  /** 导入另一台设备导出的 Cookie（免重新扫码）；导入后立即刷新外部作业 */
  const onYktImportCookie = () => {
    setBusy("ykt-import");
    setMsg(null);
    void (async (): Promise<string> => {
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error(i18n("components.exthwsettingssection.ec3a87632682"));
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const sel = await open({ multiple: false, filters: [{ name: i18n("components.exthwsettingssection.1c907131183c"), extensions: ["json"] }] });
      if (!sel || typeof sel !== "string") return i18n("components.exthwsettingssection.ae79f5df3c38");
      const text = await invoke<string>("read_file_text", { path: sel });
      const parsed = parseYktCookieExportJson(text);
      const cur = await ensureExtHwCredsLoaded();
      await saveExtHwCreds({
        ...cur,
        yuketang: {
          cookie: parsed.cookie,
          uvId: parsed.uvId ?? cur.yuketang?.uvId,
          phone: parsed.phone ?? cur.yuketang?.phone,
          ...(parsed.userId ? { userId: parsed.userId } : {}),
          ...(parsed.auth ? { auth: parsed.auth } : {}),
        },
      });
      setYktCookie(parsed.cookie);
      if (parsed.phone) setYktPhone(parsed.phone);
      void refreshExtHw();
      return i18n("components.exthwsettingssection.6ac888d9d8a4");
    })()
      .then((m) => notify("yuketang", m))
      .catch((e: unknown) => notify("yuketang", i18n("components.exthwsettingssection.7a334a5f33f2", { value: String(errMsg(e)) })))
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
        notify("oj", i18n("components.exthwsettingssection.0046b5364303", { value: String(labelForId(SOURCE_NAMES[source])) }));
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", i18n("components.exthwsettingssection.a33c8a6739b3", { value: String(labelForId(SOURCE_NAMES[source])), value2: String(errMsg(e)) })))
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
        notify("oj", i18n("components.exthwsettingssection.81c77d061430", { value: String(labelForId(SOURCE_NAMES[source])) }));
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", i18n("components.exthwsettingssection.a33c8a6739b3", { value: String(labelForId(SOURCE_NAMES[source])), value2: String(errMsg(e)) })))
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
        notify("oj", tycheRemember ? i18n("components.exthwsettingssection.e9da66a5f095") : i18n("components.exthwsettingssection.30060dffb676"));
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", i18n("components.exthwsettingssection.94cd45f219ce", { value: String(errMsg(e)) })))
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
        notify("oj", i18n("components.exthwsettingssection.c5f1befc6cc9"));
        void refreshExtHw();
      })
      .catch((e: unknown) => notify("oj", i18n("components.exthwsettingssection.8da916259f48", { value: String(errMsg(e)) })))
      .finally(() => setBusy(null));
  };

  /** R12 17.2：单源退出登录 —— 确认后只清该源凭据，不影响其他源 */
  const onLogout = (source: ExtHwSourceId) => {
    const label = labelForId(SOURCE_NAMES[source]);
    void confirmOk(i18nMsg("components.exthwsettingssection.9332d0724ed2", { label: String(label), label2: String(label) })).then(
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
          notify(source === "yuketang" ? "yuketang" : "oj", i18n("components.exthwsettingssection.5fd4a0702e98", { label: String(label) }));
          void refreshExtHw();
        } catch (e: unknown) {
          notify(source === "yuketang" ? "yuketang" : "oj", i18n("components.exthwsettingssection.b666588e7bed", { label: String(label), value: String(errMsg(e)) }));
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
          <OGText as="div" slot="label" tone="warning">{i18nRich("components.exthwsettingssection.65493396ab5b", { value: st.message ? `（${st.message.slice(0, 160)}）` : "" })}</OGText>
        ) : null}
        {st.kind === "no-courses" ? (
          <OGText as="div" slot="label" tone="faint">{i18n("components.exthwsettingssection.f81d3377be28")}</OGText>
        ) : null}
      </>
    );
  };
  const fieldStyle = { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } as const;
  const srcRows: Array<{ id: ExtHwSourceId; label: string; logged: boolean }> = (
    ["yuketang", "tuoj", "tuojClassic", "tyche", "dsa"] as const
  ).map((id) => ({ id, label: labelForId(SOURCE_NAMES[id]), logged: configured[id] }));

  return (
    <div id="settings-exthw">
      <OGText as="div" slot="label" tone="faint">{i18n("components.exthwsettingssection.e9acc8eb6b0c")}</OGText>

      {/* ── R14 19.1 / R15 20.3：雨课堂独立 Card，统一行范式 ── */}
      <SectionHead title={labelForId(SOURCE_CATEGORY_NAMES.courseware)} />
      <Card>
        <div className="exthw-src">
          <div className="exthw-src-head">
            <OGText weight="semibold">{i18n("components.exthwsettingssection.38b9eabcae1b")}</OGText>
            <Tag tone={configured.yuketang ? "success" : undefined}>
              {configured.yuketang ? i18n("components.exthwsettingssection.0a01eee1cd37") : i18n("components.exthwsettingssection.c1f658373079")}
            </Tag>
            <span className="exthw-src-actions">
              {configured.yuketang ? (
                <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("yuketang")}>{busy === "logout-yuketang" ? i18n("components.exthwsettingssection.4803e2da0873") : i18n("components.exthwsettingssection.498e1d59b4d7")}</Btn>
              ) : (
                <>
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => {
                      setYktWebOpen(false);
                      setYktQrOpen((v) => !v);
                    }}>{yktQrOpen ? i18n("components.exthwsettingssection.dd647f03c880") : i18n("components.exthwsettingssection.9e0181f35fc5")}</Btn>
                  {/* R18 24.2：官方网页登录通道（应用内 WebView，支持扫码 / 短信）
                      R18b 25.3.2：桌面端原生窗口实测白屏卡死 → 隐藏该入口（二维码可用），仅 Android 保留 */}
                  {YKT_WEB_LOGIN_AVAILABLE ? (
                    <Btn variant="outline" disabled={busy !== null} titleAttr={i18n("components.exthwsettingssection.04bc193e4244")} onClick={() => {
                        setYktQrOpen(false);
                        setYktWebOpen((v) => !v);
                      }}>{yktWebOpen ? i18n("components.exthwsettingssection.f3553abadd4a") : i18n("components.exthwsettingssection.0a5f3151f8a9")}</Btn>
                  ) : null}
                </>
              )}
              <Btn variant="ghost" disabled titleAttr={i18n("components.exthwsettingssection.e1d7e2b94ecd")}>{i18n("components.exthwsettingssection.8230bba29c97")}</Btn>
            </span>
          </div>
          {/* R17 23.2：官方登录页发短信前先取图形验证码（TencentCaptcha/hCaptcha），
              纯接口无法内嵌 → 直接短信通道停用；R18 24.2 起可在「官方网页登录」
              应用内网页里正常使用短信（图形验证码由官方页自己完成）。
              R18b 25.3.2：桌面端该入口隐藏，文案不再引导到它。 */}
          <OGText as="div" slot="label" tone="faint">
            {YKT_WEB_LOGIN_AVAILABLE
              ? i18n("components.exthwsettingssection.5492e8498b9c")
              : i18n("components.exthwsettingssection.9249fcc53449")}
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
                  ? i18n("components.exthwsettingssection.27e7d6344316")
                  : ext.yktSession.alive === true
                    ? i18n("components.exthwsettingssection.8b512420e036", { value: String(ext.yktSession.userName ? `（${ext.yktSession.userName}）` : ""), value2: String(new Date(ext.yktSession.checkedAt).toLocaleTimeString(getUiLocale())) })
                    : ext.yktSession.alive === false
                      ? i18n("components.exthwsettingssection.d2c8f261037f", { reason: String(ext.yktSession.reason), value: String(new Date(ext.yktSession.checkedAt).toLocaleTimeString(getUiLocale())) })
                      : i18n("components.exthwsettingssection.4acec185ba86")}
              </OGText>
              <div style={fieldStyle}>
                <Btn variant="outline" disabled={busy !== null} onClick={onYktCheckSession}>{busy === "ykt-check" ? i18n("components.exthwsettingssection.fb11aa6f2982") : i18n("components.exthwsettingssection.8a21d7219a96")}</Btn>
                <Btn variant="outline" disabled={busy !== null} titleAttr={i18n("components.exthwsettingssection.fb4017d5b95f")} onClick={onYktExportCookie}>{busy === "ykt-export" ? i18n("components.exthwsettingssection.dce6e572314e") : i18n("components.exthwsettingssection.11968ab19a8b")}</Btn>
                <Btn variant="outline" disabled={busy !== null} titleAttr={i18n("components.exthwsettingssection.4ba279389d5a")} onClick={onYktImportCookie}>{busy === "ykt-import" ? i18n("components.exthwsettingssection.2f58b6eddc08") : i18n("components.exthwsettingssection.103d97629702")}</Btn>
              </div>
              {ext.yktSession.alive === false ? (
                <OGText as="div" slot="label" tone="error">{i18n("components.exthwsettingssection.c0102ddf9ffc")}<div style={{ marginTop: 6 }}>
                    <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => {
                        setYktWebOpen(false);
                        setYktQrOpen(true);
                      }}>{i18n("components.exthwsettingssection.da57a53a43da")}</Btn>
                  </div>
                </OGText>
              ) : null}
            </>
          ) : null}
          {yktQrOpen ? (
            <YktQrPanel
              onCancel={() => setYktQrOpen(false)}
              onSuccess={(credential) => {
                setYktCookie(credential.cookie);
                setYktQrOpen(false);
                void saveExtHwCreds(
                  credsWith({ ykt: credential.cookie, yktUserId: credential.userId, yktAuth: credential.auth }),
                ).then(() => {
                  notify("yuketang", i18n("components.exthwsettingssection.a61cd4faa5ed"));
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
                  notify("yuketang", i18n("components.exthwsettingssection.ecc6fb1d43a1"));
                  void refreshExtHw();
                });
              }}
            />
          ) : null}
        </div>
      </Card>

      {/* ── R14 19.2 / R15 20.3：OJ 平台组默认折叠，标题行常显 4 源接入状态 ── */}
      <SectionHead title={labelForId(SOURCE_CATEGORY_NAMES.oj)} aside={i18n("components.exthwsettingssection.44ff02182964")} />
      <Card>
        <AccordionItem
          id="oj"
          title={i18n("components.exthwsettingssection.07a0f114d30b")}
          open={ojOpen}
          onToggle={() => setOjOpen((v) => !v)}
          trailing={
            <Inline gap={2} wrap>
              {(["tuoj", "tuojClassic", "tyche", "dsa"] as const).map((id) => (
                <Tag key={id} tone={configured[id] ? "success" : undefined}>
                  {labelForId(SOURCE_NAMES[id])} {configured[id] ? "✅" : i18n("components.exthwsettingssection.c1f658373079")}
                </Tag>
              ))}
              <OGText slot="label" tone="faint">{ojOpen ? i18n("components.exthwsettingssection.3afccd0197f6") : i18n("components.exthwsettingssection.3e7440664c75")}</OGText>
            </Inline>
          }
        >        {msg && msgArea === "oj" ? (
          <div role="status"><OGText as="div" slot="label" tone="faint">{msg}</OGText></div>
        ) : null}
        <div className="exthw-oj-body">
            {/* TUOJ（AI 版）：主路径 = 清华统一认证漫游；账号密码收进「更多」 */}
            <OjSourceRow
              name={labelForId(SOURCE_NAMES.tuoj)}
              logged={configured.tuoj}
              via={
                tuojVia === "cas" || ext.tuojAuto.tuoj.kind === "ok"
                  ? i18n("components.exthwsettingssection.99e398c6de5c")
                  : tuojVia === "password"
                    ? i18n("components.exthwsettingssection.164c7afc6158")
                    : undefined
              }
              primary={
                configured.tuoj ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("tuoj")}>{busy === "logout-tuoj" ? i18n("components.exthwsettingssection.4803e2da0873") : i18n("components.exthwsettingssection.498e1d59b4d7")}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => onTuojCasLogin("tuoj")}>{busy === "tuoj-cas-tuoj" ? i18n("components.exthwsettingssection.3f06ed8f8c38") : i18n("components.exthwsettingssection.7c1c6d7e68c6")}</Btn>
                )
              }
              more={
                <Btn variant="ghost" onClick={() => setTuojPwdOpen((v) => !v)}>{i18nRich("components.exthwsettingssection.b9e0b1e6f221", { value: tuojPwdOpen ? "▾" : "▸" })}</Btn>
              }
              note={tuojNote("tuoj")}
            >
              {tuojPwdOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input placeholder={i18n("components.exthwsettingssection.1a3f0617d6de")} value={tuojUser} onChange={(value) => setTuojUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("components.exthwsettingssection.a621ab606db2")} value={tuojPwd} onChange={(value) => setTuojPwd(value)} />}</div>
                    <Btn variant="outline" disabled={busy !== null || !tuojUser.trim() || !tuojPwd} onClick={() => onTuojPwdLogin("tuoj")}>{busy === "tuoj-pwd-tuoj" ? i18n("components.exthwsettingssection.3f06ed8f8c38") : i18n("components.exthwsettingssection.1e2df9c3075a")}</Btn>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>

            {/* TUOJ（经典版）：同 AI 版范式，仅 base 不同 */}
            <OjSourceRow
              name={labelForId(SOURCE_NAMES.tuojClassic)}
              logged={configured.tuojClassic}
              via={
                classicVia === "cas" || ext.tuojAuto.tuojClassic.kind === "ok"
                  ? i18n("components.exthwsettingssection.99e398c6de5c")
                  : classicVia === "password"
                    ? i18n("components.exthwsettingssection.164c7afc6158")
                    : undefined
              }
              primary={
                configured.tuojClassic ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("tuojClassic")}>{busy === "logout-tuojClassic" ? i18n("components.exthwsettingssection.4803e2da0873") : i18n("components.exthwsettingssection.498e1d59b4d7")}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => onTuojCasLogin("tuojClassic")}>{busy === "tuoj-cas-tuojClassic" ? i18n("components.exthwsettingssection.3f06ed8f8c38") : i18n("components.exthwsettingssection.7c1c6d7e68c6")}</Btn>
                )
              }
              more={
                <Btn variant="ghost" onClick={() => setClassicPwdOpen((v) => !v)}>{i18nRich("components.exthwsettingssection.b9e0b1e6f221", { value: classicPwdOpen ? "▾" : "▸" })}</Btn>
              }
              note={tuojNote("tuojClassic")}
            >
              {classicPwdOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input placeholder={i18n("components.exthwsettingssection.1a3f0617d6de")} value={classicUser} onChange={(value) => setClassicUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("components.exthwsettingssection.a621ab606db2")} value={classicPwd} onChange={(value) => setClassicPwd(value)} />}</div>
                    <Btn variant="outline" disabled={busy !== null || !classicUser.trim() || !classicPwd} onClick={() => onTuojPwdLogin("tuojClassic")}>{busy === "tuoj-pwd-tuojClassic" ? i18n("components.exthwsettingssection.3f06ed8f8c38") : i18n("components.exthwsettingssection.1e2df9c3075a")}</Btn>
                  </div>
                </div>
              ) : null}
            </OjSourceRow>

            {/* Tyche：用户名 + 密码（校内或 sslvpn）；R21-A 支持记住密码 + 会话失效静默自动重登 */}
            <OjSourceRow
              name={labelForId(SOURCE_NAMES.tyche)}
              logged={configured.tyche}
              primary={
                configured.tyche ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("tyche")}>{busy === "logout-tyche" ? i18n("components.exthwsettingssection.4803e2da0873") : i18n("components.exthwsettingssection.498e1d59b4d7")}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => setTycheFormOpen((v) => !v)}>{tycheFormOpen ? i18n("components.exthwsettingssection.afd4b783536b") : i18n("components.exthwsettingssection.1e2df9c3075a")}</Btn>
                )
              }
              more={
                configured.tyche ? (
                  <Btn variant="ghost" onClick={() => setTycheFormOpen((v) => !v)}>{i18nRich("components.exthwsettingssection.97434a01ddf6", { value: tycheFormOpen ? "▾" : "▸" })}</Btn>
                ) : undefined
              }
              note={
                ext.errors.tyche ? (
                  <OGText as="div" slot="label" tone="error">{ext.errors.tyche}</OGText>
                ) : tycheRemember && configured.tyche ? (
                  <OGText as="div" slot="label" tone="faint">{i18n("components.exthwsettingssection.e32ac47f5825")}</OGText>
                ) : undefined
              }
            >
              {tycheFormOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input placeholder={i18n("components.exthwsettingssection.1a3f0617d6de")} value={tycheUser} onChange={(value) => setTycheUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("components.exthwsettingssection.a621ab606db2")} value={tychePwd} onChange={(value) => setTychePwd(value)} />}</div>
                    <Btn variant="solid" tone="brand" disabled={busy !== null || !tycheUser.trim() || !tychePwd} onClick={onTycheLogin}>{busy === "tyche-login" ? i18n("components.exthwsettingssection.3f06ed8f8c38") : i18n("components.exthwsettingssection.1e2df9c3075a")}</Btn>
                  </div>
                  {/* R21-A：记住密码 → 会话失效时用存档账密静默自动重登一次（同源 ≥10min、每进程 ≤3 次） */}
                  <Checkbox checked={tycheRemember} onChange={(v) => setTycheRemember(v)} label={i18n("components.exthwsettingssection.5510d7040d50")} />
                  <OGText as="div" slot="label" tone="faint">
                    {tycheRemember
                      ? i18n("components.exthwsettingssection.aaa8da9598f1")
                      : i18n("components.exthwsettingssection.40c00674621e")}
                  </OGText>
                </div>
              ) : null}
            </OjSourceRow>

            {/* DSA OJ：邮箱 + 密码（无统一认证） */}
            <OjSourceRow
              name={labelForId(SOURCE_NAMES.dsa)}
              logged={configured.dsa}
              primary={
                configured.dsa ? (
                  <Btn variant="outline" disabled={busy !== null} onClick={() => onLogout("dsa")}>{busy === "logout-dsa" ? i18n("components.exthwsettingssection.4803e2da0873") : i18n("components.exthwsettingssection.498e1d59b4d7")}</Btn>
                ) : (
                  <Btn variant="solid" tone="brand" disabled={busy !== null} onClick={() => setDsaFormOpen((v) => !v)}>{dsaFormOpen ? i18n("components.exthwsettingssection.afd4b783536b") : i18n("components.exthwsettingssection.1e2df9c3075a")}</Btn>
                )
              }
              more={
                configured.dsa ? (
                  <Btn variant="ghost" onClick={() => setDsaFormOpen((v) => !v)}>{i18nRich("components.exthwsettingssection.97434a01ddf6", { value: dsaFormOpen ? "▾" : "▸" })}</Btn>
                ) : undefined
              }
              note={ext.errors.dsa ? <OGText as="div" slot="label" tone="error">{ext.errors.dsa}</OGText> : undefined}
            >
              {dsaFormOpen ? (
                <div className="exthw-src-body">
                  <div style={fieldStyle}>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="email" placeholder={i18n("components.exthwsettingssection.73075237fd0f")} value={dsaUser} onChange={(value) => setDsaUser(value.trim())} />}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>{<Input type="password" placeholder={i18n("components.exthwsettingssection.a621ab606db2")} value={dsaPwd} onChange={(value) => setDsaPwd(value)} />}</div>
                    <Btn variant="solid" tone="brand" disabled={busy !== null || !dsaUser.trim() || !dsaPwd} onClick={onDsaLogin}>{busy === "dsa-login" ? i18n("components.exthwsettingssection.3f06ed8f8c38") : i18n("components.exthwsettingssection.1e2df9c3075a")}</Btn>
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
          <OGText weight="semibold">{i18n("components.exthwsettingssection.c1547f6ba316")}</OGText>
          <OGText as="div" slot="label" tone="faint">{i18n("components.exthwsettingssection.cd2e0ccbc607")}</OGText>

            <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <OGText weight="medium">{i18n("components.exthwsettingssection.58d2b2a8dc03")}</OGText>
                <Input inputMode="numeric" value={days} onChange={(value) => setDays(value.replace(/[^0-9]/g, ""))} />
                <OGText slot="label" tone="faint">{i18n("components.exthwsettingssection.f8f540b20b2a")}</OGText>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="solid" tone="brand" onClick={onSave}>{i18n("components.exthwsettingssection.a3030bf8f16d")}</Btn>
                <Btn variant="outline" disabled={busy !== null || ext.state === "loading"} onClick={onRefresh}>{busy === "refresh" || ext.state === "loading" ? i18n("components.exthwsettingssection.7f3c8312816f") : i18n("components.exthwsettingssection.130123e01753")}</Btn>
              </div>

              {/* 高级：手动粘贴浏览器登录信息（一般用户用不到） */}
              <div>
                <Btn variant="ghost" onClick={() => setAdvanced((v) => !v)}>{i18nRich("components.exthwsettingssection.abf483faf3b6", { value: advanced ? "▾" : "▸" })}</Btn>
                {advanced ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                    <TextArea mono placeholder={i18n("components.exthwsettingssection.1c907131183c")} value={yktCookie} onChange={(value) => setYktCookie(value)} />
                    <TextArea mono placeholder={i18n("components.exthwsettingssection.6c0cdf48d1b3")} value={tuojCookie} onChange={(value) => setTuojCookie(value)} />
                    <TextArea mono placeholder={i18n("components.exthwsettingssection.d066ae4f03e8")} value={classicCookie} onChange={(value) => setClassicCookie(value)} />
                    <TextArea mono placeholder="Tyche Cookie（JSESSIONID / username / uid）" value={tycheCookie} onChange={(value) => setTycheCookie(value)} />
                    <TextArea mono placeholder="DSA OJ Cookie（PHPSESSID …）" value={dsaCookie} onChange={(value) => setDsaCookie(value)} />
                    <OGText as="div" slot="label" tone="faint">{i18n("components.exthwsettingssection.498e524101ad")}</OGText>
                  </div>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                {srcRows.map(({ id, label, logged }) => {
                  const count = ext.items.filter((it) => it.source === id).length;
                  const err = ext.errors[id];
                  return (
                    <OGText as="div" key={id}>
                      {label}：{logged ? i18n("components.exthwsettingssection.0a01eee1cd37") : i18n("components.exthwsettingssection.c1f658373079")} ·{" "}
                      {err ? <OGText tone="error">{i18n("components.exthwsettingssection.8aee3f656a95")}</OGText> : i18n("components.exthwsettingssection.92559c8f277f", { count: String(count) })}
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
