import { z } from "zod";
import { ClawRoleEnum, SpecPhaseEnum } from "./claw-types";

// ---------------------------------------------------------------------------
// Room 管理命令
// ---------------------------------------------------------------------------

export const CreateRoomCommand = z.object({
  type: z.literal("CREATE_ROOM"),
  name: z.string(),
  projectDir: z.string().optional(),    // 项目目录
});

export const JoinRoomCommand = z.object({
  type: z.literal("JOIN_ROOM"),
  roomId: z.string(),
  inviteCode: z.string().optional(),    // 邀请码
});

export const LeaveRoomCommand = z.object({
  type: z.literal("LEAVE_ROOM"),
  roomId: z.string(),
});

export const InviteClawCommand = z.object({
  type: z.literal("INVITE_CLAW"),
  roomId: z.string(),
  role: ClawRoleEnum.optional(),
  maxUses: z.number().default(1),
  expiresInMinutes: z.number().default(60),
});

export const KickClawCommand = z.object({
  type: z.literal("KICK_CLAW"),
  roomId: z.string(),
  clawId: z.string(),
});

export const SetClawRoleCommand = z.object({
  type: z.literal("SET_CLAW_ROLE"),
  roomId: z.string(),
  clawId: z.string(),
  role: ClawRoleEnum,
});

export const ListRoomsCommand = z.object({
  type: z.literal("LIST_ROOMS"),
});

// ---------------------------------------------------------------------------
// OpenSpec 工作流命令
// ---------------------------------------------------------------------------

export const SpecProposeCommand = z.object({
  type: z.literal("SPEC_PROPOSE"),
  roomId: z.string(),
  idea: z.string(),                     // 用户需求描述
});

export const SpecPlanCommand = z.object({
  type: z.literal("SPEC_PLAN"),
  roomId: z.string(),
  feedback: z.string().optional(),      // 对 proposal 的反馈
});

export const SpecApproveCommand = z.object({
  type: z.literal("SPEC_APPROVE"),
  roomId: z.string(),
});

export const SpecApplyCommand = z.object({
  type: z.literal("SPEC_APPLY"),
  roomId: z.string(),
});

export const SpecArchiveCommand = z.object({
  type: z.literal("SPEC_ARCHIVE"),
  roomId: z.string(),
});

export const SpecUpdateFileCommand = z.object({
  type: z.literal("SPEC_UPDATE_FILE"),
  roomId: z.string(),
  file: z.string(),                     // 相对路径 (e.g. "proposal.md")
  content: z.string(),
});

export const SpecFeedbackCommand = z.object({
  type: z.literal("SPEC_FEEDBACK"),
  roomId: z.string(),
  feedback: z.string(),                 // 用户对当前阶段的反馈
});

// ---------------------------------------------------------------------------
// 任务分配命令
// ---------------------------------------------------------------------------

export const AssignTaskCommand = z.object({
  type: z.literal("ASSIGN_TASK"),
  roomId: z.string(),
  taskId: z.string(),
  clawId: z.string(),
});

export const TaskUpdateCommand = z.object({
  type: z.literal("TASK_UPDATE"),
  roomId: z.string(),
  taskId: z.string(),
  status: z.enum(["working", "done", "failed"]),
  output: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 聚合 Schema — 所有 Claw 命令
// ---------------------------------------------------------------------------

export const ClawCommandSchema = z.discriminatedUnion("type", [
  // Room
  CreateRoomCommand,
  JoinRoomCommand,
  LeaveRoomCommand,
  InviteClawCommand,
  KickClawCommand,
  SetClawRoleCommand,
  ListRoomsCommand,
  // OpenSpec
  SpecProposeCommand,
  SpecPlanCommand,
  SpecApproveCommand,
  SpecApplyCommand,
  SpecArchiveCommand,
  SpecUpdateFileCommand,
  SpecFeedbackCommand,
  // Task
  AssignTaskCommand,
  TaskUpdateCommand,
]);

export type CreateRoomCommand = z.infer<typeof CreateRoomCommand>;
export type JoinRoomCommand = z.infer<typeof JoinRoomCommand>;
export type LeaveRoomCommand = z.infer<typeof LeaveRoomCommand>;
export type InviteClawCommand = z.infer<typeof InviteClawCommand>;
export type KickClawCommand = z.infer<typeof KickClawCommand>;
export type SetClawRoleCommand = z.infer<typeof SetClawRoleCommand>;
export type ListRoomsCommand = z.infer<typeof ListRoomsCommand>;
export type SpecProposeCommand = z.infer<typeof SpecProposeCommand>;
export type SpecPlanCommand = z.infer<typeof SpecPlanCommand>;
export type SpecApproveCommand = z.infer<typeof SpecApproveCommand>;
export type SpecApplyCommand = z.infer<typeof SpecApplyCommand>;
export type SpecArchiveCommand = z.infer<typeof SpecArchiveCommand>;
export type SpecUpdateFileCommand = z.infer<typeof SpecUpdateFileCommand>;
export type SpecFeedbackCommand = z.infer<typeof SpecFeedbackCommand>;
export type AssignTaskCommand = z.infer<typeof AssignTaskCommand>;
export type TaskUpdateCommand = z.infer<typeof TaskUpdateCommand>;
export type ClawCommand = z.infer<typeof ClawCommandSchema>;
