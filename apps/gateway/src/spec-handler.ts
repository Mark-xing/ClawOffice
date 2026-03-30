/**
 * spec-handler.ts — 处理 OpenSpec 工作流命令
 *
 * 将 SPEC_PROPOSE / SPEC_PLAN / SPEC_APPROVE / SPEC_APPLY / SPEC_ARCHIVE
 * 等命令路由到 SpecEngine，并广播事件给房间内所有参与者。
 */
import { SpecEngine, TaskRouter } from "@bit-office/orchestrator";
import type { SpecTask } from "@office/shared";
import type { RoomManager, Room } from "./room-manager.js";
import type { ClawRegistry, ClawConnection } from "./claw-registry.js";
import type { RoutableClaw, TaskAssignment } from "@bit-office/orchestrator";

// ---------------------------------------------------------------------------
// Per-room SpecEngine instances
// ---------------------------------------------------------------------------

const roomEngines = new Map<string, SpecEngine>();
const taskRouter = new TaskRouter();

/** Get or create a SpecEngine for a room */
function getEngine(room: Room, changeName?: string): SpecEngine {
  let engine = roomEngines.get(room.roomId);
  if (!engine && room.projectDir) {
    engine = new SpecEngine({
      projectDir: room.projectDir,
      changeName: changeName ?? "project",
    });
    roomEngines.set(room.roomId, engine);
  }
  return engine!;
}

export function getSpecEngine(roomId: string): SpecEngine | undefined {
  return roomEngines.get(roomId);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export interface SpecHandlerContext {
  roomManager: RoomManager;
  clawRegistry: ClawRegistry;
  /** 向 Leader Claw 发送任务提示 (用 Orchestrator 的 runTask) */
  runLeaderTask?: (roomId: string, prompt: string) => void;
  /** 向 Worker Claw 发送分配的任务 */
  runWorkerTask?: (clawId: string, taskId: string, prompt: string) => void;
}

export function handleSpecPropose(
  ctx: SpecHandlerContext,
  roomId: string,
  idea: string,
): void {
  const room = ctx.roomManager.getRoom(roomId);
  if (!room) return;

  // 如果没有 projectDir，先用临时目录
  if (!room.projectDir) {
    console.warn(`[SpecHandler] Room ${roomId} has no projectDir, cannot create spec`);
    return;
  }

  const engine = getEngine(room, sanitizeName(idea));
  const proposal = engine.propose(idea);

  // 更新房间阶段
  ctx.roomManager.setSpecPhase(roomId, "propose", engine.changeDir);

  // 广播 proposal
  ctx.roomManager.broadcastToRoom(roomId, {
    type: "SPEC_PROPOSAL_READY",
    roomId,
    proposal,
  });

  // 触发 Leader 生成规划
  ctx.runLeaderTask?.(roomId,
    `A user has proposed the following idea. Please analyze it and create a development plan.\n\n` +
    `## Proposal\n${idea}\n\n` +
    `Please output:\n` +
    `1. A design.md with technical approach and architecture\n` +
    `2. A tasks.md with numbered, actionable tasks (format: "- [ ] 1.1 Description")\n` +
    `3. Optional: specs/*.md files for detailed requirements\n\n` +
    `Use [PLAN] tag in your output to signal the plan is ready for review.`
  );

  console.log(`[SpecHandler] Propose: "${idea.slice(0, 60)}..." in room ${roomId}`);
}

export function handleSpecPlan(
  ctx: SpecHandlerContext,
  roomId: string,
  feedback?: string,
): void {
  const engine = roomEngines.get(roomId);
  if (!engine) return;

  engine.startPlanning();
  ctx.roomManager.setSpecPhase(roomId, "plan");

  if (feedback) {
    // 有反馈，让 Leader 根据反馈调整规划
    ctx.runLeaderTask?.(roomId,
      `The user has provided feedback on the proposal. Please revise the plan.\n\n` +
      `Feedback: ${feedback}\n\n` +
      `Please update design.md and tasks.md accordingly. Use [PLAN] tag when done.`
    );
  }

  console.log(`[SpecHandler] Plan phase started for room ${roomId}`);
}

export function handleSpecApprove(
  ctx: SpecHandlerContext,
  roomId: string,
): void {
  const engine = roomEngines.get(roomId);
  if (!engine) return;

  const tasks = engine.approve();
  ctx.roomManager.setSpecPhase(roomId, "apply");

  // 广播任务列表
  ctx.roomManager.broadcastToRoom(roomId, {
    type: "SPEC_TASKS_UPDATED",
    roomId,
    tasks: tasks.map(t => ({
      taskId: t.taskId,
      description: t.description,
      status: t.status,
      assignee: t.assignee,
    })),
  });

  // 自动分配任务
  autoAssignTasks(ctx, roomId, engine);

  console.log(`[SpecHandler] Approved! ${tasks.length} tasks ready for room ${roomId}`);
}

export function handleSpecApply(
  ctx: SpecHandlerContext,
  roomId: string,
): void {
  const engine = roomEngines.get(roomId);
  if (!engine) return;

  // 重新分配未完成的任务
  autoAssignTasks(ctx, roomId, engine);
}

export function handleSpecArchive(
  ctx: SpecHandlerContext,
  roomId: string,
): void {
  const engine = roomEngines.get(roomId);
  if (!engine) return;

  const archivePath = engine.archive();
  if (archivePath) {
    ctx.roomManager.setSpecPhase(roomId, "archive");
    roomEngines.delete(roomId);
    console.log(`[SpecHandler] Archived: ${archivePath}`);
  }
}

export function handleSpecUpdateFile(
  ctx: SpecHandlerContext,
  roomId: string,
  file: string,
  content: string,
  updatedBy?: string,
): void {
  const engine = roomEngines.get(roomId);
  if (!engine) return;

  engine.updateFile(file, content);

  // 广播文件更新
  ctx.roomManager.broadcastToRoom(roomId, {
    type: "SPEC_FILE_UPDATED",
    roomId,
    file,
    content,
    updatedBy,
  });
}

export function handleSpecFeedback(
  ctx: SpecHandlerContext,
  roomId: string,
  feedback: string,
): void {
  const engine = roomEngines.get(roomId);
  if (!engine) return;

  const phase = engine.phase;

  if (phase === "propose" || phase === "plan") {
    // 反馈给 Leader 调整规划
    ctx.runLeaderTask?.(roomId,
      `User feedback on the ${phase}:\n\n${feedback}\n\nPlease revise accordingly.`
    );
  } else if (phase === "apply") {
    // 执行阶段的反馈 — 可以调整任务或添加新要求
    ctx.runLeaderTask?.(roomId,
      `User feedback during execution:\n\n${feedback}\n\nPlease adjust the current tasks or delegate additional work as needed.`
    );
  }
}

export function handleTaskUpdate(
  ctx: SpecHandlerContext,
  roomId: string,
  taskId: string,
  status: string,
  output?: string,
): void {
  const engine = roomEngines.get(roomId);
  if (!engine) return;

  engine.updateTaskStatus(taskId, status as any, output);

  // 广播任务进度
  ctx.roomManager.broadcastToRoom(roomId, {
    type: "SPEC_TASKS_UPDATED",
    roomId,
    tasks: engine.tasks.map(t => ({
      taskId: t.taskId,
      description: t.description,
      status: t.status,
      assignee: t.assignee,
    })),
  });

  // 任务完成后，检查是否有新的可分配任务
  if (status === "done") {
    autoAssignTasks(ctx, roomId, engine);
  }
}

// ---------------------------------------------------------------------------
// Auto-assign
// ---------------------------------------------------------------------------

function autoAssignTasks(
  ctx: SpecHandlerContext,
  roomId: string,
  engine: SpecEngine,
): void {
  const available = engine.getAvailableTasks();
  if (available.length === 0) return;

  const claws = ctx.clawRegistry.getByRoom(roomId);
  const routableClaws: RoutableClaw[] = claws.map(c => ({
    clawId: c.clawId,
    name: c.name,
    role: c.role,
    capabilities: c.capabilities,
    status: c.status,
  }));

  const assignments = taskRouter.computeSmartAssignments(available, routableClaws);

  for (const assignment of assignments) {
    engine.assignTask(assignment.taskId, assignment.clawId);

    // 广播分配事件
    ctx.roomManager.broadcastToRoom(roomId, {
      type: "SPEC_TASK_ASSIGNED",
      roomId,
      taskId: assignment.taskId,
      clawId: assignment.clawId,
      description: assignment.description,
    });

    // 向 Worker 发送任务
    const designContent = engine.readFile("design.md") ?? "";
    const prompt = buildTaskPrompt(assignment, designContent, engine);
    ctx.runWorkerTask?.(assignment.clawId, assignment.taskId, prompt);

    console.log(`[SpecHandler] Task ${assignment.taskId} → ${assignment.clawName} (${assignment.clawId})`);
  }
}

function buildTaskPrompt(
  assignment: TaskAssignment,
  designContent: string,
  engine: SpecEngine,
): string {
  const specFiles = engine.getSnapshot()
    .filter(f => f.path.startsWith("specs/"))
    .map(f => `### ${f.path}\n${f.content}`)
    .join("\n\n");

  return [
    `## Task ${assignment.taskId}: ${assignment.description}`,
    ``,
    `You are implementing task ${assignment.taskId} from the project plan.`,
    ``,
    designContent ? `## Design Context\n${designContent.slice(0, 2000)}` : "",
    specFiles ? `## Specifications\n${specFiles.slice(0, 2000)}` : "",
    ``,
    `Please implement this task. When done, provide a brief summary of what you did.`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeName(idea: string): string {
  return idea
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "project";
}
