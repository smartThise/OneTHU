import { useCallback, useEffect, useRef, useState } from "react";
/**
 * 图书馆页 —— 座位图（网格）+ 座位分布图 + 我的预约。
 * thu-info-lib library.ts 移植（seat.lib.tsinghua.edu.cn，roam("id") ef84f6d6…）：
 * 馆 → 楼层 → 区域 级联选择 + 今天/明天 → 座位网格（thu-info-app librarySeat 思路：
 * 绿=可约、灰=已约/不可约，右上角「电」角标=有电源插座，点可约座位→确认→预约）。
 * 可用性 = spaces_old 每座位 status/status_name（1=空闲 2=已预约 4=维护，实测）；
 * 预约 = POST api.php/spaces/<id>/book（access_token + userid + segment + type），
 * 我的预约 = user/index/book 表，可取消（menuDel delId → _method=delete）。
 * 座位区顶部 = 区域/楼层座位分布图（libraryMap/librarySeat 的
 * Public/home/images/web/area/<id>/{seat-free,floor}.jpg，带会话抓取内联）。
 *
 * 2026-10-14 OneGUI 换血：Section（三处分区头）· Field+Inline+Grow（筛选条；SearchSelect /
 * CollectStar 原样复用，保留 .ss-row 给 .filter-dd 撤底边距）· LoadingBlock（骨架）·
 * Banner（分布图报错 / 预约与取消结果，成功=success 失败=error 语义色）· 座位格 = Btn
 * （可约 tonal success、不可约 tonal 中性 disabled，状态色走 success-soft/-line/success 与
 * surface-3/content-2 令牌族；电源插座 = IconPlug warning，图例同排）· 分布图 Surface(radius-md)
 * 收边 + 内层 Stack 让 <img> 块化撑满 + Text micro 说明 ·
 * 我的预约 = Card flush + List divided + Row（取消两步行内确认，确认键改 error 语义）。
 * 删 .map-error 私有 CSS；.skeleton/.field/.ss-row/.chip-blue/.t-red 共享类其他页仍在用，保留。
 */
import type { LibBookRecord, Library, LibraryFloor, LibrarySeat, LibrarySection } from "@onethu/core";
import { infoUrls, isAuthError } from "@onethu/core";
import {
  Banner, Btn, Card, EmptyState, Field, IconPlug, Inline, List, LoadingBlock, Row, Section,
  Select, Spacer, Stack, Surface, Tag, Text,
} from "@onethu/gui";
import { CollectStar } from "../../components/Collect.js";
import { SearchSelect } from "../../components/SearchSelect.jsx";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { cacheGet, cacheSet } from "../../state/cache.js";
import { fetchImageByUrl, info, logLine, session } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { softRecover } from "../../lib/reload.js";
import { useApp } from "../../state/context.js";
import { t as i18n } from "../../i18n/index.js";


function logErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
}

type LoadState = "loading" | "error" | "ready";
const SEAT_CAP = 200;

/* -------------------- 座位分布图（thu-info-app libraryMap/librarySeat） --------------------
 * 图片 URL 拼法 = LIBRARY_IMAGE_BASE + 区域/楼层 id：area/<id>/seat-free.jpg（区域
 * 空闲座位图）与 area/<id>/floor.jpg（楼层平面图）。webview 直挂不带会话，经应用侧
 * fetchImageByUrl（Rust fetch_binary，带 webvpn 会话 Cookie）转 dataURL 内联；
 * 加载中给骨架，失败整块隐藏（不显破图）。 */

interface MapImage {
  state: "loading" | "ok" | "hidden" | "error";
  src: string;
  /** state === "error" 时的原因（直接展示给用户，便于判断是登录过期还是上游变化） */
  msg?: string;
}

/** 分布图抓取 hook：url 为空串 = 无目标区域 → 直接隐藏 */
function useAreaImage(url: string): [MapImage, () => void] {
  const [img, setImg] = useState<MapImage>({ state: "loading", src: "" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) {
      setImg({ state: "hidden", src: "" });
      return;
    }
    let alive = true;
    setImg({ state: "loading", src: "" });
    fetchImageByUrl(url)
      .then((dataUrl) => {
        if (alive) setImg({ state: "ok", src: dataUrl });
      })
      .catch((err: unknown) => {
        /* 过去这里一律静默隐藏，于是「会话墙返回登录页 HTML」与「该区域本来就没分布图(404)」
           长得一模一样：都是整块凭空消失，用户只能看到"座位图没了"（2026-02 用户报）。
           现在按原因分流——404/无图仍是静默隐藏；其余（mime 守卫拦下的登录页、网络/上游变化）
           显式报错并可重试，把原因亮出来。 */
        if (!alive) return;
        const m = err instanceof Error ? err.message : String(err);
        if (/404|not\s*found|\u4e0d\u5b58\u5728/i.test(m)) setImg({ state: "hidden", src: "" });
        else setImg({ state: "error", src: "", msg: m.trim().slice(0, 160) || "未知原因" });
      });
    return () => {
      alive = false;
    };
  }, [url, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return [img, retry];
}

/** 一张分布图：报错 = Banner（可重试）、加载 = LoadingBlock、就绪 = Surface 框 + 图注。 */
function MapFigure({ img, caption, onRetry }: { img: MapImage; caption: string; onRetry?: () => void }) {
  if (img.state === "error") {
    /* 抓取失败要看得见：过去静默隐藏导致「座位图凭空消失」无从判断（用户 2026-02 报） */
    return (
      <Banner
        tone="error"
        title={`${caption}加载失败：${img.msg}`}
        action={onRetry ? <Btn variant="outline" size="sm" onClick={onRetry}>{i18n("auto.pages.info.LibraryTab.1")}</Btn> : null}
      />
    );
  }
  if (img.state === "loading") {
    return <LoadingBlock rows={2} />;
  }
  return (
    <Stack gap={1}>
      <Surface radius="md">
        {/* Surface 是普通块：内层再坐一层 Stack 让 <img> 作为 flex 子项被块化
            （display:block + 交叉轴 stretch 自动全宽），免一条宽高内联 */}
        <Stack>
          <img src={img.src} alt={caption} />
        </Stack>
      </Surface>
      <Text slot="micro" tone="faint">{caption}</Text>
    </Stack>
  );
}

/** 座位名自然序（NF2A001 → NF2A002 → …，网格按座位号排布接近平面图观感） */
const bySeatName = (a: LibrarySeat, b: LibrarySeat): number =>
  a.zhName.localeCompare(b.zhName, "zh-Hans-CN", { numeric: true });

function seatTip(s: LibrarySeat, usable: boolean): string {
  const state = s.statusName ?? (s.valid ? "空闲" : "不可约");
  return `${s.zhNameTrace || s.zhName} · ${state}${s.hasPower ? " · 有插座" : ""}${usable ? " · 点击预约" : ""}`;
}

/** 座位格：可约 = tonal success 按钮（点击进确认），不可约 = tonal 中性 disabled 块。
 *  一个控件家族吃下两种状态（高/描边/墨色全走令牌三件套），不再手写色板；
 *  电源插座标记 = IconPlug（amber 走 warning 语义色）。 */
function SeatCell({
  seat,
  busy,
  picked,
  onPick,
}: {
  seat: LibrarySeat;
  busy: boolean;
  /** 待确认预约中的座位：tonal 选中态（外圈 outline）圈出来，不然用户找不到自己点了哪格 */
  picked?: boolean;
  onPick: (s: LibrarySeat) => void;
}) {
  const usable = seat.availability === "usable" && seat.valid;
  const power = seat.hasPower ? <IconPlug size="sm" className="og-text--t-warning" /> : null;
  if (!usable) {
    return (
      <Btn variant="tonal" size="md" disabled titleAttr={seatTip(seat, false)} iconRight={power}>
        {seat.zhName}
      </Btn>
    );
  }
  return (
    <Btn
      variant="tonal"
      tone="success"
      size="md"
      titleAttr={seatTip(seat, true)}
      disabled={busy}
      selected={picked || undefined}
      iconRight={power}
      onClick={() => onPick(seat)}
    >
      {seat.zhName}
    </Btn>
  );
}

/** 日期选择 → 真实日期串（与 core #libAreasByDateUrl 同式）：SWR 缓存键成分，防跨天陈旧 */
function dayKey(choice: 0 | 1): string {
  const d = new Date();
  d.setDate(d.getDate() + choice);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function LibraryTab({
  deepLib,
  deepFloor,
  deepSection,
}: {
  /** 深链（实体原子）：自动选中的馆 libId */
  deepLib?: number;
  /** 深链：自动选中的楼层/区域 id（区域随楼层链路就绪后选中） */
  deepFloor?: number;
  deepSection?: number;
} = {}) {
  const { status } = useApp();

  /* 馆列表 */
  const [libs, setLibs] = useState<Library[] | null>(null);
  const [libState, setLibState] = useState<LoadState>("loading");
  const [libError, setLibError] = useState<string | null>(null);
  const [libId, setLibId] = useState<number | null>(null);

  /* 楼层 / 区域 */
  const [floors, setFloors] = useState<LibraryFloor[] | null>(null);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [sections, setSections] = useState<LibrarySection[] | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [dateChoice, setDateChoice] = useState<0 | 1>(0);

  /* 座位 / 预约 */
  const [seats, setSeats] = useState<LibrarySeat[] | null>(null);
  const [seatState, setSeatState] = useState<LoadState>("loading");
  const [seatError, setSeatError] = useState<string | null>(null);
  const [pendingSeat, setPendingSeat] = useState<LibrarySeat | null>(null);
  // 位置链：去空段、去与座位名重复的尾段（trace 形如 " - NF2A029"）
  const locTrace = (() => {
    if (!pendingSeat) return "";
    const segs = String(pendingSeat.zhNameTrace || "")
      .split("-")
      .map((x) => x.trim())
      .filter((x) => x && x !== pendingSeat.zhName);
    return Array.from(new Set(segs)).join(" · ");
  })();
  const [bookError, setBookError] = useState<string | null>(null);
  const [records, setRecords] = useState<LibBookRecord[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");
  const [recError, setRecError] = useState<string | null>(null);
  const [action, setAction] = useState<{ ok: boolean; text: string } | null>(null);
  const [busySeat, setBusySeat] = useState<number | null>(null);
  const [seatTick, setSeatTick] = useState(0);
  /* 我的预约取消：先点「取消预约」进入行内确认，再点「确认取消」才调端点 */
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);
  const [busyCancel, setBusyCancel] = useState<string | null>(null);

  /* 登录态丢失静默自愈：每条加载链路独立计数（成功清零），同一次失败最多自动恢复 1 次；
   * 恢复中保持 loading 骨架不闪红，自动恢复也失败才亮 ErrorNote（手动重试会清零重计）。 */
  const libRecover = useRef(0);
  const recRecover = useRef(0);
  const floorRecover = useRef(0);
  const sectionRecover = useRef(0);
  const seatRecover = useRef(0);
  const [libTick, setLibTick] = useState(0);

  /* 分布图抓取（区域空闲座位图 + 楼层平面图；url 空 = 未选中，隐藏） */
  const [seatMap, retrySeatMap] = useAreaImage(
    sectionId !== null ? infoUrls.LIBRARY_AREA_IMAGE(sectionId, "seat-free") : "",
  );
  const [floorMap, retryFloorMap] = useAreaImage(
    floorId !== null ? infoUrls.LIBRARY_AREA_IMAGE(floorId, "floor") : "",
  );

  /* 深链：馆目录就绪后自动选中目标馆 */
  useEffect(() => {
    if (deepLib == null || libState !== "ready" || !libs) return;
    if (!libs.some((l) => l.id === deepLib)) return;
    setLibId((cur) => (cur === deepLib ? cur : deepLib));
  }, [deepLib, libState, libs]);

  /* 深链：楼层/区域就绪后自动选中（区域依赖楼层链路，随 sections 就绪） */
  useEffect(() => {
    if (deepFloor == null || !floors) return;
    if (!floors.some((f) => f.id === deepFloor)) return;
    setFloorId((cur) => (cur === deepFloor ? cur : deepFloor));
  }, [deepFloor, floors]);
  useEffect(() => {
    if (deepSection == null || !sections) return;
    if (!sections.some((sec) => sec.id === deepSection)) return;
    setSectionId((cur) => (cur === deepSection ? cur : deepSection));
  }, [deepSection, sections]);

  const loadLibs = useCallback(async () => {
    if (status !== "ready") return;
    setLibState("loading");
    setLibError(null);
    // SWR：上次馆树立即上屏（localStorage 持久化，冷启动秒开），后台重验证
    const thit = cacheGet<Library[]>("library:tree");
    if (thit && thit.data.length > 0 && Date.now() - thit.at < 86_400_000) {
      setLibs(thit.data);
      setLibState("ready");
      setLibId((cur) => cur ?? (thit.data.find((l) => l.valid) ?? thit.data[0])?.id ?? null);
    }
    try {
      const list = await info.getLibraryList();
      // 空馆列表 ≠ 正常空态：下拉块按 libs.length>0 渲染，静默吞掉会整块消失且无 ErrorNote
      if (list.length === 0) throw new Error("馆列表为空（数据源未返回内容，登录状态可能未建立）");
      libRecover.current = 0;
      cacheSet("library:tree", list);
      setLibs(list);
      setLibState("ready");
      noteAtomCache({ libraries: list.map((l) => ({ id: l.id, name: l.zhName })) });
      const firstValid = list.find((l) => l.valid) ?? list[0];
      // 守卫：stale 已选的馆不覆盖（重验证不改用户选择）
      if (firstValid) setLibId((cur) => cur ?? firstValid.id);
    } catch (err) {
      logErr("LIB-LIST", err);
      // 登录态丢失：不闪红，静默强制重建座位会话后自动重载一次；仍失败才亮 ErrorNote
      // 登录态丢失：softRelogin 透明全链重建（含 WebVPN 层）→ 原地重拉（THU Info 语义，绝不整页刷新）
      if (isAuthError(err) && (await softRecover("lib"))) return loadLibs();
      // softRecover 失败/节流 → 落回数据级恢复兜底
      if (isAuthError(err) && libRecover.current < 1) {
        libRecover.current += 1;
        await info.forceEnsure("library").catch((renewErr: unknown) => {
          logErr("LIB-RENEW", renewErr);
        });
        return loadLibs();
      }
      setLibState("error");
      setLibError(explainNetworkError(err));
    }
  }, [status]);

  const loadRecords = useCallback(async () => {
    if (status !== "ready") return;
    setRecState("loading");
    setRecError(null);
    try {
      setRecords(await info.getLibBookRecords());
      recRecover.current = 0;
      setRecState("ready");
    } catch (err) {
      logErr("LIB-REC", err);
      // 登录态丢失：静默重建会话后自动重载一次（保持骨架，不闪红）
      // 登录态丢失：softRelogin 透明全链重建 → 原地重拉
      if (isAuthError(err) && (await softRecover("lib"))) return loadRecords();
      // softRecover 失败/节流 → 落回数据级恢复兜底
      if (isAuthError(err) && recRecover.current < 1) {
        recRecover.current += 1;
        await info.forceEnsure("library").catch((renewErr: unknown) => {
          logErr("LIB-RENEW", renewErr);
        });
        return loadRecords();
      }
      setRecState("error");
      setRecError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    void loadLibs();
    void loadRecords();
  }, [loadLibs, loadRecords, libTick]);

  /* 楼层：随馆/日期变化 */
  useEffect(() => {
    if (libId === null || status !== "ready") return;
    const lib = (libs ?? []).find((l) => l.id === libId);
    if (!lib) return;
    let alive = true;
    let picked = false;
    const pickFirst = (list: LibraryFloor[]) => {
      if (picked) return;
      const firstValid = list.find((f) => f.valid);
      if (firstValid) {
        picked = true;
        setFloorId(firstValid.id);
      }
    };
    // SWR：上次楼层立即上屏（键嵌真实日期，防跨天陈旧冒充），后台重验证
    const fkey = `library:floors:${libId}:${dayKey(dateChoice)}`;
    const fhit = cacheGet<LibraryFloor[]>(fkey);
    if (fhit && fhit.data.length > 0 && Date.now() - fhit.at < 6 * 3_600_000) {
      setFloors(fhit.data);
      pickFirst(fhit.data);
      picked = true;
    } else {
      setFloors(null);
      setFloorId(null);
      setSections(null);
      setSectionId(null);
      setSeats(null);
    }
    // 渐进回填：楼层骨架先亮（区域下拉立即可选），逐层余量到达即刷新——
    // 校外 webvpn 每层 2~3s 串行（PHP 会话锁），不再攒满 5 层才出界面
    info
      .getLibraryFloorList(lib, dateChoice, (list) => {
        if (!alive || list.length === 0) return;
        setFloors([...list]);
        pickFirst(list);
      })
      .then((list) => {
        if (!alive) return;
        floorRecover.current = 0;
        cacheSet(fkey, list);
        setFloors(list);
        pickFirst(list);
      })
      .catch(async (err: unknown) => {
        logErr("LIB-FLOOR", err);
        if (!alive) return;
        // 登录态丢失：softRelogin 透明全链重建 → tick 链自动重拉
        if (isAuthError(err) && (await softRecover("lib"))) { floorRecover.current = 0; setLibTick((t) => t + 1); return; }
        // softRecover 失败/节流 → 落回数据级恢复兜底
        if (isAuthError(err) && floorRecover.current < 1) {
          // 登录态丢失：静默重建会话后整链重载（保持骨架，不闪红）
          floorRecover.current += 1;
          info
            .forceEnsure("library")
            .catch((renewErr: unknown) => logErr("LIB-RENEW", renewErr))
            .finally(() => setLibTick((t) => t + 1));
          return;
        }
        setFloors([]);
        setSeatState("error");
        setSeatError(explainNetworkError(err));
      });
    return () => {
      alive = false;
    };
  }, [libId, dateChoice, libs, status]);

  /* 区域：随楼层/日期变化 */
  useEffect(() => {
    if (floorId === null || status !== "ready") return;
    let alive = true;
    // SWR：上次区域立即上屏（键嵌真实日期），后台重验证
    const skey = `library:sections:${floorId}:${dayKey(dateChoice)}`;
    const shit = cacheGet<LibrarySection[]>(skey);
    if (shit && shit.data.length > 0 && Date.now() - shit.at < 6 * 3_600_000) {
      setSections(shit.data);
      setSectionId((cur) => cur ?? shit.data.find((s) => s.valid)?.id ?? null);
    } else {
      setSections(null);
      setSectionId(null);
      setSeats(null);
    }
    info
      .getLibrarySectionList({ id: floorId, zhNameTrace: "" }, dateChoice)
      .then((list) => {
        if (!alive) return;
        sectionRecover.current = 0;
        cacheSet(skey, list);
        setSections(list);
        // 守卫：stale 已选的区域仍存在则不覆盖（重验证不改用户选择）
        setSectionId((cur) =>
          cur && list.some((s) => s.id === cur) ? cur : list.find((s) => s.valid)?.id ?? null,
        );
      })
      .catch(async (err: unknown) => {
        logErr("LIB-SECTION", err);
        if (!alive) return;
        // 登录态丢失：softRelogin 透明全链重建 → tick 链自动重拉
        if (isAuthError(err) && (await softRecover("lib"))) { sectionRecover.current = 0; setLibTick((t) => t + 1); return; }
        // softRecover 失败/节流 → 落回数据级恢复兜底
        if (isAuthError(err) && sectionRecover.current < 1) {
          // 登录态丢失：静默重建会话后整链重载（保持骨架，不闪红）
          sectionRecover.current += 1;
          info
            .forceEnsure("library")
            .catch((renewErr: unknown) => logErr("LIB-RENEW", renewErr))
            .finally(() => setLibTick((t) => t + 1));
          return;
        }
        setSections([]);
        setSeatState("error");
        setSeatError(explainNetworkError(err));
      });
    return () => {
      alive = false;
    };
  }, [floorId, dateChoice, status]);

  /* 座位：随区域/日期变化 */
  useEffect(() => {
    if (sectionId === null || status !== "ready") return;
    let alive = true;
    setSeats(null);
    setSeatState("loading");
    setSeatError(null);
    setPendingSeat(null);
    setBookError(null);
    info
      .getLibrarySeatList({ id: sectionId, zhNameTrace: "" }, dateChoice)
      .then((list) => {
        if (!alive) return;
        seatRecover.current = 0;
        setSeats(list);
        setSeatState("ready");
      })
      .catch(async (err: unknown) => {
        logErr("LIB-SEAT", err);
        if (!alive) return;
        // 登录态丢失：softRelogin 透明全链重建 → tick 链自动重拉
        if (isAuthError(err) && (await softRecover("lib"))) { seatRecover.current = 0; setSeatTick((t) => t + 1); return; }
        // softRecover 失败/节流 → 落回数据级恢复兜底
        if (isAuthError(err) && seatRecover.current < 1) {
          // 登录态丢失：静默重建座位会话后自动重取一次（保持骨架，不闪红）
          seatRecover.current += 1;
          info
            .forceEnsure("library")
            .catch((renewErr: unknown) => logErr("LIB-RENEW", renewErr))
            .finally(() => setSeatTick((t) => t + 1));
          return;
        }
        setSeatState("error");
        setSeatError(explainNetworkError(err));
      });
    return () => {
      alive = false;
    };
  }, [sectionId, dateChoice, status, seatTick]);

  /* 点座位 → 确认条 → book（thu-info-app librarySeat 的 Alert.alert 确认桌面化） */
  const pickSeat = (seat: LibrarySeat): void => {
    setBookError(null);
    setAction(null);
    setPendingSeat(seat);
  };

  const book = async (seat: LibrarySeat): Promise<void> => {
    if (sectionId === null) return;
    const userId = session.username;
    if (!userId) {
      setBookError("需要先登录（未读取到学号）");
      setPendingSeat(null);
      return;
    }
    setBusySeat(seat.id);
    setPendingSeat(null);
    setBookError(null);
    setAction(null);
    try {
      await info.bookLibrarySeat({ id: seat.id, type: seat.type }, sectionId, dateChoice, userId);
      setAction({ ok: true, text: `座位 ${seat.zhName} 预约成功，须在预约开始后 30 分钟内完成签到` });
      void loadRecords();
      // 预约后刷新座位状态
      info
        .getLibrarySeatList({ id: sectionId, zhNameTrace: "" }, dateChoice)
        .then(setSeats)
        .catch(() => undefined);
    } catch (err) {
      logErr("LIB-BOOK", err);
      setBookError(explainNetworkError(err));
    } finally {
      setBusySeat(null);
    }
  };

  const cancel = async (r: LibBookRecord): Promise<void> => {
    const userId = session.username;
    if (!r.delId) return;
    if (!userId) {
      setAction({ ok: false, text: "需要先登录（未读取到学号）" });
      return;
    }
    setBusyCancel(r.delId);
    setAction(null);
    try {
      await info.cancelLibBooking(r.delId, userId);
      setAction({ ok: true, text: "已取消预约" });
      void loadRecords();
    } catch (err) {
      logErr("LIB-CANCEL", err);
      setAction({ ok: false, text: explainNetworkError(err) });
    } finally {
      setBusyCancel(null);
      setPendingCancel(null);
    }
  };

  const lib = (libs ?? []).find((l) => l.id === libId);
  const floor = (floors ?? []).find((f) => f.id === floorId);
  const section = (sections ?? []).find((s) => s.id === sectionId);

  const seatList = seats ?? [];
  // 网格按座位号自然序排布（接近平面图行进方向），截断逻辑与旧列表一致
  const gridSeats = [...seatList].sort(bySeatName).slice(0, SEAT_CAP);
  const usableCount = gridSeats.filter((s) => s.availability === "usable" && s.valid).length;

  return (
    <Stack gap={3}>
      <Section title={i18n("auto.pages.info.LibraryTab.2")} aside="seat.lib.tsinghua.edu.cn · ISeating" />
      {libState === "error" ? (
        <Banner
          tone="error"
          action={
            <Btn
              variant="ghost"
              tone="error"
              size="sm"
              onClick={() => {
                libRecover.current = 0;
                void loadLibs();
              }}
            >
              {i18n("auto.pages.info.LibraryTab.1")}</Btn>
          }
        >
          {libError ?? ""}
        </Banner>
      ) : null}
      {libState === "loading" && !libs ? <LoadingBlock rows={2} /> : null}

      {libs && libs.length > 0 ? (
        /* 筛选条收紧（用户点名 2026-10-14）：馆/楼层/区域走自然宽度紧凑成排（星贴各自下拉），
           不再用 Grow 把每格铺满 1/3 窗宽留出大空档；只有日期用 Spacer 推到行尾。 */
        <Inline gap={3} wrap vAlign="end">
          <Field label={i18n("auto.pages.info.LibraryTab.3")}>
              <Inline gap={1} className="ss-row">
                <SearchSelect
                  value={libId != null ? String(libId) : ""}
                  onChange={(v) => setLibId(Number(v) || null)}
                  placeholder={i18n("auto.pages.info.LibraryTab.4")}
                  options={(libs ?? []).map((l) => ({
                    value: String(l.id),
                    label: l.zhName + (!l.valid ? "（暂不可约）" : ""),
                    disabled: !l.valid,
                  }))}
                />
                {libId != null ? (
                  <CollectStar
                    atom={{ kind: "library", key: enc(libId, libs?.find((l) => l.id === libId)?.zhName ?? "") }}
                    title={libs?.find((l) => l.id === libId)?.zhName ?? "图书馆"}
                  />
                ) : null}
              </Inline>
            </Field>
          <Field label={i18n("auto.pages.info.LibraryTab.5")}>
              <Inline gap={1} className="ss-row">
                <SearchSelect
                  value={floorId != null ? String(floorId) : ""}
                  onChange={(v) => setFloorId(Number(v) || null)}
                  placeholder={!floors ? "加载中…" : floors.length === 0 ? "无可用楼层" : "选择楼层…"}
                  disabled={!floors || floors.length === 0}
                  options={(floors ?? []).map((f) => ({
                    value: String(f.id),
                    label: f.zhName + (f.valid && f.total > 0 ? `（${f.available}/${f.total}）` : ""),
                    disabled: !f.valid,
                  }))}
                />
                {floorId != null && libId != null ? (
                  <CollectStar
                    atom={{ kind: "library-f", key: enc(libId, libs?.find((l) => l.id === libId)?.zhName ?? "", floorId, floors?.find((f) => f.id === floorId)?.zhName ?? "") }}
                    title={floors?.find((f) => f.id === floorId)?.zhName ?? "楼层"}
                  />
                ) : null}
              </Inline>
            </Field>
          <Field label={i18n("auto.pages.info.LibraryTab.6")}>
              <Inline gap={1} className="ss-row">
                <SearchSelect
                  value={sectionId != null ? String(sectionId) : ""}
                  onChange={(v) => setSectionId(Number(v) || null)}
                  placeholder={!sections ? "加载中…" : sections.length === 0 ? "无可用区域" : "选择区域…"}
                  disabled={!sections || sections.length === 0}
                  options={(sections ?? []).map((sec) => ({
                    value: String(sec.id),
                    label: sec.zhName + (sec.valid && sec.total > 0 ? `（${sec.available}/${sec.total}）` : ""),
                    disabled: !sec.valid,
                  }))}
                />
                {sectionId != null && libId != null ? (
                  <CollectStar
                    atom={{
                      kind: "library-a",
                      key: enc(
                        libId,
                        libs?.find((l) => l.id === libId)?.zhName ?? "",
                        floorId ?? "",
                        floors?.find((f) => f.id === floorId)?.zhName ?? "",
                        sectionId,
                        sections?.find((sec) => sec.id === sectionId)?.zhName ?? "",
                      ),
                    }}
                    title={sections?.find((sec) => sec.id === sectionId)?.zhName ?? "区域"}
                  />
                ) : null}
              </Inline>
            </Field>
          <Spacer />
          <Field label={i18n("auto.pages.info.LibraryTab.7")}>
            <Select
              aria-label={i18n("auto.pages.info.LibraryTab.7")}
              value={dateChoice}
              onChange={(value) => setDateChoice(value === "1" ? 1 : 0)}
            >
              <option value={0}>{i18n("auto.pages.info.LibraryTab.8")}</option>
              <option value={1}>{i18n("auto.pages.info.LibraryTab.9")}</option>
            </Select>
          </Field>
        </Inline>
      ) : null}

      {lib && floor && section ? (
        <Section
          title={i18n("auto.pages.info.LibraryTab.10")}
          aside={`${lib.zhName} · ${floor.zhName} · ${section.zhName} · ${dateChoice === 0 ? "今天" : "明天"}`}
        />
      ) : null}

      {/* 座位分布图（座位区顶部；多图纵向排列；全失败整块隐藏） */}
      {seatMap.state !== "hidden" || floorMap.state !== "hidden" ? (
        <Card>
          <Stack gap={3}>
            {section && seatMap.state !== "hidden" ? (
              <MapFigure img={seatMap} onRetry={retrySeatMap} caption={`${section.zhName} · 座位分布`} />
            ) : null}
            {floor && floorMap.state !== "hidden" ? (
              <MapFigure img={floorMap} onRetry={retryFloorMap} caption={`${floor.zhName} · 楼层平面图`} />
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {seatState === "loading" ? <LoadingBlock rows={4} /> : null}
      {seatState === "error" ? (
        <Banner
          tone="error"
          action={
            <Btn
              variant="ghost"
              tone="error"
              size="sm"
              onClick={() => {
                // 座位区错误可能出在楼层/区域链路：链路断了从馆列表整链重载，否则仅重取座位
                seatRecover.current = 0;
                floorRecover.current = 0;
                sectionRecover.current = 0;
                if (sectionId !== null) setSeatTick((t) => t + 1);
                else setLibTick((t) => t + 1);
              }}
            >
              {i18n("auto.pages.info.LibraryTab.1")}</Btn>
          }
        >
          {seatError ?? ""}
        </Banner>
      ) : null}
      {seatState === "ready" && seatList.length === 0 ? (
        <Card>
          <EmptyState title={i18n("auto.pages.info.LibraryTab.11")} />
        </Card>
      ) : null}
      {seatState === "ready" && seatList.length > 0 ? (
        <Card>
          <Stack gap={2}>
            {/* 图例：状态=Tag 语义色；电源插座=IconPlug(warning) */}
            <Inline gap={3} vAlign="center" wrap>
              <Tag tone="success">{i18n("auto.pages.info.LibraryTab.12")}{usableCount}</Tag>
              <Tag>{i18n("auto.pages.info.LibraryTab.13")}{gridSeats.length - usableCount}</Tag>
              <Inline gap={1} vAlign="center">
                <IconPlug size="sm" className="og-text--t-warning" title={i18n("auto.pages.info.LibraryTab.14")} />
                <Text slot="label" tone="faint">{i18n("auto.pages.info.LibraryTab.15")}</Text>
              </Inline>
              {seatList.length > SEAT_CAP ? (
                <Text slot="label" tone="faint">
                  {i18n("auto.pages.info.LibraryTab.16")}{SEAT_CAP} {i18n("auto.pages.info.LibraryTab.17")}{seatList.length} {i18n("auto.pages.info.LibraryTab.18")}</Text>
              ) : null}
            </Inline>
            {/* 座位网格：flex-wrap，窄窗口自动换行不横向溢出 */}
            <Inline gap={1} wrap>
              {gridSeats.map((s) => (
                <SeatCell key={s.id} seat={s} busy={busySeat !== null} picked={pendingSeat?.id === s.id} onPick={pickSeat} />
              ))}
            </Inline>
          </Stack>
        </Card>
      ) : null}

      {/* 点选座位后的确认条 */}
      {pendingSeat ? (
        <Card>
          <Stack gap={2}>
            <Inline gap={2} vAlign="baseline" wrap>
              <Text as="h3" slot="subtitle">{i18n("auto.pages.info.LibraryTab.19")}{pendingSeat.zhName}</Text>
              <Tag tone="brand">{dateChoice === 0 ? "今天" : "明天"}</Tag>
            </Inline>
            {locTrace ? (
              <Text slot="label" tone="quiet">{i18n("auto.pages.info.LibraryTab.20")}{locTrace}</Text>
            ) : null}
            <Text slot="label" tone="quiet">{i18n("auto.pages.info.LibraryTab.21")}</Text>
            <Inline gap={2} justify="end">
              <Btn variant="outline" onClick={() => setPendingSeat(null)}>{i18n("auto.pages.info.LibraryTab.22")}</Btn>
              <Btn
                variant="solid"
                tone="brand"
                disabled={busySeat !== null}
                onClick={() => void book(pendingSeat)}
              >
                {busySeat !== null ? "预约中…" : "确认预约"}
              </Btn>
            </Inline>
          </Stack>
        </Card>
      ) : null}

      {bookError ? <Banner tone="error">{bookError}</Banner> : null}

      {action ? <Banner tone={action.ok ? "success" : "error"}>{action.text}</Banner> : null}

      <Section title={i18n("auto.pages.info.LibraryTab.23")} aside="座位预约记录" />
      {recState === "loading" ? <LoadingBlock rows={2} /> : null}
      {recState === "error" ? (
        <Banner
          tone="error"
          action={
            <Btn
              variant="ghost"
              tone="error"
              size="sm"
              onClick={() => {
                recRecover.current = 0;
                void loadRecords();
              }}
            >
              {i18n("auto.pages.info.LibraryTab.1")}</Btn>
          }
        >
          {recError ?? ""}
        </Banner>
      ) : null}
      {recState === "ready" && (records ?? []).length === 0 ? (
        <Card>
          <EmptyState title={i18n("auto.pages.info.LibraryTab.24")} />
        </Card>
      ) : null}
      {recState === "ready" && (records ?? []).length > 0 ? (
        <Card flush>
          <List divided>
            {(records ?? []).map((r, i) => (
              <Row
                flush
                key={`${r.id}-${i}`}
                title={r.pos || r.id || "预约"}
                sub={`${r.time || "–"}${r.status ? ` · ${r.status}` : ""}`}
                trailing={
                  r.delId ? (
                    pendingCancel === (r.delId ?? r.id) ? (
                      <Inline gap={2} vAlign="center">
                        <Text slot="label" tone="quiet">{i18n("auto.pages.info.LibraryTab.25")}</Text>
                        <Btn
                          variant="solid"
                          tone="error"
                          disabled={busyCancel !== null}
                          onClick={() => void cancel(r)}
                        >
                          {busyCancel !== null ? "取消中…" : "确认取消"}
                        </Btn>
                        <Btn variant="outline" disabled={busyCancel !== null} onClick={() => setPendingCancel(null)}>
                          {i18n("auto.pages.info.LibraryTab.26")}</Btn>
                      </Inline>
                    ) : (
                      <Btn
                        variant="outline"
                        disabled={busyCancel !== null}
                        onClick={() => setPendingCancel(r.delId ?? r.id)}
                      >
                        {i18n("auto.pages.info.LibraryTab.27")}</Btn>
                    )
                  ) : null
                }
              />
            ))}
          </List>
        </Card>
      ) : null}
    </Stack>
  );
}
