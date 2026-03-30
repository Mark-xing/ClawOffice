/**
 * claw-bridge.ts — 将现有 Agent 系统桥接到 Claw/Room 系统
 *
 * 这是渐进式迁移的核心：
 * - 现有的 CREATE_AGENT / FIRE_AGENT 命令自动转换为 LocalClaw 注册
 * - 现有的事件自动映射为 ClawEvent 广播
 * - 新增的远程 Claw 可以和本地 Agent 共存在同一个 Room
 *
 * 后续随着迁移推进，这个桥接层会逐渐变薄，直到完全移除。
 */
import { ClawRegistry, LocalClaw } from "./claw-registry.js";
import { RoomManager } from "./room-manager.js";
import type { ClawRole, ClawCapability } from "@office/shared";

export interface ClawBridgeOptions {
  clawRegistry: ClawRegistry;
  roomManager: RoomManager;
}

/**
 * 当现有系统创建 Agent 时，同步注册为 LocalClaw 并加入默认房间
 */
export function bridgeAgentCreated(
  bridge: ClawBridgeOptions,
  opts: {
    agentId: string;
    name: string;
    backend: string;
    role: string;
    palette?: number;
    isTeamLead?: boolean;
    teamId?: string;
    workDir?: string;
  },
): LocalClaw {
  // 决定 Claw 角色
  let clawRole: ClawRole = "dev";
  if (opts.isTeamLead) clawRole = "leader";
  if (opts.role.toLowerCase().includes("review")) clawRole = "reviewer";

  // 决定能力
  const capabilities: ClawCapability[] = ["code"];
  if (opts.role.toLowerCase().includes("review")) capabilities.push("review");
  if (opts.isTeamLead) capabilities.push("plan");

  // 注册到 ClawRegistry
  const claw = bridge.clawRegistry.registerLocal({
    agentId: opts.agentId,
    name: opts.name,
    backend: opts.backend,
    role: clawRole,
    palette: opts.palette,
    capabilities,
    workDir: opts.workDir,
  });

  // 加入默认房间（或指定 team 的房间）
  const roomId = bridge.roomManager.defaultRoomId;
  bridge.roomManager.joinRoom(roomId, claw, clawRole);

  return claw;
}

/**
 * 当现有系统销毁 Agent 时，同步从 Claw/Room 中移除
 */
export function bridgeAgentFired(bridge: ClawBridgeOptions, agentId: string): void {
  const claw = bridge.clawRegistry.getByAgentId(agentId);
  if (!claw) return;

  if (claw.roomId) {
    bridge.roomManager.leaveRoom(claw.roomId, claw.clawId, "fired");
  }
  bridge.clawRegistry.unregister(claw.clawId);
}

/**
 * 当现有系统的 Agent 状态变更时，同步更新 Claw 状态
 */
export function bridgeAgentStatus(
  bridge: ClawBridgeOptions,
  agentId: string,
  status: string,
): void {
  const claw = bridge.clawRegistry.getByAgentId(agentId);
  if (!claw) return;

  const clawStatus = mapAgentStatus(status);
  claw.status = clawStatus;

  if (claw.roomId) {
    bridge.roomManager.broadcastToRoom(claw.roomId, {
      type: "CLAW_STATUS",
      clawId: claw.clawId,
      status: clawStatus,
    });
  }
}

function mapAgentStatus(status: string): "idle" | "working" | "done" | "error" | "offline" {
  switch (status) {
    case "working":
    case "waiting_approval":
      return "working";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return "idle";
  }
}
