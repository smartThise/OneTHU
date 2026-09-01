/**
 * 体育场馆预约（体育系统 sports.tsinghua.edu.cn 全套移植 · 除支付）。
 *
 * 数据源 = unifound-venue 直连接口（packages/core/src/venue，签名/端点/字段
 * 对齐 2026-08-31 抓包），替代原 info-app webvpn 版（SportsTab，从未可用）。
 *
 * 流程（对齐原 SPA 预约页）：
 * ① 授权：无 token → 授权卡（webview 打开体育系统完成 CAS 登录，token 自动回传）
 * ② 场馆 chips（scene/list 33 项，会话级缓存）+ 日期
 * ③ 场地×场次表（current/page：时段/余量/价格/预约状态内嵌 sessionVo）
 * ④ 选中场次 → 预约卡 → 提交（addReserve；支付流不接：付费场次引导网页端）
 * ⑤ 我的预约记录（reserveRecord）+ 退订（cancelReserve，confirm 确认）
 *
 * 错误铁律（与其它 tab 同源）：
 * - 1130002/登录过期 → VenueAuthRequiredError → 回授权卡（绝不自动刷新循环）
 * - 网络/HTTP 错误 → 服务暂不可用 + 重试；业务错误 → 服务端原文
 * - 空数据 ≠ 错误：「暂无可预约场次」
 */
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  fmtVenueDate,
  VenueApiError,
  VenueAuthRequiredError,
  type VenueRecord,
  type VenueScene,
  type VenueSession,
  type VenueSite,
  type VenueUser,
} from "@onethu/core";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";

/** 北京时间当前分钟数（0-1439） */
function beijingMinute(): number {
  const d = new Date();
  const bj = new Date(d.getTime() + (480 + d.getTimezoneOffset()) * 60000);
  return bj.getHours() * 60 + bj.getMinutes();
}

/** 维护期友好卡：窗口内（00:55-02:05）不轰炸——单次定时到窗口结束重试一次；窗口外按 60s 自动重试 */
function VenueNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const maintain = /维护中/.test(text);
  const inWindow = maintain && (() => { const m = beijingMinute(); return m >= 55 || m <= 125; })();
  const [left, setLeft] = useState(60);
  useEffect(() => {
    if (!maintain || inWindow) return;
    setLeft(60);
    const t = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          clearInterval(t);
          onRetry?.();
          return 60;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [maintain, inWindow, onRetry]);
  useEffect(() => {
    if (!inWindow) return;
    // 距窗口结束（02:05）的秒数，到点重试一次，不再循环
    const m = beijingMinute();
    const sec = m >= 55 ? (24 * 60 - m + 125) * 60 : (125 - m) * 60;
    const t = setTimeout(() => onRetry?.(), Math.max(sec, 30) * 1000);
    return () => clearTimeout(t);
  }, [inWindow, onRetry]);
  if (!maintain) return <ErrorNote text={text} onRetry={onRetry} />;
  return (
    <div className="card" style={{ textAlign: "center", padding: "18px 12px" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>场馆系统维护中</div>
      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
        {inWindow
          ? "每日 01:00 - 02:00 例行维护，窗口结束后自动恢复"
          : <>非维护时段出现维护提示（异常），{left}s 后自动重试</>}
      </div>
    </div>
  );
}
import { VenueTwoFactorRequired, venueClient, venueHasToken, venueLogout, venueScenes, venueLogin, venueSilentLogin, venueSubmit2FA, venueSend2FACode } from "../../lib/venue.js";
import type { TwoFactorMethod, VenueBuilding, VenueDevKind } from "@onethu/core";
import { useApp } from "../../state/context.js";
import { TabEmpty, logTabErr, tabErrorText } from "./tabStates.js";


type LoadState = "idle" | "loading" | "error" | "ready";

/** 分 → 元展示（chargingUnitPrice 为分；0/undefined → 免费） */
function yuan(fen?: number | null): string {
  if (!fen) return "免费";
  const v = fen / 100;
  return `¥${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 场次可预约判定（reserveStatus Y 且有余量） */
function sessionBookable(s: VenueSession): boolean {
  const st = s.reserveStatus?.reserveStatus;
  if (st !== undefined && st !== null && st !== "" && st !== "Y") return false;
  if (s.allowUserNum > 0 && s.resvUserNum >= s.allowUserNum) return false;
  return true;
}

const VENUE_UNAVAILABLE = "体育场馆服务暂不可用，请稍后重试";

export function VenueSportsTab() {
  const { status } = useApp();

  /* —— 授权 —— */
  const [authed, setAuthed] = useState(() => venueHasToken());
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  /* —— 场馆目录 —— */
  const [scenes, setScenes] = useState<VenueScene[] | null>(null);
  const [sceneState, setSceneState] = useState<LoadState>("idle");
  const [sceneErr, setSceneErr] = useState<string | null>(null);
  const [venue, setVenue] = useState<VenueScene | null>(null);

  /* —— 日期 + 场地 —— */
  const [date, setDate] = useState(() => todayStr());
  const [sites, setSites] = useState<VenueSite[] | null>(null);
  const [sitesState, setSitesState] = useState<LoadState>("idle");
  const [sitesErr, setSitesErr] = useState<string | null>(null);
  const [sitesUnavail, setSitesUnavail] = useState(false);

  /* —— 选中场次 —— */
  const [picked, setPicked] = useState<{ site: VenueSite; session: VenueSession } | null>(null);
  const [user, setUser] = useState<VenueUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  /* —— 楼栋（current/page 的 classTypeUuid 必须是楼栋 uuid，SPA 同款默认第一个） —— */
  const [buildings, setBuildings] = useState<VenueBuilding[]>([]);
  const [building, setBuilding] = useState("");
  const buildingsRef = useRef<VenueBuilding[]>([]);
  const [devKinds, setDevKinds] = useState<VenueDevKind[]>([]);
  const [devKind, setDevKind] = useState("");
  const devKindsRef = useRef<VenueDevKind[]>([]);
  // 楼内房间（ROOM 形态）+ 人群类型（sameLevel 位掩码过滤）
  const [rooms, setRooms] = useState<VenueBuilding[]>([]);
  const [room, setRoom] = useState("");
  const [useTypes, setUseTypes] = useState<{ key: number; value: string; label: string }[]>([]);
  const [useType, setUseType] = useState("");
  const [classEnum, setClassEnum] = useState<"BUILDING" | "ROOM">("BUILDING");
  // 元信息就绪门：楼栋+设备类型都落到当前场景后才允许拉场地（防三连发）
  const [metaReady, setMetaReady] = useState("");
  const metaCache = useRef<
    Record<string, { b: VenueBuilding[]; k: VenueDevKind[]; r: VenueBuilding[]; u: { key: number; value: string; label: string }[] }>
  >({});

  /* —— 二次认证（体育登录被 CAS 要求时出现，输一次码即信任设备） —— */
  const [twoFA, setTwoFA] = useState<{ methods: TwoFactorMethod[] } | null>(null);
  const [twoFAType, setTwoFAType] = useState<string | null>(null);
  const [twoFACode, setTwoFACode] = useState("");
  const [twoFABusy, setTwoFABusy] = useState(false);
  const [twoFAErr, setTwoFAErr] = useState<string | null>(null);
  const [twoFASent, setTwoFASent] = useState(false);

  /* —— 我的预约 —— */
  const [records, setRecords] = useState<VenueRecord[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("idle");
  const [recErr, setRecErr] = useState<string | null>(null);
  const [recUnavail, setRecUnavail] = useState(false);
  const [unsubbing, setUnsubbing] = useState<string | null>(null);

  const isVenueAuth = (err: unknown): boolean => err instanceof VenueAuthRequiredError;

  /* —— 授权 —— */
  const doAuth = useCallback(async () => {
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      // 优先复用统一身份会话静默换票；TGT 失效才开窗口兜底
      const ok = await venueLogin();
      if (ok && venueHasToken()) {
        setAuthed(true);
      } else if (!twoFA) {
        setAuthMsg("未能自动登录（统一身份会话可能已失效），请用登录窗口完成一次认证。");
      }
    } catch (err) {
      logTabErr("VENUE-AUTH", err);
      if (err instanceof VenueTwoFactorRequired) {
        setTwoFA({ methods: err.methods });
        setTwoFAType(err.methods[0]?.type ?? null);
        setTwoFASent(false);
        setAuthMsg(null);
      } else {
        setAuthMsg(`授权失败：${tabErrorText(err)}`);
      }
    } finally {
      setAuthBusy(false);
    }
  }, [twoFA]);

  /* —— 2FA 提交 —— */
  const submit2FA = useCallback(async () => {
    if (!twoFAType || !twoFACode.trim()) return;
    setTwoFABusy(true);
    setTwoFAErr(null);
    try {
      const ok = await venueSubmit2FA(twoFAType, twoFACode);
      if (ok && venueHasToken()) {
        setTwoFA(null);
        setTwoFACode("");
        setAuthed(true);
      }
    } catch (err) {
      logTabErr("VENUE-2FA", err);
      setTwoFAErr(err instanceof Error ? err.message : String(err));
    } finally {
      setTwoFABusy(false);
    }
  }, [twoFAType, twoFACode]);

  const send2FA = useCallback(async () => {
    if (!twoFAType) return;
    setTwoFABusy(true);
    setTwoFAErr(null);
    try {
      await venueSend2FACode(twoFAType);
      setTwoFASent(true);
    } catch (err) {
      logTabErr("VENUE-2FA-SEND", err);
      setTwoFAErr(err instanceof Error ? err.message : String(err));
    } finally {
      setTwoFABusy(false);
    }
  }, [twoFAType]);

  /* —— 挂载即静默全套（换票链 → 统一凭证 CAS 重登 → 换票；全程无窗口） —— */
  const [silentTried, setSilentTried] = useState(false);
  useEffect(() => {
    if (status !== "ready" || authed || silentTried) return;
    setSilentTried(true);
    setAuthBusy(true);
    void venueSilentLogin()
      .then((ok) => {
        if (ok) setAuthed(true);
        // 静默失败不弹窗：授权卡保持展示，等用户点按钮
      })
      .catch((err) => {
        if (err instanceof VenueTwoFactorRequired) {
          setTwoFA({ methods: err.methods });
          setTwoFAType(err.methods[0]?.type ?? null);
        }
      })
      .finally(() => setAuthBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, authed]);

  /* —— 场馆目录 —— */
  const loadScenes = useCallback(async () => {
    setSceneState("loading");
    setSceneErr(null);
    try {
      const list = await venueScenes();
      setScenes(list);
      setVenue((cur) => cur ?? list[0] ?? null);
      setSceneState("ready");
    } catch (err) {
      logTabErr("VENUE-SCENES", err);
      if (isVenueAuth(err)) {
        venueLogout();
        setAuthed(false);
        setSceneState("idle");
        return;
      }
      setSceneErr(tabErrorText(err));
      setSceneState("error");
    }
  }, []);

  /* —— 场地+场次 —— */
  const loadSites = useCallback(
    async (
      sceneUuid: string,
      d: string,
      bld: string = building,
      dev: string = devKind,
      enum_: "BUILDING" | "ROOM" = classEnum,
      use: string = useType,
    ) => {
      setSitesState("loading");
      setSitesErr(null);
      setSitesUnavail(false);
      setPicked(null);
      try {
        const list = await venueClient.currentPage({
          sceneUuid,
          reserveDate: d,
          classTypeEnum: enum_,
          classTypeUuid: bld,
          devKindUuid: dev,
          sceneUseType: use,
          siteType: scenes?.find((x) => x.uuid === sceneUuid)?.relatedType ?? "DEV",
        });
        setSites(list);
        setSitesState("ready");
      } catch (err) {
        logTabErr("VENUE-SITES", err);
        if (isVenueAuth(err)) {
          venueLogout();
          setAuthed(false);
          setSitesState("idle");
          return;
        }
        setSitesUnavail(!(err instanceof VenueApiError));
        setSitesErr(tabErrorText(err));
        setSitesState("error");
      }
    },
    [],
  );

  /* —— 我的预约 —— */
  const fetchRecords = useCallback(async () => {
    setRecState("loading");
    setRecErr(null);
    setRecUnavail(false);
    try {
      setRecords(await venueClient.myRecords());
      setRecState("ready");
    } catch (err) {
      logTabErr("VENUE-RECORDS", err);
      if (isVenueAuth(err)) {
        venueLogout();
        setAuthed(false);
        setRecState("idle");
        return;
      }
      setRecUnavail(!(err instanceof VenueApiError));
      setRecErr(tabErrorText(err));
      setRecState("error");
    }
  }, []);

  /* —— 登录用户（resvMember id） —— */
  useEffect(() => {
    if (!authed || !venueHasToken()) return;
    let alive = true;
    venueClient
      .getLoginUser()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch((err) => {
        logTabErr("VENUE-USER", err);
        if (alive && isVenueAuth(err)) {
          venueLogout();
          setAuthed(false);
        }
        // 用户信息失败不阻塞浏览；提交时缺 id 再提示
      });
    return () => {
      alive = false;
    };
  }, [authed]);

  /* —— 首次挂载：拉场馆目录 —— */
  useEffect(() => {
    if (status !== "ready") return;
    if (!authed) {
      setAuthed(venueHasToken());
      return;
    }
    if (sceneState === "idle") void loadScenes();
    if (recState === "idle") void fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, authed]);

  /* —— 场馆切换：并行拉楼栋+设备类型（缓存；一次落地，避免逐个 setState 连环拉场地） —— */
  useEffect(() => {
    if (!authed || !venue) return;
    let dead = false;
    const USE_ENUM = [
      { key: 1, value: "NORMAL", label: "普通" },
      { key: 2, value: "SPORT_GROUP", label: "包场" },
      { key: 4, value: "SPORT_PERSON", label: "散客" },
    ];
    const apply = (b: VenueBuilding[], k: VenueDevKind[], r: VenueBuilding[], u: { key: number; value: string; label: string }[]) => {
      if (dead) return;
      buildingsRef.current = b;
      devKindsRef.current = k;
      setBuildings(b);
      setDevKinds(k);
      setRooms(r);
      setUseTypes(u);
      setBuilding((cur) => (b.some((x) => x.uuid === cur) ? cur : b[0]?.uuid ?? ""));
      setDevKind((cur) => (k.some((x) => x.uuid === cur) ? cur : k[0]?.uuid ?? ""));
      setRoom("");
      setClassEnum("BUILDING");
      setUseType((cur) => (u.some((x) => x.value === cur) ? cur : u[0]?.value ?? "SPORT_PERSON"));
      setMetaReady(venue.uuid);
    };
    const cached = metaCache.current[venue.uuid];
    if (cached) {
      apply(cached.b, cached.k, cached.r, cached.u);
      return () => {
        dead = true;
      };
    }
    (async () => {
      // ① 人群类型掩码：sameLevel 子场景行带真实 sceneUseType（1=NORMAL 2=包场 4=散客）
      let mask = 0;
      try {
        const sl = await venueClient.sameLevel(venue.uuid);
        const subs = (sl?.siteSceneList ?? []).filter((x) => x.status === "ENABLE");
        mask = (subs.find((x) => x.uuid === venue.uuid) ?? subs[0])?.sceneUseType ?? 0;
      } catch {
        mask = 0;
      }
      const u = USE_ENUM.filter((x) => mask > 0 ? (mask & x.key) !== 0 : x.value === "SPORT_PERSON");
      // ② 设备类型 + 楼栋（并行）
      const [rb, rk] = await Promise.allSettled([venueClient.chooseBuildings(venue.uuid), venueClient.devKinds(venue.uuid)]);
      const b = rb.status === "fulfilled" ? rb.value : [];
      const k = rk.status === "fulfilled" ? rk.value : [];
      // ③ 房间（羽毛球场等 ROOM 形态：先楼栋 siteUuid 再查房）
      let r: VenueBuilding[] = [];
      if (b[0]?.uuid) {
        try {
          r = await venueClient.chooseRooms(b[0].uuid, venue.uuid);
        } catch {
          r = [];
        }
      }
      metaCache.current[venue.uuid] = { b, k, r, u };
      apply(b, k, r, u);
    })();
    return () => {
      dead = true;
    };
  }, [authed, venue?.uuid]);

  /* —— 场馆/日期/楼栋变化：拉场地 —— */
  useEffect(() => {
    if (!authed || !venue || !date) return;
    if (metaReady !== venue.uuid) return; // 元信息未就绪，等合并落地
    void loadSites(venue.uuid, date, classEnum === "ROOM" ? room : building, devKind, classEnum, useType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, venue?.uuid, date, building, room, devKind, classEnum, useType]);

  /* —— 提交预约（免费场次；付费场次 UI 拦截引导网页端） —— */
  const submit = useCallback(async () => {
    if (!picked || !venue) return;
    const uid = user?.id;
    if (!uid) {
      setNoticeMsg("未能获取体育系统用户信息，请重新授权后重试。");
      return;
    }
    const price = picked.session.userFeeDetails?.chargingUnitPrice ?? 0;
    if (price > 0) {
      setNoticeMsg("该场次为付费场次，OneTHU 暂不支持在线支付，请到体育系统网页端完成预约与支付。");
      return;
    }
    if (picked.site.formRuleVo?.formUuid) {
      setNoticeMsg("该场次需填写申请表单，请到体育系统网页端提交。");
      return;
    }
    setSubmitting(true);
    setNoticeMsg(null);
    try {
      await venueClient.addReserve({
        sceneUuid: venue.uuid,
        siteUuid: picked.site.uuid,
        siteType: picked.site.siteType || "DEV",
        session: picked.session,
        reserveDate: fmtVenueDate(picked.session.beginDate) || date,
        resvMember: [uid],
      });
      setNoticeMsg(
        `预约成功：${venue.sceneName} · ${fmtVenueDate(picked.session.beginDate) || date} · ${picked.session.beginTime}-${picked.session.endTime} · ${picked.site.siteName}`,
      );
      setPicked(null);
      await Promise.all([loadSites(venue.uuid, date), fetchRecords()]);
    } catch (err) {
      logTabErr("VENUE-SUBMIT", err);
      if (isVenueAuth(err)) {
        venueLogout();
        setAuthed(false);
      } else {
        setNoticeMsg(
          err instanceof VenueApiError ? `预约失败：${err.message}` : `预约失败：${tabErrorText(err)}`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [picked, venue, user, date, loadSites, fetchRecords]);

  /* —— 退订 —— */
  const unsubscribe = useCallback(
    async (resvUuid: string) => {
      setUnsubbing(resvUuid);
      setNoticeMsg(null);
      try {
        await venueClient.cancelReserve(resvUuid);
        setNoticeMsg("已退订。");
        await fetchRecords();
        if (venue) await loadSites(venue.uuid, date);
      } catch (err) {
        logTabErr("VENUE-CANCEL", err);
        setNoticeMsg(
          err instanceof VenueApiError ? `退订失败：${err.message}` : `退订失败：${tabErrorText(err)}`,
        );
      } finally {
        setUnsubbing(null);
      }
    },
    [fetchRecords, loadSites, venue, date],
  );

  /* —— 时段筛选：全部/上午/下午/晚上 —— */
  const [timeFilter, setTimeFilter] = useState<"all" | "am" | "pm" | "eve">("all");

  /* —— 场次展开：site × session 平铺行 —— */
  const rows = useMemo(() => {
    const out: Array<{ site: VenueSite; session: VenueSession }> = [];
    for (const site of sites ?? []) {
      for (const session of site.sessionVo ?? []) out.push({ site, session });
    }
    out.sort((a, b) => {
      const ta = `${a.session.beginTime}`;
      const tb = `${b.session.beginTime}`;
      return ta.localeCompare(tb, "zh-Hans-CN", { numeric: true });
    });
    return out;
  }, [sites]);

  const countIn = (pred: (h: number) => boolean) =>
    rows.filter(({ session }) => pred(Number(String(session.beginTime).slice(0, 2)))).length;

  /* —— 按场地分块（应用时段筛选；块内场次按开始时间升序） —— */
  const siteBlocks = useMemo(() => {
    const inRange = (t: string) => {
      const h = Number(String(t).slice(0, 2));
      if (timeFilter === "am") return h < 12;
      if (timeFilter === "pm") return h >= 12 && h < 17;
      if (timeFilter === "eve") return h >= 17;
      return true;
    };
    const groups: Array<{ site: VenueSite; sessions: VenueSession[] }> = [];
    const index = new Map<string, { site: VenueSite; sessions: VenueSession[] }>();
    for (const { site, session } of rows) {
      if (!inRange(session.beginTime)) continue;
      let g = index.get(site.uuid);
      if (!g) {
        g = { site, sessions: [] };
        index.set(site.uuid, g);
        groups.push(g);
      }
      g.sessions.push(session);
    }
    for (const g of groups) {
      g.sessions.sort((a, b) => String(a.beginTime).localeCompare(String(b.beginTime), "zh-Hans-CN", { numeric: true }));
    }
    return groups;
  }, [rows, timeFilter]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供体育场馆预约，登录后可用。" />;
  }

  /* —— 二次认证面板（CAS 要求时） —— */
  if (!authed && twoFA) {
    const cur = twoFA.methods.find((m) => m.type === twoFAType);
    return (
      <>
        <SectionHead title="体育场馆预约 · 二次认证" aside="统一身份认证" />
        <Card style={{ marginBottom: 14 }}>
          <div style={{ lineHeight: 1.7, fontSize: 13, marginBottom: 12 }}>
            统一身份要求二次认证。选择验证方式并输入验证码，完成后本设备将被信任，之后无需再输。
          </div>
          <select
            className="input filter-select"
            value={twoFAType ?? ""}
            onChange={(e) => {
              setTwoFAType(e.target.value);
              setTwoFASent(false);
              setTwoFAErr(null);
            }}
          >
            {twoFA.methods.map((m) => (
              <option key={m.type} value={m.type}>
                {m.name}
                {m.detail ? `（${m.detail}）` : ""}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              className="input"
              style={{ width: 160 }}
              value={twoFACode}
              onChange={(e) => setTwoFACode(e.target.value)}
              placeholder={twoFAType === "totp" ? "动态口令" : "验证码"}
              inputMode={twoFAType === "totp" ? "text" : "numeric"}
            />
            {twoFAType && twoFAType !== "totp" ? (
              <button className="btn btn-ghost" onClick={() => void send2FA()} disabled={twoFABusy}>
                {twoFABusy ? "发送中…" : twoFASent ? "重新发送" : "发送验证码"}
              </button>
            ) : null}
            <button className="btn btn-primary" onClick={() => void submit2FA()} disabled={twoFABusy || !twoFACode.trim()}>
              {twoFABusy ? "验证中…" : "确认"}
            </button>
          </div>
          {twoFAErr ? <div style={{ fontSize: 13, color: "#d33" }}>{twoFAErr}</div> : null}
        </Card>
      </>
    );
  }

  /* —— 授权卡（未授权 / token 过期） —— */
  if (!authed) {
    return (
      <>
        <SectionHead title="体育场馆预约" aside="体育系统 · 统一身份认证" />
        <Card style={{ marginBottom: 14 }}>
          <div style={{ lineHeight: 1.7, fontSize: 13, marginBottom: 12 }}>
            预约清华体育场馆（气膜馆、综体、游泳馆等 33 个场馆）复用 OneTHU 的统一身份登录，通常无需任何操作。仅当统一会话与本机凭证都不可用时，才需要点下方按钮在弹窗里认证一次。
          </div>
          <button className="btn btn-primary" onClick={() => void doAuth()} disabled={authBusy}>
            {authBusy ? "登录中…" : "重新登录体育系统"}
          </button>
          {authMsg ? (
            /维护中/.test(authMsg)
              ? <VenueNote text={authMsg} onRetry={() => void doAuth()} />
              : <div style={{ marginTop: 10, fontSize: 13, color: "#d33", lineHeight: 1.5 }}>{authMsg}</div>
          ) : null}
        </Card>
      </>
    );
  }

  return (
    <>
      <SectionHead
        title="场馆与日期"
        aside={
          <button className="btn btn-ghost" style={{ padding: "2px 10px" }} onClick={() => void doAuth()} disabled={authBusy}>
            {authBusy ? "授权中…" : "重新授权"}
          </button>
        }
      />
      {sceneState === "error" ? <VenueNote text={sceneErr ?? ""} onRetry={() => void loadScenes()} /> : null}
      {sceneState === "loading" && !scenes ? (
        <SkeletonRows rows={3} />
      ) : (
        <select
          className="input filter-select"
          value={venue?.uuid ?? ""}
          onChange={(e) => {
            const v = (scenes ?? []).find((x) => x.uuid === e.target.value);
            if (v) setVenue(v);
          }}
        >
          <option value="">选择场馆…</option>
          {(scenes ?? []).map((v) => (
            <option key={v.uuid} value={v.uuid}>
              {v.sceneName}
            </option>
          ))}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input
          className="input"
          style={{ width: 170 }}
          type="date"
          value={date}
          onChange={(e) => {
            const d = e.target.value;
            if (d) setDate(d);
          }}
          aria-label="预约日期"
        />
        <button className="btn btn-ghost" onClick={() => setDate(todayStr())}>
          今天
        </button>
        <button className="btn btn-ghost" onClick={() => setDate(todayStr(1))}>
          明天
        </button>
        <button
          className="btn btn-ghost"
          disabled={sitesState === "loading" || !venue}
          onClick={() => venue && void loadSites(venue.uuid, date, classEnum === "ROOM" ? room : building, devKind, classEnum, useType)}
        >
          刷新
        </button>
      </div>

      <SectionHead title={`场次与场地 · ${venue?.sceneName ?? ""}`} aside={date} />
      {buildings.length > 1 ? (
        <select
          className="input filter-select"
          value={building}
          onChange={(e) => {
            setBuilding(e.target.value);
            setRoom("");
            setClassEnum("BUILDING");
          }}
        >
          {buildings.map((b) => (
            <option key={b.uuid} value={b.uuid}>
              {b.siteName ?? b.uuid}
            </option>
          ))}
        </select>
      ) : null}
      {devKinds.length > 1 ? (
        <select
          className="input filter-select"
          value={devKind}
          onChange={(e) => setDevKind(e.target.value)}
        >
          {devKinds.map((k) => (
            <option key={k.uuid} value={k.uuid}>
              {k.devKindName ?? k.uuid}
            </option>
          ))}
        </select>
      ) : null}
      {useTypes.length > 1 ? (
        <select
          className="input filter-select"
          value={useType}
          onChange={(e) => setUseType(e.target.value)}
        >
          {useTypes.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      ) : null}
      {classEnum === "ROOM" && rooms.length > 1 ? (
        <select
          className="input filter-select"
          value={room}
          onChange={(e) => {
            setRoom(e.target.value);
            setClassEnum("ROOM");
          }}
        >
          {rooms.map((r) => (
            <option key={r.uuid} value={r.uuid}>
              {r.siteName ?? r.uuid}
            </option>
          ))}
        </select>
      ) : null}
      {sitesState === "error" ? (
        <VenueNote
          text={sitesUnavail ? VENUE_UNAVAILABLE : (sitesErr ?? "")}
          onRetry={() => venue && void loadSites(venue.uuid, date, classEnum === "ROOM" ? room : building, devKind, classEnum, useType)}
        />
      ) : null}
      {sitesState === "loading" ? (
        <SkeletonRows rows={5} />
      ) : sitesState === "ready" && rows.length === 0 ? (
        <TabEmpty text="该场馆当日暂无可预约场次（可能未开放、已约满或不在开放时段）。" />
      ) : sitesState === "ready" ? (
        <>
          {rows.length > 0 ? (
            <select
              className="input filter-select"
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as "all" | "am" | "pm" | "eve")}
            >
              <option value="all">全部时段（{rows.length} 场）</option>
              <option value="am">上午（{countIn((h) => h < 12)} 场）</option>
              <option value="pm">下午（{countIn((h) => h >= 12 && h < 17)} 场）</option>
              <option value="eve">晚上（{countIn((h) => h >= 17)} 场）</option>
            </select>
          ) : null}
          {rows.length > 0 && siteBlocks.length === 0 ? (
            <Card style={{ marginBottom: 16 }}>
              <div className="empty">该时段暂无场次，试试其他时段或「全部时段」。</div>
            </Card>
          ) : null}
          {siteBlocks.map(({ site, sessions }) => {
            const prices = sessions.map((x) => x.userFeeDetails?.chargingUnitPrice ?? 0);
            const minPrice = Math.min(...prices);
            const anyFree = prices.some((x) => x === 0);
            return (
              <Card key={site.uuid} style={{ marginBottom: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 9 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{site.siteName}</div>
                  {site.siteLocation?.location ? (
                    <div style={{ fontSize: 12, opacity: 0.65 }}>{site.siteLocation.location}</div>
                  ) : null}
                  <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
                    {anyFree ? "免费" : `¥${yuan(minPrice)} 起`}
                  </div>
                </div>
                <div className="slot-grid">
                  {sessions.map((session, i) => {
                    const pickedNow = picked?.site.uuid === site.uuid && picked?.session.uuid === session.uuid;
                    const bookable = sessionBookable(session);
                    const remain = session.allowUserNum > 0 ? session.allowUserNum - session.resvUserNum : null;
                    const fee = session.userFeeDetails?.chargingUnitPrice ?? 0;
                    const disabled = !bookable && !pickedNow;
                    return (
                      <button
                        key={`${site.uuid}-${session.uuid}-${i}`}
                        className={"slot-cell" + (pickedNow ? " picked" : bookable ? "" : " taken")}
                        title={disabled ? session.reserveStatus?.reserveStatusReason || "不可约" : undefined}
                        disabled={disabled}
                        onClick={() => bookable && setPicked({ site, session })}
                      >
                        <b>{session.beginTime}-{session.endTime}</b>
                        <small>
                          {remain === null ? "" : remain > 0 ? `余${remain}` : "满"}
                          {remain === null ? "" : fee > 0 ? " · " : ""}
                          {fee > 0 ? `¥${yuan(fee)}` : remain === null ? "" : "免费"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </>
      ) : null}

      {/* 预约卡（选中场次后出现） */}
      {picked && venue ? (
        <>
          <SectionHead title="预约" aside={`${venue.sceneName} · ${picked.site.siteName}`} />
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
              时间：{fmtVenueDate(picked.session.beginDate) || date} {picked.session.beginTime}-{picked.session.endTime}
              <br />
              场地：{picked.site.siteName}
              {picked.site.siteLocation?.location ? `（${picked.site.siteLocation.location}）` : ""}
              <br />
              费用：{yuan(picked.session.userFeeDetails?.chargingUnitPrice)}
              {picked.session.userFeeDetails?.chargingUnitPrice ? "（付费场次请到网页端支付）" : ""}
            </div>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={submitting || (picked.session.userFeeDetails?.chargingUnitPrice ?? 0) > 0}>
              {submitting ? "提交中…" : (picked.session.userFeeDetails?.chargingUnitPrice ?? 0) > 0 ? "付费场次 · 请到网页端" : "确认预约"}
            </button>
          </Card>
        </>
      ) : null}

      {noticeMsg ? (
        <Card style={{ marginBottom: 14 }}>
          <div className="empty">{noticeMsg}</div>
        </Card>
      ) : null}

      <SectionHead title="我的预约" aside="体育系统预约记录" />
      {recState === "error" ? (
        <VenueNote text={recUnavail ? VENUE_UNAVAILABLE : (recErr ?? "")} onRetry={() => void fetchRecords()} />
      ) : null}
      {recState === "loading" && !records ? (
        <SkeletonRows rows={4} />
      ) : (records?.length ?? 0) === 0 ? (
        <TabEmpty text="暂无预约记录。" />
      ) : recState === "ready" ? (
        <Card className="list">
          {(records ?? []).map((r, i) => {
            const resvUuid = r.resvUuid ?? r.uuid ?? "";
            return (
              <div className="row" key={resvUuid || i} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <span className="chip chip-green">已预约</span>
                <div className="row-main">
                  <div className="row-title">
                    {r.sceneName ? `${r.sceneName} · ` : ""}
                    {r.siteName ?? "场地"}
                  </div>
                  <div className="row-sub">
                    {[r.resvDate, r.beginTime && r.endTime ? `${r.beginTime}-${r.endTime}` : r.beginTime, r.orderAmount ? `¥${r.orderAmount}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {resvUuid ? (
                  <button
                    className="btn btn-ghost"
                    disabled={unsubbing !== null}
                    onClick={() => {
                      if (globalThis.confirm?.(`确定退订「${r.sceneName ?? ""}${r.siteName ?? ""} ${r.resvDate ?? ""}」？`)) {
                        void unsubscribe(resvUuid);
                      }
                    }}
                  >
                    {unsubbing === resvUuid ? "退订中…" : "退订"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </Card>
      ) : null}
    </>
  );
}
