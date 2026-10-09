/**
 * 飞书「长连接事件订阅」WS 帧编解码——手写 protobuf wire 格式。
 *
 * 依据官方 SDK 的 pbbp2.proto（larksuite/oapi-sdk-python ws/pb/pbbp2_pb2.py，
 * proto2 语法）逐字段实现，避免为此引入 protobuf 运行时依赖：
 *
 *   message Header { required string key = 1; required string value = 2; }
 *   message Frame {
 *     required uint64 SeqID = 1;
 *     required uint64 LogID = 2;
 *     required int32  service = 3;
 *     required int32  method = 4;        // FrameType: CONTROL=0 / DATA=1
 *     repeated Header headers = 5;
 *     optional string payload_encoding = 6;
 *     optional string payload_type = 7;
 *     optional bytes  payload = 8;
 *     optional string LogIDNew = 9;
 *   }
 *
 * 头键名与消息类型（官方 ws/const.py + ws/enum.py）：
 *   type / message_id / sum / seq / trace_id / biz_rt；
 *   type ∈ { "event" | "card" | "ping" | "pong" }。
 */

export const FEISHU_FRAME_CONTROL = 0;
export const FEISHU_FRAME_DATA = 1;

export interface WsHeader {
  key: string;
  value: string;
}

export interface WsFrame {
  seqId: number;
  logId: number;
  service: number;
  method: number;
  headers: WsHeader[];
  payload?: Uint8Array;
}

export function headerOf(frame: WsFrame, key: string): string | undefined {
  for (const h of frame.headers) if (h.key === key) return h.value;
  return undefined;
}

/* ── wire 基元 ── */

const enc = new TextEncoder();
const dec = new TextDecoder();

function writeVarint(out: number[], v: number): void {
  let n = v;
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function writeBytesField(out: number[], fieldNo: number, bytes: Uint8Array | string): void {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  writeVarint(out, (fieldNo << 3) | 2);
  writeVarint(out, b.length);
  for (let i = 0; i < b.length; i++) out.push(b[i]!);
}

function writeVarintField(out: number[], fieldNo: number, v: number): void {
  writeVarint(out, fieldNo << 3);
  writeVarint(out, v);
}

class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  eof(): boolean {
    return this.pos >= this.buf.length;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error("protobuf: varint 越界");
      const b = this.buf[this.pos++]!;
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) throw new Error("protobuf: varint 过长");
    }
  }
  bytes(): Uint8Array {
    const len = this.varint();
    const start = this.pos;
    const end = start + len;
    if (end > this.buf.length) throw new Error("protobuf: bytes 越界");
    this.pos = end;
    return this.buf.slice(start, end);
  }
  string(): string {
    return dec.decode(this.bytes());
  }
  skip(wireType: number): void {
    if (wireType === 0) this.varint();
    else if (wireType === 2) this.bytes();
    else if (wireType === 5) this.pos += 4;
    else if (wireType === 1) this.pos += 8;
    else throw new Error(`protobuf: 未知 wire type ${wireType}`);
  }
}

/* ── Frame 编解码 ── */

export function encodeFrame(f: WsFrame): Uint8Array {
  const out: number[] = [];
  // proto2 required 字段：官方客户端恒写 0/默认值，保持同构
  writeVarintField(out, 1, f.seqId);
  writeVarintField(out, 2, f.logId);
  writeVarintField(out, 3, f.service);
  writeVarintField(out, 4, f.method);
  for (const h of f.headers) {
    const hOut: number[] = [];
    writeBytesField(hOut, 1, h.key);
    writeBytesField(hOut, 2, h.value);
    writeBytesField(out, 5, new Uint8Array(hOut));
  }
  if (f.payload) writeBytesField(out, 8, f.payload);
  return new Uint8Array(out);
}

export function decodeFrame(buf: Uint8Array): WsFrame {
  const r = new Reader(buf);
  const frame: WsFrame = { seqId: 0, logId: 0, service: 0, method: 0, headers: [] };
  while (!r.eof()) {
    const tag = r.varint();
    const fieldNo = Math.floor(tag / 8);
    const wireType = tag % 8;
    switch (fieldNo) {
      case 1:
        frame.seqId = r.varint();
        break;
      case 2:
        frame.logId = r.varint();
        break;
      case 3:
        frame.service = r.varint();
        break;
      case 4:
        frame.method = r.varint();
        break;
      case 5: {
        const h = new Reader(r.bytes());
        const header: WsHeader = { key: "", value: "" };
        while (!h.eof()) {
          const hTag = h.varint();
          const hField = Math.floor(hTag / 8);
          if (hField === 1) header.key = h.string();
          else if (hField === 2) header.value = h.string();
          else h.skip(hTag % 8);
        }
        frame.headers.push(header);
        break;
      }
      case 6: // payload_encoding：未用，跳过
      case 7: // payload_type：未用，跳过
        r.skip(wireType);
        break;
      case 8:
        frame.payload = r.bytes();
        break;
      case 9: // LogIDNew：未用，跳过
        r.skip(wireType);
        break;
      default:
        r.skip(wireType); // 未知字段（前向兼容）
        break;
    }
  }
  return frame;
}

/** ping 控制帧（官方客户端同款：service=连接 service_id，序号 0） */
export function pingFrame(serviceId: number): Uint8Array {
  return encodeFrame({
    seqId: 0,
    logId: 0,
    service: serviceId,
    method: FEISHU_FRAME_CONTROL,
    headers: [{ key: "type", value: "ping" }],
  });
}
