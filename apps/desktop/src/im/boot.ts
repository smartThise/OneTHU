/**
 * IM 通道装配与生命周期（App 挂载时调用一次，无后端主案 §2）。
 *
 * App 常驻 = bot 在线：启动时按配置（enabled + 凭据齐备）自动连接；
 * 设置页保存/开关后调 syncChannels() 增量启停（配置即真相，不重启 App）。
 * 适配器只在 boot 装配（设置页打开不拉起全部协议代码）。
 */
import { configSnapshot, loadImConfig, type ImConfig } from "./store.js";
import { getAdapter, isChannelRunning, registerAdapter, startChannel, stopChannel } from "./registry.js";
import { feishuChannel } from "./feishu.js";
import { WechatChannel } from "./wechat.js";
import { ILINK_API_BASE } from "./wechatProto.js";
import { logLine } from "../lib/clients.js";
import type { ChannelId } from "./types.js";

const ORDER: ChannelId[] = ["feishu", "wechat"];

let booted = false;

export async function bootIm(): Promise<void> {
  if (booted) return;
  booted = true;
  registerAdapter(feishuChannel);
  registerAdapter(new WechatChannel(() => {
    const c = configSnapshot();
    const w = c?.channels.wechat;
    return w?.botToken ? { token: w.botToken, baseUrl: w.baseUrl || ILINK_API_BASE } : null;
  }));
  try {
    await syncChannels(); // 内部先 loadImConfig 填充快照（probe 依赖）
  } catch (e) {
    void logLine(`[IM] 启动异常：${String(e).slice(0, 160)}`);
  }
}

/** 配置变更后同步启停（幂等；只对「已注册 + 已启用 + 凭据齐备」的通道动作） */
export async function syncChannels(): Promise<void> {
  const cfg = await loadImConfig();
  for (const id of ORDER) {
    if (!getAdapter(id)) continue; // 未实现的通道（wechat）静默跳过，UI 如实标注
    const want = cfg.enabled[id] && credsReady(cfg, id);
    const running = isChannelRunning(id);
    if (want && !running) {
      try {
        await startChannel(id);
      } catch (e) {
        void logLine(`[IM] ${id} 连接失败：${String(e).slice(0, 160)}`); // status 已记 error，UI 可读
      }
    } else if (!want && running) {
      await stopChannel(id);
    }
  }
}

function credsReady(cfg: ImConfig, id: ChannelId): boolean {
  if (id === "feishu") {
    const c = cfg.channels.feishu;
    return Boolean(c?.appId && c?.appSecret);
  }
  const c = cfg.channels.wechat;
  return Boolean(c?.botToken);
}
