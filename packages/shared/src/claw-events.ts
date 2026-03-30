import { z } from "zod";
import {
  ClawStatusEnum,
  ClawRoleEnum,
  ClawCapabilityEnum,
  SpecPhaseEnum,
  SpecTaskStatusEnum,
  RoomStateSchema,
  RoomInviteSchema,
} from "./claw-types";

// ---------------------------------------------------------------------------
// Room 事件
// ---------------------------------------------------------------------------

export const RoomCreatedEvent = z.object({
  type: z.literal("ROOM_CREATED"),
  roomId: z.string(),
  name: z.string(),
  owner: z.string(),
});

export const RoomListEvent = z.object({
  type: z.literal("ROOM_LIST"),
  rooms: z.array(z.object({
    roomId: z.string(),
    name: z.string(),
    owner: z.string(),
    clawCount: z.number(),
    specPhase: SpecPhaseEnum.nullable(),
    createdAt: z.number(),
  })),
});

// ---------------------------------------------------------------------------
// OpenClaw 连接事件
// ---------------------------------------------------------------------------

export const ClawJoinedEvent = z.object({
  type: z.literal("CLAW_JOINED"),
  roomId: z.string(),
  clawId: z.string(),
  name: z.string(),
  owner: z.string(),
  backend: z.string(),
  capabilities: z.array(ClawCapabilityEnum),
  role: ClawRoleEnum,
  isLocal: z.boolean(),
  palette: z.number().optional(),
});

export const ClawLeftEvent = z.object({
  type: z.literal("CLAW_LEFT"),
  roomId: z.string(),
  clawId: z.string(),
  reason: z.string().optional(),        // "disconnect", "kicked", "left"
});

export const ClawStatusChangedEvent = z.object({
  type: z.literal("CLAW_STATUS"),
  clawId: z.string(),
  status: ClawStatusEnum,
});

export const ClawRoleChangedEvent = z.object({
  type: z.literal("CLAW_ROLE_CHANGED"),
  roomId: z.string(),
  clawId: z.string(),
  role: ClawRoleEnum,
});

// ---------------------------------------------------------------------------
// Room 邀请事件
// ---------------------------------------------------------------------------

export const InviteCreatedEvent = z.object({
  type: z.literal("INVITE_CREATED"),
  invite: RoomInviteSchema,
});

// ---------------------------------------------------------------------------
// OpenSpec 工作流事件
// ---------------------------------------------------------------------------

export const SpecPhaseChangedEvent = z.object({
  type: z.literal("SPEC_PHASE_CHANGED"),
  roomId: z.string(),
  phase: SpecPhaseEnum,
  specDir: z.string().optional(),
});

export const SpecFileUpdatedEvent = z.object({
  type: z.literal("SPEC_FILE_UPDATED"),
  roomId: z.string(),
  file: z.string(),                     // 相对路径
  content: z.string(),
  updatedBy: z.string().optional(),     // clawId
});

export const SpecProposalReadyEvent = z.object({
  type: z.literal("SPEC_PROPOSAL_READY"),
  roomId: z.string(),
  proposal: z.string(),                 // proposal.md 内容
});

export const SpecPlanReadyEvent = z.object({
  type: z.literal("SPEC_PLAN_READY"),
  roomId: z.string(),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })),
});

// ---------------------------------------------------------------------------
// 任务分配事件
// ---------------------------------------------------------------------------

export const SpecTaskAssignedEvent = z.object({
  type: z.literal("SPEC_TASK_ASSIGNED"),
  roomId: z.string(),
  taskId: z.string(),
  clawId: z.string(),
  description: z.string(),
});

export const SpecTaskProgressEvent = z.object({
  type: z.literal("SPEC_TASK_PROGRESS"),
  roomId: z.string(),
  taskId: z.string(),
  clawId: z.string(),
  status: SpecTaskStatusEnum,
  activity: z.string().optional(),      // 当前正在做什么
  output: z.string().optional(),        // 执行结果摘要
});

export const SpecTasksUpdatedEvent = z.object({
  type: z.literal("SPEC_TASKS_UPDATED"),
  roomId: z.string(),
  tasks: z.array(z.object({
    taskId: z.string(),
    description: z.string(),
    status: SpecTaskStatusEnum,
    assignee: z.string().optional(),
  })),
});

// ---------------------------------------------------------------------------
// Room 聊天事件
// ---------------------------------------------------------------------------

export const RoomChatEvent = z.object({
  type: z.literal("ROOM_CHAT"),
  roomId: z.string(),
  fromClawId: z.string(),
  toClawId: z.string().optional(),      // 空 = 广播给所有人
  message: z.string(),
  messageType: z.enum(["chat", "delegation", "result", "status", "warning"]),
  timestamp: z.number(),
});

// ---------------------------------------------------------------------------
// 聚合 Schema — 所有 Claw 事件
// ---------------------------------------------------------------------------

export const ClawEventSchema = z.discriminatedUnion("type", [
  // Room
  RoomCreatedEvent,
  RoomListEvent,
  // Claw 连接
  ClawJoinedEvent,
  ClawLeftEvent,
  ClawStatusChangedEvent,
  ClawRoleChangedEvent,
  // 邀请
  InviteCreatedEvent,
  // OpenSpec
  SpecPhaseChangedEvent,
  SpecFileUpdatedEvent,
  SpecProposalReadyEvent,
  SpecPlanReadyEvent,
  // 任务
  SpecTaskAssignedEvent,
  SpecTaskProgressEvent,
  SpecTasksUpdatedEvent,
  // 聊天
  RoomChatEvent,
]);

export type RoomCreatedEvent = z.infer<typeof RoomCreatedEvent>;
export type RoomListEvent = z.infer<typeof RoomListEvent>;
export type ClawJoinedEvent = z.infer<typeof ClawJoinedEvent>;
export type ClawLeftEvent = z.infer<typeof ClawLeftEvent>;
export type ClawStatusChangedEvent = z.infer<typeof ClawStatusChangedEvent>;
export type ClawRoleChangedEvent = z.infer<typeof ClawRoleChangedEvent>;
export type InviteCreatedEvent = z.infer<typeof InviteCreatedEvent>;
export type SpecPhaseChangedEvent = z.infer<typeof SpecPhaseChangedEvent>;
export type SpecFileUpdatedEvent = z.infer<typeof SpecFileUpdatedEvent>;
export type SpecProposalReadyEvent = z.infer<typeof SpecProposalReadyEvent>;
export type SpecPlanReadyEvent = z.infer<typeof SpecPlanReadyEvent>;
export type SpecTaskAssignedEvent = z.infer<typeof SpecTaskAssignedEvent>;
export type SpecTaskProgressEvent = z.infer<typeof SpecTaskProgressEvent>;
export type SpecTasksUpdatedEvent = z.infer<typeof SpecTasksUpdatedEvent>;
export type RoomChatEvent = z.infer<typeof RoomChatEvent>;
export type ClawEvent = z.infer<typeof ClawEventSchema>;
