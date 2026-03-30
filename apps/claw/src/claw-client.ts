/**
 * ClawClient — OpenClaw 连接 Room Server 的 WebSocket 客户端
 *
 * 职责：
 * 1. 连接 Room Server 并完成握手（CLAW_JOIN → JOIN_ACK）
 * 2. 接收任务分配，转发给本地 TaskRunner 执行
 * 3. 上报任务进度和结果
 * 4. 接收 Spec 变更、Room 事件等广播
 */
import WebSocket from "ws";
import { EventEmitter } from "events";
import type {
  ClawHandshake,
  JoinAck,
  JoinReject,
  ClawIdentity,
  ClawCapability,
  RoomState,
} from "./types.js";
import type { ClawEvent } from "./types.js";

export interface ClawClientOptions {
  /** Room Server WebSocket URL (e.g. ws://localhost:9876) */
  serverUrl: string;
  /** 认证 token */
  authToken: string;
  /** OpenClaw 身份信息 */
  identity: ClawIdentity;
  /** 要加入的房间 ID（空 = 默认房间） */
  roomId?: string;
  /** 自动重连 */
  autoReconnect?: boolean;
  /** 重连间隔 (ms) */
  reconnectInterval?: number;
}

export interface ClawClientEvents {
  connected: [RoomState];
  disconnected: [string];  // reason
  rejected: [string];      // reason
  event: [ClawEvent];
  error: [Error];
}

export class ClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: ClawClientOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _roomState: RoomState | null = null;

  get connected(): boolean { return this._connected; }
  get roomState(): RoomState | null { return this._roomState; }

  constructor(options: ClawClientOptions) {
    super();
    this.options = {
      autoReconnect: true,
      reconnectInterval: 3000,
      ...options,
    };
  }

  /** 连接到 Room Server */
  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    const url = `${this.options.serverUrl}/claw`;
    console.log(`[ClawClient] Connecting to ${url}...`);

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("[ClawClient] WebSocket connected, sending handshake...");
      this.sendHandshake();
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        console.error("[ClawClient] Failed to parse message:", err);
      }
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason.toString() || `code=${code}`;
      console.log(`[ClawClient] Disconnected: ${reasonStr}`);
      this._connected = false;
      this.emit("disconnected", reasonStr);

      if (this.options.autoReconnect && code !== 4000) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err: Error) => {
      console.error("[ClawClient] WebSocket error:", err.message);
      this.emit("error", err);
    });
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(4000, "client disconnect");
      this.ws = null;
    }
    this._connected = false;
  }

  /** 发送命令到 Room Server */
  send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[ClawClient] Cannot send — not connected");
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  /** 上报任务状态 */
  reportTaskProgress(taskId: string, status: string, output?: string): void {
    this.send({
      type: "TASK_UPDATE",
      roomId: this._roomState?.roomId,
      taskId,
      status,
      output,
    });
  }

  /** 上报 Claw 状态变更 */
  reportStatus(status: string): void {
    this.send({
      type: "CLAW_STATUS_REPORT",
      clawId: this.options.identity.clawId,
      status,
    });
  }

  // ── Private ──────────────────────────────────────────

  private sendHandshake(): void {
    const { identity, authToken, roomId } = this.options;
    const handshake: ClawHandshake = {
      type: "CLAW_JOIN",
      clawId: identity.clawId,
      name: identity.name,
      owner: identity.owner,
      backend: identity.backend,
      capabilities: identity.capabilities as ClawCapability[],
      personality: identity.personality,
      palette: identity.palette,
      model: identity.model,
      roomId,
      authToken,
    };
    this.send(handshake as unknown as Record<string, unknown>);
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "JOIN_ACK": {
        const ack = msg as unknown as JoinAck;
        this._connected = true;
        this._roomState = ack.roomState;
        console.log(`[ClawClient] Joined room "${ack.roomId}" as ${ack.role}`);
        this.emit("connected", ack.roomState);
        break;
      }
      case "JOIN_REJECT": {
        const reject = msg as unknown as JoinReject;
        console.error(`[ClawClient] Join rejected: ${reject.reason}`);
        this.emit("rejected", reject.reason);
        // 4000 = intentional close, don't reconnect
        this.ws?.close(4000);
        break;
      }
      default: {
        // 所有其他消息作为事件转发
        this.emit("event", msg as unknown as ClawEvent);
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const interval = this.options.reconnectInterval ?? 3000;
    console.log(`[ClawClient] Reconnecting in ${interval}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, interval);
  }
}
