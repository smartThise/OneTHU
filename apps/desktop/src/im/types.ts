/**
 * IM 多通道模块（无后端主案，docs/im-cloud/00-architecture.md）：
 * 通道适配器跑在宿主 TS 层，App 常驻=bot 在线；入站经 OH 的 chat 命令
 * （callRust → sidecar run）拿到回复后原路发回——零 harness 改动。
 *
 * 本文件：跨适配器的统一消息/通道模型（core 持策略，适配器持平台翻译）。
 */

/** 通道 id（与配置键一致；新通道须同步 registry 注册表） */
export type ChannelId = "feishu" | "wechat";

/** 通道运行状态（UI 与重连策略共用） */
export type ChannelPhase =
  | "off" /* 未启用/未配置 */
  | "connecting"
  | "online"
  | "reconnecting"
  | "suspended" /* 平台风控暂停（如微信 -14：1 小时） */
  | "error";

export interface ChannelStatus {
  phase: ChannelPhase;
  /** 给用户看的一句话（连接中/最近错误/暂停恢复时间…），可为空 */
  note: string;
  /** 最近一次收到消息的时间戳（0=从未） */
  lastInboundAt: number;
  /** 最近一次成功外发的时间戳 */
  lastOutboundAt: number;
  at: number;
}

/** 入站消息的统一形状（各平台事件在此收敛） */
export interface InboundMessage {
  /** 平台事件唯一 ID——幂等去重键（at-least-once 投递下的硬要求） */
  eventId: string;
  channel: ChannelId;
  /** 平台侧发送者稳定 ID（飞书 open_id / 微信 ilink_user_id） */
  sender: string;
  /** 平台侧会话引用：首版仅单聊（peer 即发送者） */
  chat: { kind: "dm"; id: string };
  text: string;
  /** P0 首版：文本通道先行；附件随 M3 接云盘管线，先带上原始引用 */
  attachments: Array<{
    kind: "image" | "file" | "audio" | "video";
    name: string;
    /** 平台原始引用（file_key / media 引用等），由适配器自解释 */
    ref: unknown;
    messageId: string;
  }>;
  ts: number;
}

/** 通道适配器统一接口（core 持策略：安全校验/绑定/OH 对接都在 registry，不进适配器） */
export interface ChannelAdapter {
  readonly id: ChannelId;
  readonly label: string;
  /** 只读诊断：不建立连接，返回能否启动 + 缺什么 */
  probe(): { configured: boolean; missing: string };
  /** 建立连接并开始收发；resolve 于「通道已就绪」，连接维持由适配器自愈 */
  start(onInbound: (msg: InboundMessage) => void): Promise<void>;
  /** 回复某条入站消息（适配器内部处理平台上下文/分片/限速/重试） */
  send(orig: InboundMessage, text: string): Promise<void>;
  /** 停止并释放（幂等） */
  stop(): Promise<void>;
}

/** OH chat run 的应答形状（与 ChatDock 消费的同一份契约） */
export interface OhChatResult {
  answer?: string;
  error?: string;
  confirm?: { summary?: string } | null;
}
