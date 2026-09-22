/**
 * 外部作业源「登录雨课堂」通道弹窗（R11 16.3）。
 *
 * 新手指引横幅的主按钮弹出本 modal，登录通道为微信 / 雨豆APP 扫码
 * （复用 core 的 runYuketangQrLogin 状态机）。
 * R17 23.2：官方登录页发短信前先取图形验证码（TencentCaptcha/hCaptcha），无法内嵌
 * → 停用「手机验证码」通道（置灰 + 说明），文案指向扫码。
 *
 * UI 参考「校园卡充值」弹窗（pages/info/CardTab.tsx RechargeDialog）的遮罩 / 卡片 /
 * 通道单选布局：同一套 mask/panel 视觉与按钮层级，降低新用户认知成本。
 * 登录成功即合并写入凭据（保留其他源）并触发刷新；不涉及任何外部作业拉取逻辑。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { YktQrPhase } from "@onethu/core";
import { ensureExtHwCredsLoaded, extHwLogin, refreshExtHw, saveExtHwCreds } from "../state/exthw.js";
import { bindQrKeepAlive, createQrKeepAlive } from "../lib/qrKeepAlive.js";
import type { QrKeepAliveController } from "../lib/qrKeepAlive.js";
import {
  YKT_WEB_FALLBACK_HINT,
  YKT_WEB_LOGIN_AVAILABLE,
  closeYuketangWebLogin,
  isAndroidHost,
  onYuketangWebCookie,
  openYuketangWebLogin,
  readYuketangWebCookies,
} from "../lib/yktWebview.js";

/** 与 CardTab 充值弹窗同款遮罩 / 面板（移动端也留出 24px 边距、限高可滚动） */
const maskStyle: React.CSSProperties = { animation: "m-fade var(--dur-2) var(--ease-out) both", position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panelStyle: React.CSSProperties = { animation: "m-spring-in var(--dur-3) var(--ease-out) both", width: "100%", maxWidth: 380, maxHeight: "78vh", overflowY: "auto", background: "var(--surface, #ffffff)", color: "var(--text-1, #1f2329)", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)", padding: "16px 18px" };

type YktChannel = "qr" | "web" | "sms";

/** R17 23.2：短信通道停用说明（与设置页文案一致） */
const YKT_SMS_DISABLED_NOTE = "雨课堂已启用图形验证码，短信登录暂不可用，请用微信扫码。";

const YKT_CHANNELS: Array<{ key: YktChannel; label: string; hint: string; disabled?: boolean }> = [
  { key: "qr", label: "微信扫码", hint: "打开微信或雨豆APP 扫描二维码" },
  // R18b 25.3.2：桌面端原生 WebView 窗口实测卡死，隐藏该入口（二维码在桌面可用）；
  // 仅 Android 应用内全屏 WebView 保留官方网页登录。
  ...(YKT_WEB_LOGIN_AVAILABLE
    ? [{ key: "web" as const, label: "官方网页登录", hint: "支持扫码 / 手机号 + 图形验证码 + 短信（应用内网页）" }]
    : []),
  { key: "sms", label: "手机验证码", hint: YKT_SMS_DISABLED_NOTE, disabled: true },
];

/** 合并写入雨课堂凭据（保留 TUOJ/Tyche 等既有配置）后刷新 */
async function saveYuketang(cookie: string): Promise<void> {
  const c = await ensureExtHwCredsLoaded();
  await saveExtHwCreds({
    ...c,
    yuketang: { ...(c.yuketang ?? {}), cookie },
  });
  void refreshExtHw();
}

/** 雨课堂扫码登录面板（微信 / 雨豆APP）——与设置页共用同一实现 */
export function YktQrPanel({ onSuccess, onCancel }: { onSuccess: (cookie: string) => void; onCancel: () => void }) {
  const [qr, setQr] = useState<{ qrContent: string; expireAt: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "waiting" | "expired" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // R18c：保活是否生效 → 切换提示文案（仅 Android 可能为 true）
  const [keepAliveOn, setKeepAliveOn] = useState(false);
  const runId = useRef(0);
  // onSuccess 由父组件内联传入、每次渲染都会变 —— 用 ref 固定，避免 effect 反复重启
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  // R18c：保活控制器只建一次（跨刷新/重挂载复用，幂等由控制器内部保证）
  const keepAliveRef = useRef<QrKeepAliveController | null>(null);
  if (keepAliveRef.current === null) {
    keepAliveRef.current = createQrKeepAlive({
      isAndroid: isAndroidHost,
      invoke: (cmd) => invoke(cmd),
      onStatus: setKeepAliveOn,
    });
  }

  // R17b 24.1：本 effect 只依赖 nonce（手动刷新）——**不监听回前台 / visibilitychange**，
  // 因为重建 = 换 token = 已扫的码作废。退后台被掐断的长轮询由 core 用同一 token 自动重发，
  // 回前台后继续即可取回已确认的登录。
  // R18c：二维码就绪（qr）→ 启动前台服务保活；成功 / 取消 / 过期 / 卸载 → 停止。
  useEffect(() => {
    const id = ++runId.current;
    const ctrl = new AbortController();
    const keepAlive = bindQrKeepAlive(keepAliveRef.current!);
    setStatus("loading");
    setErr(null);
    setQr(null);
    void extHwLogin
      .yuketangQr({
        signal: ctrl.signal,
        onPhase: (p: YktQrPhase) => {
          if (id !== runId.current) return;
          keepAlive.onPhase(p.phase);
          if (p.phase === "qr") {
            setQr({ qrContent: p.qrContent, expireAt: p.expireAt });
            setStatus("waiting");
          } else if (p.phase === "expired") {
            setStatus("expired");
          }
        },
      })
      .then((r) => {
        if (id !== runId.current || r.aborted) return;
        keepAlive.stop(); // 成功 / 报错收口（成功时立刻停，不等卸载）
        if (r.done && r.cookie) {
          onSuccessRef.current(r.cookie);
          return;
        }
        setStatus("error");
        setErr(r.message ?? "登录未完成");
      });
    return () => {
      // 卸载 / 刷新 / 取消：中止长轮询 + 停保活，不留悬挂请求与通知
      ctrl.abort();
      keepAlive.stop();
    };
  }, [nonce]);

  const handleCancel = () => {
    // 取消：先停保活再交给父组件（父组件通常随即卸载本面板）
    void keepAliveRef.current?.stop();
    onCancel();
  };

  const statusText =
    status === "loading"
      ? "正在获取二维码…"
      : status === "expired"
        ? "二维码已过期，正在刷新…"
        : status === "error"
          ? null
          : "请用微信或雨豆APP 扫描二维码";

  const hintStyle: React.CSSProperties = {
    fontSize: 12,
    lineHeight: 1.6,
    marginTop: 8,
    padding: "6px 8px",
    borderRadius: 8,
    background: "rgba(26,111,212,0.08)",
    color: "var(--text-1, #1f2329)",
    textAlign: "left",
  };

  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        border: "1px solid var(--border, #e5e5e5)",
        borderRadius: 10,
        background: "var(--surface-2, rgba(0,0,0,0.02))",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {qr ? (
          <div style={{ background: "#fff", display: "inline-block", padding: 10, borderRadius: 10 }}>
            <QRCodeSVG value={qr.qrContent} size={176} level="M" />
          </div>
        ) : (
          <div
            style={{
              width: 196,
              height: 196,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
              borderRadius: 10,
              color: "var(--text-2)",
            }}
          >
            {status === "error" ? "—" : "加载中…"}
          </div>
        )}
        {statusText ? <div style={{ fontSize: 13, marginTop: 8 }}>{statusText}</div> : null}
        {qr && status === "waiting" ? (
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>二维码约 5 分钟有效，过期自动刷新</div>
        ) : null}
        {/* R18b 25.3.3：本机扫码会切走 App，MIUI/HyperOS 冻结进程会掐断长轮询导致确认丢失。
            R18c：Android 前台服务保活生效后改为「本机扫码也可用」提示；未生效（非 Android /
            权限被拒）保留「另一台设备」引导。 */}
        {keepAliveOn ? (
          <div style={hintStyle}>
            已开启<b>扫码保活</b>：本机扫码也可用（切到微信期间请勿清理通知）。
          </div>
        ) : (
          <div style={hintStyle}>
            建议用<b>另一台设备</b>（平板 / 电脑微信）扫码，并<b>保持本页在前台</b>；
            本机扫码会切走 App，可能被系统冻结导致登录失败。
          </div>
        )}
        {err ? <div style={{ color: "var(--red, #c04848)", fontSize: 12, marginTop: 8 }}>{err}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
        <button className="btn" onClick={() => setNonce((n) => n + 1)}>
          刷新二维码
        </button>
        <button className="btn btn-ghost" onClick={handleCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

/**
 * R18 24.2：雨课堂「官方网页登录」面板（应用内 WebView，支持扫码 / 短信）。
 * 挂载即打开官方登录窗口；用户完成登录后点「我已登录，读取会话」读回 Cookie；
 * 读不到时明确提示回退「高级：手动粘贴 Cookie」。
 */

/** 当前挂载的官方登录面板数（React StrictMode 会「挂载→清理→再挂载」，
 *  用计数 + 延后一拍避免把刚打开的窗口误关）。 */
let yktWebPanels = 0;

export function YktWebLoginPanel({ onSuccess, onCancel }: { onSuccess: (cookie: string) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<"opening" | "ready" | "reading">("opening");
  const [err, setErr] = useState<string | null>(null);
  // 成功读回后由 onSuccess 关闭本面板；标记避免卸载清理把已关窗口再关一次（幂等，仅省一次调用）
  const doneRef = useRef(false);
  // onSuccess 由父组件内联传入、每次渲染都会变 —— 用 ref 固定给异步回调
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    yktWebPanels++;
    // 桌面端：窗口内注入按钮经 document.title 回传 → Rust 后台读回后 emit `ykt-cookie`
    void onYuketangWebCookie((cookie) => {
      if (!alive) return;
      doneRef.current = true;
      onSuccessRef.current(cookie);
    }).then((off) => {
      if (alive) unlisten = off;
      else off();
    });
    void openYuketangWebLogin()
      .then((cookie) => {
        if (!alive) return;
        // Android 全屏 Dialog 内的「我已登录，读取会话」直接带回会话；直接关闭则 null
        if (cookie) {
          doneRef.current = true;
          onSuccessRef.current(cookie);
          return;
        }
        setPhase("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setPhase("ready");
        setErr(`打开登录窗口失败：${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      alive = false;
      unlisten?.();
      yktWebPanels = Math.max(0, yktWebPanels - 1);
      // 延后一拍：StrictMode 清理后立即再挂载时，计数已 >0，不再关窗
      setTimeout(() => {
        if (yktWebPanels === 0 && !doneRef.current) void closeYuketangWebLogin();
      }, 0);
    };
  }, []);

  const read = (): void => {
    setPhase("reading");
    setErr(null);
    void readYuketangWebCookies()
      .then((cookie) => {
        doneRef.current = true;
        void closeYuketangWebLogin();
        onSuccess(cookie);
      })
      .catch((e: unknown) => {
        setPhase("ready");
        setErr(`${e instanceof Error ? e.message : String(e)}\n${YKT_WEB_FALLBACK_HINT}`);
      });
  };

  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        border: "1px solid var(--border, #e5e5e5)",
        borderRadius: 10,
        background: "var(--surface-2, rgba(0,0,0,0.02))",
      }}
    >
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        已打开官方登录窗口，请在其中完成<b>微信扫码</b>，或<b>手机号 + 图形验证码 + 短信验证码</b>登录。
        <br />
        登录成功后回到本页，点击「我已登录，读取会话」。
      </div>
      {err ? (
        <div style={{ color: "var(--red, #c04848)", fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{err}</div>
      ) : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={phase === "reading"} onClick={read}>
          {phase === "reading" ? "读取中…" : "我已登录，读取会话"}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export function ExtHwLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [channel, setChannel] = useState<YktChannel>("qr");
  if (!open) return null;

  return createPortal(
    <div style={maskStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <b>登录雨课堂</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {YKT_CHANNELS.map((c) => (
            <label
              key={c.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: c.disabled ? "not-allowed" : "pointer",
                fontSize: 13,
                opacity: c.disabled ? 0.5 : 1,
              }}
            >
              <input
                type="radio"
                name="ykt-channel"
                checked={channel === c.key}
                disabled={c.disabled}
                onChange={() => setChannel(c.key)}
              />
              <span>
                <b>{c.label}</b>
                <span style={{ opacity: 0.6 }}> · {c.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {channel === "web" ? (
          <YktWebLoginPanel
            onCancel={onClose}
            onSuccess={(cookie) => {
              void saveYuketang(cookie).then(onClose);
            }}
          />
        ) : (
          <YktQrPanel
            onCancel={onClose}
            onSuccess={(cookie) => {
              void saveYuketang(cookie).then(onClose);
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
