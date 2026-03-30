/**
 * RoomManager — 管理 Room 生命周期
 *
 * 职责：
 * 1. 创建/销毁房间
 * 2. 管理 Claw 加入/离开房间
 * 3. 维护房间内的 OpenSpec 工作流状态
 * 4. 生成邀请码
 */
import { nanoid } from "nanoid";
import type {
  RoomState,
  RoomConfig,
  SpecPhase,
  RoomInvite,
  ClawRole,
  ClawEvent,
} from "@office/shared";
import { ClawRegistry, type ClawConnection } from "./claw-registry.js";

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export interface Room {
  roomId: string;
  name: string;
  owner: string;
  specPhase: SpecPhase | null;
  specDir: string | null;
  projectDir: string | null;
  config: RoomConfig;
  createdAt: number;
  invites: Map<string, RoomInvite>;
}

// ---------------------------------------------------------------------------
// RoomManager
// ---------------------------------------------------------------------------

export class RoomManager {
  private rooms = new Map<string, Room>();
  private clawRegistry: ClawRegistry;

  /** 默认房间 ID — 向后兼容，现有功能自动在此房间内 */
  readonly defaultRoomId: string;

  constructor(clawRegistry: ClawRegistry) {
    this.clawRegistry = clawRegistry;

    // 自动创建默认房间
    this.defaultRoomId = "default";
    this.createRoom("system", "Default Room");
  }

  // ── Room 生命周期 ──────────────────────────────────────

  createRoom(owner: string, name: string, config?: Partial<RoomConfig>): Room {
    const roomId = name === "Default Room" ? "default" : `room-${nanoid(6)}`;
    const room: Room = {
      roomId,
      name,
      owner,
      specPhase: null,
      specDir: null,
      projectDir: null,
      config: {
        maxClaws: config?.maxClaws ?? 20,
        autoAssign: config?.autoAssign ?? true,
        worktreeEnabled: config?.worktreeEnabled ?? true,
        autoMerge: config?.autoMerge ?? true,
      },
      createdAt: Date.now(),
      invites: new Map(),
    };
    this.rooms.set(roomId, room);
    console.log(`[RoomManager] Room created: "${name}" (${roomId}) by ${owner}`);
    return room;
  }

  destroyRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (roomId === this.defaultRoomId) {
      console.warn("[RoomManager] Cannot destroy the default room");
      return;
    }

    // 踢出所有 claw
    for (const claw of this.clawRegistry.getByRoom(roomId)) {
      claw.roomId = undefined;
      claw.send({ type: "CLAW_LEFT", roomId, clawId: claw.clawId, reason: "room_destroyed" });
    }

    this.rooms.delete(roomId);
    console.log(`[RoomManager] Room destroyed: "${room.name}" (${roomId})`);
  }

  // ── Claw 加入/离开 ──────────────────────────────────────

  joinRoom(roomId: string, claw: ClawConnection, role?: ClawRole): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.warn(`[RoomManager] Room not found: ${roomId}`);
      return false;
    }

    const clawsInRoom = this.clawRegistry.getByRoom(roomId);
    if (clawsInRoom.length >= room.config.maxClaws) {
      console.warn(`[RoomManager] Room ${roomId} is full (${room.config.maxClaws} max)`);
      return false;
    }

    claw.roomId = roomId;
    if (role) claw.role = role;

    // 广播给房间内其他成员
    this.broadcastToRoom(roomId, {
      type: "CLAW_JOINED",
      roomId,
      clawId: claw.clawId,
      name: claw.name,
      owner: claw.owner,
      backend: claw.backend,
      capabilities: claw.capabilities,
      role: claw.role,
      isLocal: claw.isLocal,
      palette: claw.palette,
    } satisfies ClawEvent, claw.clawId);

    console.log(`[RoomManager] ${claw.name} (${claw.clawId}) joined room "${room.name}" as ${claw.role}`);
    return true;
  }

  leaveRoom(roomId: string, clawId: string, reason?: string): void {
    const claw = this.clawRegistry.get(clawId);
    if (!claw || claw.roomId !== roomId) return;

    claw.roomId = undefined;

    // 广播给房间内其他成员
    this.broadcastToRoom(roomId, {
      type: "CLAW_LEFT",
      roomId,
      clawId,
      reason: reason ?? "left",
    } satisfies ClawEvent);

    console.log(`[RoomManager] ${claw.name} (${clawId}) left room ${roomId}: ${reason ?? "left"}`);
  }

  // ── 邀请码 ──────────────────────────────────────────────

  createInvite(roomId: string, role: ClawRole, maxUses = 1, expiresInMinutes = 60): RoomInvite | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const invite: RoomInvite = {
      roomId,
      code: nanoid(6).toUpperCase(),
      role,
      expiresAt: Date.now() + expiresInMinutes * 60 * 1000,
      maxUses,
      usedCount: 0,
    };
    room.invites.set(invite.code, invite);
    console.log(`[RoomManager] Invite created for room ${roomId}: ${invite.code} (role=${role}, max=${maxUses})`);
    return invite;
  }

  validateInvite(code: string): { roomId: string; role: ClawRole } | null {
    for (const room of this.rooms.values()) {
      const invite = room.invites.get(code);
      if (!invite) continue;

      if (Date.now() > invite.expiresAt) {
        room.invites.delete(code);
        return null;
      }

      if (invite.usedCount >= invite.maxUses) {
        room.invites.delete(code);
        return null;
      }

      invite.usedCount++;
      if (invite.usedCount >= invite.maxUses) {
        room.invites.delete(code);
      }

      return { roomId: invite.roomId, role: invite.role };
    }
    return null;
  }

  // ── OpenSpec 阶段管理 ──────────────────────────────────

  setSpecPhase(roomId: string, phase: SpecPhase | null, specDir?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.specPhase = phase;
    if (specDir) room.specDir = specDir;

    this.broadcastToRoom(roomId, {
      type: "SPEC_PHASE_CHANGED",
      roomId,
      phase: phase!,
      specDir: room.specDir ?? undefined,
    } satisfies ClawEvent);

    console.log(`[RoomManager] Room ${roomId} spec phase → ${phase}`);
  }

  setProjectDir(roomId: string, projectDir: string): void {
    const room = this.rooms.get(roomId);
    if (room) room.projectDir = projectDir;
  }

  // ── 查询 ──────────────────────────────────────────────

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  getRoomState(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      roomId: room.roomId,
      name: room.name,
      owner: room.owner,
      claws: this.clawRegistry.getByRoom(roomId).map(c => c.toState()),
      specPhase: room.specPhase,
      specDir: room.specDir ?? undefined,
      projectDir: room.projectDir ?? undefined,
      config: room.config,
      createdAt: room.createdAt,
    };
  }

  // ── 广播 ──────────────────────────────────────────────

  broadcastToRoom(roomId: string, event: ClawEvent | Record<string, unknown>, excludeClawId?: string): void {
    this.clawRegistry.broadcastToRoom(roomId, event, excludeClawId);
  }
}
