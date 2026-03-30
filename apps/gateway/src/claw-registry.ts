/**
 * ClawRegistry — 统一管理本地 spawn 和远程 WebSocket 连入的 OpenClaw
 *
 * 设计原则:
 * - LocalClaw: 现有 AgentSession spawn() 方式，完全兼容
 * - RemoteClaw: 远程 OpenClaw 通过 WS 连入
 * - 对上层（RoomManager / Orchestrator）暴露统一接口
 */
import { WebSocket } from "ws";
import { nanoid } from "nanoid";
import type {
  ClawState,
  ClawIdentity,
  ClawHandshake,
  ClawStatus,
  ClawRole,
  ClawCapability,
  ClawEvent,
} from "@office/shared";

// ---------------------------------------------------------------------------
// ClawConnection — 抽象连接接口
// ---------------------------------------------------------------------------

export interface ClawConnection {
  readonly clawId: string;
  readonly name: string;
  readonly owner: string;
  readonly backend: string;
  readonly capabilities: ClawCapability[];
  readonly isLocal: boolean;
  role: ClawRole;
  status: ClawStatus;
  palette?: number;
  roomId?: string;

  /** 向该 Claw 发送事件 */
  send(event: ClawEvent | Record<string, unknown>): void;

  /** 断开连接 */
  disconnect(reason?: string): void;

  /** 转换为状态快照 */
  toState(): ClawState;
}

// ---------------------------------------------------------------------------
// RemoteClaw — 通过 WebSocket 连入的远程 OpenClaw
// ---------------------------------------------------------------------------

export class RemoteClaw implements ClawConnection {
  readonly clawId: string;
  readonly name: string;
  readonly owner: string;
  readonly backend: string;
  readonly capabilities: ClawCapability[];
  readonly isLocal = false;
  role: ClawRole;
  status: ClawStatus = "idle";
  palette?: number;
  roomId?: string;
  readonly connectedAt: number;

  private ws: WebSocket;

  constructor(ws: WebSocket, handshake: ClawHandshake, role: ClawRole) {
    this.ws = ws;
    this.clawId = handshake.clawId;
    this.name = handshake.name;
    this.owner = handshake.owner;
    this.backend = handshake.backend;
    this.capabilities = handshake.capabilities ?? [];
    this.palette = handshake.palette;
    this.role = role;
    this.connectedAt = Date.now();
  }

  send(event: ClawEvent | Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  disconnect(reason?: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, reason ?? "kicked");
    }
  }

  toState(): ClawState {
    return {
      clawId: this.clawId,
      name: this.name,
      owner: this.owner,
      backend: this.backend,
      capabilities: this.capabilities,
      role: this.role,
      status: this.status,
      isLocal: false,
      roomId: this.roomId,
      palette: this.palette,
      connectedAt: this.connectedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// LocalClaw — 本地 spawn 的 Agent（兼容现有 AgentSession）
// ---------------------------------------------------------------------------

export class LocalClaw implements ClawConnection {
  readonly clawId: string;
  readonly name: string;
  readonly owner: string;
  readonly backend: string;
  readonly capabilities: ClawCapability[];
  readonly isLocal = true;
  role: ClawRole;
  status: ClawStatus = "idle";
  palette?: number;
  roomId?: string;
  workDir?: string;
  pid?: number;

  /** 对应的原始 agentId（桥接现有 Orchestrator） */
  readonly agentId: string;

  /** 事件回调（替代 WebSocket send） */
  private eventHandler: ((event: ClawEvent | Record<string, unknown>) => void) | null = null;

  constructor(opts: {
    agentId: string;
    name: string;
    backend: string;
    role: ClawRole;
    palette?: number;
    capabilities?: ClawCapability[];
    workDir?: string;
  }) {
    this.agentId = opts.agentId;
    this.clawId = `local-${opts.agentId}`;
    this.name = opts.name;
    this.owner = "local";
    this.backend = opts.backend;
    this.capabilities = opts.capabilities ?? ["code"];
    this.role = opts.role;
    this.palette = opts.palette;
    this.workDir = opts.workDir;
  }

  /** 注册事件处理器（本地 claw 通过回调接收事件） */
  onEvent(handler: (event: ClawEvent | Record<string, unknown>) => void): void {
    this.eventHandler = handler;
  }

  send(event: ClawEvent | Record<string, unknown>): void {
    this.eventHandler?.(event);
  }

  disconnect(_reason?: string): void {
    // LocalClaw 断开 = kill 子进程（由 Orchestrator 处理）
    this.status = "offline";
  }

  toState(): ClawState {
    return {
      clawId: this.clawId,
      name: this.name,
      owner: this.owner,
      backend: this.backend,
      capabilities: this.capabilities,
      role: this.role,
      status: this.status,
      isLocal: true,
      roomId: this.roomId,
      palette: this.palette,
      pid: this.pid,
    };
  }
}

// ---------------------------------------------------------------------------
// ClawRegistry — 统一管理
// ---------------------------------------------------------------------------

export class ClawRegistry {
  private claws = new Map<string, ClawConnection>();

  /** agentId → clawId 映射（兼容现有系统） */
  private agentToClawId = new Map<string, string>();

  /** 注册远程 Claw */
  registerRemote(ws: WebSocket, handshake: ClawHandshake, role: ClawRole): RemoteClaw {
    const claw = new RemoteClaw(ws, handshake, role);
    this.claws.set(claw.clawId, claw);
    console.log(`[ClawRegistry] Remote claw registered: ${claw.name} (${claw.clawId}) from ${claw.owner}`);
    return claw;
  }

  /** 注册本地 Claw（从现有 Agent 桥接） */
  registerLocal(opts: ConstructorParameters<typeof LocalClaw>[0]): LocalClaw {
    const claw = new LocalClaw(opts);
    this.claws.set(claw.clawId, claw);
    this.agentToClawId.set(opts.agentId, claw.clawId);
    console.log(`[ClawRegistry] Local claw registered: ${claw.name} (${claw.clawId})`);
    return claw;
  }

  /** 注销 Claw */
  unregister(clawId: string): void {
    const claw = this.claws.get(clawId);
    if (!claw) return;

    if (claw instanceof LocalClaw) {
      this.agentToClawId.delete(claw.agentId);
    }

    this.claws.delete(clawId);
    console.log(`[ClawRegistry] Claw unregistered: ${claw.name} (${clawId})`);
  }

  /** 通过 clawId 获取 */
  get(clawId: string): ClawConnection | undefined {
    return this.claws.get(clawId);
  }

  /** 通过原始 agentId 获取（兼容层） */
  getByAgentId(agentId: string): LocalClaw | undefined {
    const clawId = this.agentToClawId.get(agentId);
    if (!clawId) return undefined;
    const claw = this.claws.get(clawId);
    return claw instanceof LocalClaw ? claw : undefined;
  }

  /** 获取所有 Claw */
  getAll(): ClawConnection[] {
    return Array.from(this.claws.values());
  }

  /** 获取房间内的所有 Claw */
  getByRoom(roomId: string): ClawConnection[] {
    return this.getAll().filter(c => c.roomId === roomId);
  }

  /** 获取所有远程 Claw */
  getRemote(): RemoteClaw[] {
    return this.getAll().filter((c): c is RemoteClaw => !c.isLocal);
  }

  /** 获取所有本地 Claw */
  getLocal(): LocalClaw[] {
    return this.getAll().filter((c): c is LocalClaw => c.isLocal);
  }

  /** 向房间内所有 Claw 广播事件 */
  broadcastToRoom(roomId: string, event: ClawEvent | Record<string, unknown>, excludeClawId?: string): void {
    for (const claw of this.getByRoom(roomId)) {
      if (claw.clawId !== excludeClawId) {
        claw.send(event);
      }
    }
  }

  /** 总数 */
  get size(): number {
    return this.claws.size;
  }
}
