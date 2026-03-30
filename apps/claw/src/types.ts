/**
 * types.ts — OpenClaw CLI 内联类型定义
 *
 * 从 @office/shared 提取的纯类型（无运行时依赖），
 * 让 openclaw CLI 可以独立发布为 npm 包。
 */

// ── Enums ──
export type ClawStatus = "idle" | "working" | "done" | "error" | "offline";
export type ClawRole = "leader" | "dev" | "reviewer" | "spectator";
export type ClawCapability = "code" | "review" | "design" | "plan" | "test" | "deploy";
export type SpecPhase = "propose" | "plan" | "apply" | "archive";

// ── Identity ──
export interface ClawIdentity {
  clawId: string;
  name: string;
  owner: string;
  backend: string;
  capabilities: ClawCapability[];
  role?: ClawRole;
  personality?: string;
  palette?: number;
  model?: string;
}

// ── State ──
export interface ClawState {
  clawId: string;
  name: string;
  owner: string;
  backend: string;
  capabilities: ClawCapability[];
  role?: ClawRole;
  status: ClawStatus;
  isLocal: boolean;
  roomId?: string;
  workDir?: string;
  pid?: number;
  connectedAt?: number;
  palette?: number;
}

// ── Room ──
export interface RoomState {
  roomId: string;
  name: string;
  owner: string;
  claws: ClawState[];
  specPhase: SpecPhase | null;
  specDir?: string;
  projectDir?: string;
  config: {
    maxClaws: number;
    autoAssign: boolean;
    worktreeEnabled: boolean;
    autoMerge: boolean;
  };
  createdAt: number;
}

// ── Handshake ──
export interface ClawHandshake {
  type: "CLAW_JOIN";
  clawId: string;
  name: string;
  owner: string;
  backend: string;
  capabilities: ClawCapability[];
  personality?: string;
  palette?: number;
  model?: string;
  roomId?: string;
  authToken: string;
}

export interface JoinAck {
  type: "JOIN_ACK";
  roomId: string;
  clawId: string;
  role: ClawRole;
  roomState: RoomState;
}

export interface JoinReject {
  type: "JOIN_REJECT";
  reason: string;
}

// ── Events (subset used by CLI) ──
export type ClawEvent =
  | { type: "CLAW_JOINED"; roomId: string; clawId: string; name: string; owner: string; backend: string; capabilities: ClawCapability[]; role: ClawRole; isLocal: boolean; palette?: number }
  | { type: "CLAW_LEFT"; roomId: string; clawId: string; reason?: string }
  | { type: "CLAW_STATUS"; clawId: string; status: ClawStatus }
  | { type: "SPEC_PHASE_CHANGED"; roomId: string; phase: SpecPhase; specDir?: string }
  | { type: "SPEC_TASK_ASSIGNED"; roomId: string; taskId: string; clawId: string; description: string }
  | { type: "SPEC_FILE_UPDATED"; roomId: string; file: string; content: string; updatedBy?: string }
  | { type: "ROOM_CHAT"; roomId: string; fromClawId: string; toClawId?: string; message: string; messageType: string; timestamp: number }
  | { type: string; [key: string]: unknown }; // fallback for unknown events
