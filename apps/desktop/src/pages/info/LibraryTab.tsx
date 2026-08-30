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
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { LibBookRecord, Library, LibraryFloor, LibrarySeat, LibrarySection } from "@onethu/core";
import { infoUrls, isAuthError } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { fetchImageByUrl, info, logLine, session } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";

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
  state: "loading" | "ok" | "hidden";
  src: string;
}

/** 分布图抓取 hook：url 为空串 = 无目标区域 → 直接隐藏 */
function useAreaImage(url: string): MapImage {
  const [img, setImg] = useState<MapImage>({ state: "loading", src: "" });
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
      .catch(() => {
        // 部分区域/楼层没有分布图（404）属正常态：静默整块隐藏
        if (alive) setImg({ state: "hidden", src: "" });
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return img;
}

function MapFigure({ img, caption }: { img: MapImage; caption: string }) {
  if (img.state === "loading") {
    return (
      <div
        className="skeleton"
        role="img"
        aria-label={`${caption}（加载中）`}
        style={{ width: "100%", height: 150, borderRadius: 10 }}
      />
    );
  }
  return (
    <figure style={{ margin: 0 }}>
      <img
        src={img.src}
        alt={caption}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          borderRadius: 8,
          border: "1px solid var(--border-soft)",
        }}
      />
      <figcaption
        style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, textAlign: "center" }}
      >
        {caption}
      </figcaption>
    </figure>
  );
}

/** 座位名自然序（NF2A001 → NF2A002 → …，网格按座位号排布接近平面图观感） */
const bySeatName = (a: LibrarySeat, b: LibrarySeat): number =>
  a.zhName.localeCompare(b.zhName, "zh-Hans-CN", { numeric: true });

/** 图例色块 */
function LegendSwatch({ usable }: { usable: boolean }) {
  const style: CSSProperties = usable
    ? { background: "var(--green-soft)", borderColor: "var(--green)" }
    : { background: "var(--surface-3)", borderColor: "var(--border)" };
  return (
    <i
      aria-hidden
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 3,
        borderStyle: "solid",
        borderWidth: 1,
        ...style,
      }}
    />
  );
}

/** 有电源座位右上角「电」角标（thu-info-app 插座状态的桌面化表达） */
const POWER_BADGE: CSSProperties = {
  position: "absolute",
  top: 1,
  right: 2,
  fontSize: 8,
  lineHeight: "10px",
  fontWeight: 700,
  color: "var(--amber)",
};

const SEAT_CELL: CSSProperties = {
  position: "relative",
  width: 58,
  height: 44,
  borderRadius: 8,
  padding: 0,
  fontSize: 11,
  lineHeight: 1.1,
  textAlign: "center",
};

function seatTip(s: LibrarySeat, usable: boolean): string {
  const state = s.statusName ?? (s.valid ? "空闲" : "不可约");
  return `${s.zhNameTrace || s.zhName} · ${state}${s.hasPower ? " · 有插座" : ""}${usable ? " · 点击预约" : ""}`;
}

/** 座位格：可约=按钮（点击进确认），不可约=灰块（含已约/维护等） */
function SeatCell({
  seat,
  busy,
  onPick,
}: {
  seat: LibrarySeat;
  busy: boolean;
  onPick: (s: LibrarySeat) => void;
}) {
  const usable = seat.availability === "usable" && seat.valid;
  const label = (
    <span
      style={{
        display: "block",
        padding: "0 4px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {seat.zhName}
    </span>
  );
  const badge = seat.hasPower ? <span aria-hidden style={POWER_BADGE}>电</span> : null;
  if (!usable) {
    return (
      <div
        title={seatTip(seat, false)}
        style={{
          ...SEAT_CELL,
          border: "1px solid var(--border-soft)",
          background: "var(--surface-3)",
          color: "var(--text-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {badge}
        {label}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onPick(seat)}
      title={seatTip(seat, true)}
      style={{
        ...SEAT_CELL,
        border: "1px solid var(--green)",
        background: "var(--green-soft)",
        color: "var(--green)",
        cursor: "pointer",
      }}
    >
      {badge}
      {label}
    </button>
  );
}

export function LibraryTab() {
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
  const [bookError, setBookError] = useState<string | null>(null);
  const [records, setRecords] = useState<LibBookRecord[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");
  const [recError, setRecError] = useState<string | null>(null);
  const [action, setAction] = useState<{ ok: boolean; text: string } | null>(null);
  const [busySeat, setBusySeat] = useState<number | null>(null);
  const [seatTick, setSeatTick] = useState(0);

  /* 登录态丢失静默自愈：每条加载链路独立计数（成功清零），同一次失败最多自动恢复 1 次；
   * 恢复中保持 loading 骨架不闪红，自动恢复也失败才亮 ErrorNote（手动重试会清零重计）。 */
  const libRecover = useRef(0);
  const recRecover = useRef(0);
  const floorRecover = useRef(0);
  const sectionRecover = useRef(0);
  const seatRecover = useRef(0);
  const [libTick, setLibTick] = useState(0);

  /* 分布图抓取（区域空闲座位图 + 楼层平面图；url 空 = 未选中，隐藏） */
  const seatMap = useAreaImage(
    sectionId !== null ? infoUrls.LIBRARY_AREA_IMAGE(sectionId, "seat-free") : "",
  );
  const floorMap = useAreaImage(
    floorId !== null ? infoUrls.LIBRARY_AREA_IMAGE(floorId, "floor") : "",
  );

  const loadLibs = useCallback(async () => {
    if (status !== "ready") return;
    setLibState("loading");
    setLibError(null);
    try {
      const list = await info.getLibraryList();
      // 空馆列表 ≠ 正常空态：下拉块按 libs.length>0 渲染，静默吞掉会整块消失且无 ErrorNote
      if (list.length === 0) throw new Error("馆列表为空（seat.lib 返回空 list，会话可能未建立）");
      libRecover.current = 0;
      setLibs(list);
      setLibState("ready");
      const firstValid = list.find((l) => l.valid) ?? list[0];
      if (firstValid) setLibId(firstValid.id);
    } catch (err) {
      logErr("LIB-LIST", err);
      // 登录态丢失：不闪红，静默强制重建座位会话后自动重载一次；仍失败才亮 ErrorNote
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
    setFloors(null);
    setFloorId(null);
    setSections(null);
    setSectionId(null);
    setSeats(null);
    info
      .getLibraryFloorList(lib, dateChoice)
      .then((list) => {
        if (!alive) return;
        floorRecover.current = 0;
        setFloors(list);
        const firstValid = list.find((f) => f.valid);
        if (firstValid) setFloorId(firstValid.id);
      })
      .catch((err: unknown) => {
        logErr("LIB-FLOOR", err);
        if (!alive) return;
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
    setSections(null);
    setSectionId(null);
    setSeats(null);
    info
      .getLibrarySectionList({ id: floorId, zhNameTrace: "" }, dateChoice)
      .then((list) => {
        if (!alive) return;
        sectionRecover.current = 0;
        setSections(list);
        const firstValid = list.find((s) => s.valid);
        if (firstValid) setSectionId(firstValid.id);
      })
      .catch((err: unknown) => {
        logErr("LIB-SECTION", err);
        if (!alive) return;
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
      .catch((err: unknown) => {
        logErr("LIB-SEAT", err);
        if (!alive) return;
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
      setBookError("需要登录会话（未获取到学号）");
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
      setAction({ ok: false, text: "需要登录会话（未获取到学号）" });
      return;
    }
    setAction(null);
    try {
      await info.cancelLibBooking(r.delId, userId);
      setAction({ ok: true, text: "已取消预约" });
      void loadRecords();
    } catch (err) {
      logErr("LIB-CANCEL", err);
      setAction({ ok: false, text: explainNetworkError(err) });
    }
  };

  if (status === "demo") {
    return <Empty text="演示模式不提供图书馆数据，登录后可查询座位与预约。" />;
  }

  const lib = (libs ?? []).find((l) => l.id === libId);
  const floor = (floors ?? []).find((f) => f.id === floorId);
  const section = (sections ?? []).find((s) => s.id === sectionId);

  const seatList = seats ?? [];
  // 网格按座位号自然序排布（接近平面图行进方向），截断逻辑与旧列表一致
  const gridSeats = [...seatList].sort(bySeatName).slice(0, SEAT_CAP);
  const usableCount = gridSeats.filter((s) => s.availability === "usable" && s.valid).length;

  return (
    <>
      <SectionHead title="图书馆座位" aside="seat.lib.tsinghua.edu.cn · ISeating" />
      {libState === "error" ? (
        <ErrorNote
          text={libError ?? ""}
          onRetry={() => {
            libRecover.current = 0;
            void loadLibs();
          }}
        />
      ) : null}
      {libState === "loading" && !libs ? <SkeletonRows rows={2} /> : null}

      {libs && libs.length > 0 ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div className="field" style={{ margin: 0, minWidth: 150 }}>
            <label htmlFor="lib-lib">馆</label>
            <select
              id="lib-lib"
              className="input"
              value={libId ?? ""}
              onChange={(e) => setLibId(Number(e.target.value) || null)}
            >
              {(libs ?? []).map((l) => (
                <option key={l.id} value={l.id} disabled={!l.valid}>
                  {l.zhName}
                  {!l.valid ? "（暂不可约）" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 170 }}>
            <label htmlFor="lib-floor">楼层</label>
            <select
              id="lib-floor"
              className="input"
              value={floorId ?? ""}
              onChange={(e) => setFloorId(Number(e.target.value) || null)}
              disabled={!floors || floors.length === 0}
            >
              {!floors ? <option value="">加载中…</option> : null}
              {floors?.length === 0 ? <option value="">无可用楼层</option> : null}
              {(floors ?? []).map((f) => (
                <option key={f.id} value={f.id} disabled={!f.valid}>
                  {f.zhName}
                  {f.valid && f.total > 0 ? `（${f.available}/${f.total}）` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 170 }}>
            <label htmlFor="lib-section">区域</label>
            <select
              id="lib-section"
              className="input"
              value={sectionId ?? ""}
              onChange={(e) => setSectionId(Number(e.target.value) || null)}
              disabled={!sections || sections.length === 0}
            >
              {!sections ? <option value="">加载中…</option> : null}
              {sections?.length === 0 ? <option value="">无可用区域</option> : null}
              {(sections ?? []).map((s) => (
                <option key={s.id} value={s.id} disabled={!s.valid}>
                  {s.zhName}
                  {s.valid && s.total > 0 ? `（${s.available}/${s.total}）` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="lib-date">日期</label>
            <select
              id="lib-date"
              className="input"
              value={dateChoice}
              onChange={(e) => setDateChoice(e.target.value === "1" ? 1 : 0)}
            >
              <option value={0}>今天</option>
              <option value={1}>明天</option>
            </select>
          </div>
        </div>
      ) : null}

      {lib && floor && section ? (
        <SectionHead
          title="座位"
          aside={`${lib.zhName} · ${floor.zhName} · ${section.zhName} · ${dateChoice === 0 ? "今天" : "明天"}`}
        />
      ) : null}

      {/* 座位分布图（座位区顶部；多图纵向排列，宽度 100%；全失败整块隐藏） */}
      {seatMap.state !== "hidden" || floorMap.state !== "hidden" ? (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {section && seatMap.state !== "hidden" ? (
              <MapFigure img={seatMap} caption={`${section.zhName} · 座位分布`} />
            ) : null}
            {floor && floorMap.state !== "hidden" ? (
              <MapFigure img={floorMap} caption={`${floor.zhName} · 楼层平面图`} />
            ) : null}
          </div>
        </Card>
      ) : null}

      {seatState === "loading" ? <SkeletonRows rows={4} /> : null}
      {seatState === "error" ? (
        <ErrorNote
          text={seatError ?? ""}
          onRetry={() => {
            // 座位区错误可能出在楼层/区域链路：链路断了从馆列表整链重载，否则仅重取座位
            seatRecover.current = 0;
            floorRecover.current = 0;
            sectionRecover.current = 0;
            if (sectionId !== null) setSeatTick((t) => t + 1);
            else setLibTick((t) => t + 1);
          }}
        />
      ) : null}
      {seatState === "ready" && seatList.length === 0 ? (
        <Card>
          <Empty text="该区域暂无座位数据。" />
        </Card>
      ) : null}
      {seatState === "ready" && seatList.length > 0 ? (
        <Card>
          {/* 图例 */}
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 10,
              fontSize: 12,
              color: "var(--text-2)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <LegendSwatch usable /> 可约 {usableCount}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <LegendSwatch usable={false} /> 已约/不可约 {gridSeats.length - usableCount}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span aria-hidden style={{ fontSize: 10, fontWeight: 700, color: "var(--amber)" }}>
                电
              </span>
              = 有电源插座
            </span>
            {seatList.length > SEAT_CAP ? (
              <span style={{ color: "var(--text-3)" }}>
                已显示前 {SEAT_CAP} 个（共 {seatList.length} 个）
              </span>
            ) : null}
          </div>
          {/* 座位网格：flex-wrap，窄窗口自动换行不横向溢出 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {gridSeats.map((s) => (
              <SeatCell key={s.id} seat={s} busy={busySeat !== null} onPick={pickSeat} />
            ))}
          </div>
        </Card>
      ) : null}

      {/* 点选座位后的确认条 */}
      {pendingSeat ? (
        <Card
          style={{
            marginTop: 12,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 13 }}>
            预约座位 <b>{pendingSeat.zhName}</b>
            （{pendingSeat.zhNameTrace}，{dateChoice === 0 ? "今天" : "明天"}）？须在预约开始后 30 分钟内完成签到
          </span>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            style={{ height: 28 }}
            disabled={busySeat !== null}
            onClick={() => void book(pendingSeat)}
          >
            {busySeat !== null ? "预约中…" : "确认预约"}
          </button>
          <button className="btn" style={{ height: 28 }} onClick={() => setPendingSeat(null)}>
            取消
          </button>
        </Card>
      ) : null}

      {bookError ? <ErrorNote text={bookError} /> : null}

      {action ? (
        <Card style={{ marginTop: 12 }}>
          <span className={action.ok ? "" : "t-red"} style={{ fontSize: 13 }}>
            {action.text}
          </span>
        </Card>
      ) : null}

      <SectionHead
        title="我的预约"
        aside="座位预约记录"
      />
      {recState === "loading" ? <SkeletonRows rows={2} /> : null}
      {recState === "error" ? (
        <ErrorNote
          text={recError ?? ""}
          onRetry={() => {
            recRecover.current = 0;
            void loadRecords();
          }}
        />
      ) : null}
      {recState === "ready" && (records ?? []).length === 0 ? (
        <Card>
          <Empty text="暂无预约记录。" />
        </Card>
      ) : null}
      {recState === "ready" && (records ?? []).length > 0 ? (
        <Card className="list">
          {(records ?? []).map((r, i) => (
            <div className="row" key={`${r.id}-${i}`}>
              <div className="row-main">
                <div className="row-title">{r.pos || r.id || "预约"}</div>
                <div className="row-sub">
                  {r.time || "–"}
                  {r.status ? ` · ${r.status}` : ""}
                </div>
              </div>
              <div className="row-amount">
                {r.delId ? (
                  <button className="btn" style={{ height: 28 }} onClick={() => void cancel(r)}>
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}
