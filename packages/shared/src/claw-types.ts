import { z } from "zod";

// ---------------------------------------------------------------------------
// OpenClaw — 独立的 AI CLI Agent 实例
// ---------------------------------------------------------------------------

export const ClawStatusEnum = z.enum([
  "idle", "working", "done", "error", "offline",
]);
export type ClawStatus = z.infer<typeof ClawStatusEnum>;

export const ClawRoleEnum = z.enum([
  "leader", "dev", "reviewer", "spectator",
]);
export type ClawRole = z.infer<typeof ClawRoleEnum>;

/** OpenClaw 能力声明 */
export const ClawCapabilityEnum = z.enum([
  "code",       // 可以写代码
  "review",     // 可以做代码审查
  "design",     // 可以做架构设计
  "plan",       // 可以做项目规划
  "test",       // 可以写/跑测试
  "deploy",     // 可以做部署
]);
export type ClawCapability = z.infer<typeof ClawCapabilityEnum>;

/** OpenClaw 身份信息 */
export const ClawIdentitySchema = z.object({
  clawId: z.string(),
  name: z.string(),
  owner: z.string(),                    // 所有者标识（谁启动的）
  backend: z.string(),                  // AI CLI 类型 (claude/codex/gemini...)
  capabilities: z.array(ClawCapabilityEnum).default([]),
  role: ClawRoleEnum.optional(),        // 在当前 Room 中的角色
  personality: z.string().optional(),
  palette: z.number().optional(),       // 头像调色板
  model: z.string().optional(),         // AI 模型 (opus/sonnet...)
});
export type ClawIdentity = z.infer<typeof ClawIdentitySchema>;

/** OpenClaw 运行时状态 */
export const ClawStateSchema = ClawIdentitySchema.extend({
  status: ClawStatusEnum,
  isLocal: z.boolean(),                 // true = 本地 spawn, false = 远程 WS
  roomId: z.string().optional(),        // 当前所在房间
  workDir: z.string().optional(),       // 工作目录
  pid: z.number().optional(),           // 本地进程 PID
  connectedAt: z.number().optional(),   // 连接时间戳
});
export type ClawState = z.infer<typeof ClawStateSchema>;

// ---------------------------------------------------------------------------
// Room — 协作空间
// ---------------------------------------------------------------------------

/** OpenSpec 阶段 */
export const SpecPhaseEnum = z.enum([
  "propose",    // 提案：定义需求
  "plan",       // 规划：生成 specs + design + tasks
  "apply",      // 执行：按 tasks 实施
  "archive",    // 归档：项目完成，知识沉淀
]);
export type SpecPhase = z.infer<typeof SpecPhaseEnum>;

/** Room 配置 */
export const RoomConfigSchema = z.object({
  maxClaws: z.number().default(20),     // 最大参与者数
  autoAssign: z.boolean().default(true),// 自动分配任务
  worktreeEnabled: z.boolean().default(true),
  autoMerge: z.boolean().default(true),
});
export type RoomConfig = z.infer<typeof RoomConfigSchema>;

/** Room 状态 */
export const RoomStateSchema = z.object({
  roomId: z.string(),
  name: z.string(),
  owner: z.string(),                    // 房间创建者
  claws: z.array(ClawStateSchema),      // 已加入的 OpenClaw
  specPhase: SpecPhaseEnum.nullable(),  // 当前 OpenSpec 阶段
  specDir: z.string().optional(),       // OpenSpec 目录路径
  projectDir: z.string().optional(),    // 项目代码目录
  config: RoomConfigSchema,
  createdAt: z.number(),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

// ---------------------------------------------------------------------------
// OpenSpec 任务
// ---------------------------------------------------------------------------

export const SpecTaskStatusEnum = z.enum([
  "pending", "assigned", "working", "done", "failed", "skipped",
]);
export type SpecTaskStatus = z.infer<typeof SpecTaskStatusEnum>;

/** OpenSpec tasks.md 中解析出的单个任务 */
export const SpecTaskSchema = z.object({
  taskId: z.string(),                   // e.g. "1.1", "2.3"
  description: z.string(),
  status: SpecTaskStatusEnum,
  assignee: z.string().optional(),      // clawId
  dependencies: z.array(z.string()).default([]), // 依赖的 taskId
  output: z.string().optional(),        // 执行结果摘要
});
export type SpecTask = z.infer<typeof SpecTaskSchema>;

/** OpenSpec 规范文件 */
export const SpecFileSchema = z.object({
  path: z.string(),                     // 相对于 specDir 的路径
  content: z.string(),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),     // clawId
});
export type SpecFile = z.infer<typeof SpecFileSchema>;

// ---------------------------------------------------------------------------
// 握手协议 — OpenClaw 连入 Room Server
// ---------------------------------------------------------------------------

/** OpenClaw → Room Server: 连接握手 */
export const ClawHandshakeSchema = z.object({
  type: z.literal("CLAW_JOIN"),
  clawId: z.string(),
  name: z.string(),
  owner: z.string(),
  backend: z.string(),
  capabilities: z.array(ClawCapabilityEnum).default([]),
  personality: z.string().optional(),
  palette: z.number().optional(),
  model: z.string().optional(),
  roomId: z.string().optional(),        // 要加入的房间（空 = 默认房间）
  authToken: z.string(),                // 认证 token
});
export type ClawHandshake = z.infer<typeof ClawHandshakeSchema>;

/** Room Server → OpenClaw: 连接确认 */
export const JoinAckSchema = z.object({
  type: z.literal("JOIN_ACK"),
  roomId: z.string(),
  clawId: z.string(),
  role: ClawRoleEnum,
  roomState: RoomStateSchema,
});
export type JoinAck = z.infer<typeof JoinAckSchema>;

/** Room Server → OpenClaw: 连接拒绝 */
export const JoinRejectSchema = z.object({
  type: z.literal("JOIN_REJECT"),
  reason: z.string(),
});
export type JoinReject = z.infer<typeof JoinRejectSchema>;

// ---------------------------------------------------------------------------
// 邀请码
// ---------------------------------------------------------------------------

export const RoomInviteSchema = z.object({
  roomId: z.string(),
  code: z.string(),                     // 6位邀请码
  role: ClawRoleEnum,
  expiresAt: z.number(),
  maxUses: z.number().default(1),
  usedCount: z.number().default(0),
});
export type RoomInvite = z.infer<typeof RoomInviteSchema>;
