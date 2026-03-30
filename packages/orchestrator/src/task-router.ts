/**
 * TaskRouter — 将 SpecEngine 中的待办任务分配给可用的 Claw
 *
 * 分配策略:
 * 1. 优先分配给 capabilities 匹配的 Claw
 * 2. 尊重依赖顺序（dep 完成后才分配后续任务）
 * 3. 支持并行分配（无依赖关系的任务可同时执行）
 * 4. Leader 不分配编码任务，Reviewer 不分配编码任务
 */
import type { SpecTask } from "./spec-engine.js";

// ── Local type aliases ──
type ClawRole = "leader" | "dev" | "reviewer" | "spectator";
type ClawCapability = "code" | "review" | "design" | "plan" | "test" | "deploy";

export interface RoutableClaw {
  clawId: string;
  name: string;
  role: ClawRole;
  capabilities: ClawCapability[];
  status: string;   // "idle" | "working" | ...
}

export interface TaskAssignment {
  taskId: string;
  clawId: string;
  clawName: string;
  description: string;
}

export class TaskRouter {
  /**
   * 根据当前可用任务和在线 Claw，计算最优分配方案
   *
   * @param availableTasks 依赖已满足的待分配任务
   * @param claws 当前房间内的所有 Claw
   * @returns 分配方案列表
   */
  computeAssignments(
    availableTasks: SpecTask[],
    claws: RoutableClaw[],
  ): TaskAssignment[] {
    const assignments: TaskAssignment[] = [];
    const assignedClaws = new Set<string>();

    // 只考虑可接任务的 Claw（idle + dev 角色 + 有 code 能力）
    const workers = claws.filter(c =>
      c.status === "idle" &&
      c.role === "dev" &&
      c.capabilities.includes("code")
    );

    for (const task of availableTasks) {
      if (task.status !== "pending") continue;

      // 找一个空闲的 worker
      const worker = workers.find(w => !assignedClaws.has(w.clawId));
      if (!worker) break; // 没有空闲 worker 了

      assignments.push({
        taskId: task.taskId,
        clawId: worker.clawId,
        clawName: worker.name,
        description: task.description,
      });
      assignedClaws.add(worker.clawId);
    }

    return assignments;
  }

  /**
   * 智能分配 — 根据任务描述匹配最合适的 Claw
   * 简单关键词匹配，后续可替换为语义匹配
   */
  computeSmartAssignments(
    availableTasks: SpecTask[],
    claws: RoutableClaw[],
  ): TaskAssignment[] {
    const assignments: TaskAssignment[] = [];
    const assignedClaws = new Set<string>();

    const workers = claws.filter(c =>
      c.status === "idle" &&
      c.role === "dev" &&
      c.capabilities.includes("code")
    );

    // 按任务描述中的关键词匹配 Claw 的 capabilities
    const capKeywords: Record<string, string[]> = {
      review: ["review", "审查", "检查", "test", "测试", "quality"],
      design: ["design", "设计", "architecture", "架构", "schema", "ui", "ux"],
    };

    for (const task of availableTasks) {
      if (task.status !== "pending") continue;

      const descLower = task.description.toLowerCase();

      // 尝试找能力匹配的 worker
      let bestWorker: RoutableClaw | undefined;

      for (const worker of workers) {
        if (assignedClaws.has(worker.clawId)) continue;

        // 检查是否有 capability 匹配
        for (const [cap, keywords] of Object.entries(capKeywords)) {
          if (worker.capabilities.includes(cap as ClawCapability)) {
            if (keywords.some(kw => descLower.includes(kw))) {
              bestWorker = worker;
              break;
            }
          }
        }
        if (bestWorker) break;
      }

      // 没找到匹配的，fallback 到第一个空闲 worker
      if (!bestWorker) {
        bestWorker = workers.find(w => !assignedClaws.has(w.clawId));
      }

      if (!bestWorker) break;

      assignments.push({
        taskId: task.taskId,
        clawId: bestWorker.clawId,
        clawName: bestWorker.name,
        description: task.description,
      });
      assignedClaws.add(bestWorker.clawId);
    }

    return assignments;
  }
}
