/**
 * SpecEngine — OpenSpec Spec-Driven Development 工作流引擎
 *
 * 管理一个项目的完整 OpenSpec 生命周期:
 *   Propose → Plan → Apply → Archive
 *
 * 目录结构 (对齐 OpenSpec 标准):
 *   openspec/
 *   ├── changes/
 *   │   └── <change-name>/
 *   │       ├── proposal.md
 *   │       ├── specs/
 *   │       │   └── *.md
 *   │       ├── design.md
 *   │       └── tasks.md
 *   └── changes/archive/
 *       └── <date>-<name>/
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, cpSync } from "fs";
import path from "path";

// ── Local type aliases (avoid cross-package dependency on @office/shared) ──
type SpecPhase = "propose" | "plan" | "apply" | "archive";
type SpecTaskStatus = "pending" | "assigned" | "working" | "done" | "failed" | "skipped";

export interface SpecTask {
  taskId: string;
  description: string;
  status: SpecTaskStatus;
  assignee?: string;
  dependencies: string[];
  output?: string;
}

// ---------------------------------------------------------------------------
// Task parser — 从 tasks.md 提取可执行任务
// ---------------------------------------------------------------------------

/**
 * 解析 tasks.md 中的任务列表
 *
 * 支持格式:
 *   - [ ] 1.1 描述文本
 *   - [x] 1.2 已完成的任务
 *   - 1.1 描述文本 (无 checkbox)
 *   - **1.1** 描述文本 (加粗序号)
 *
 * 也支持依赖声明:
 *   - [ ] 2.1 描述 (depends: 1.1, 1.2)
 */
export function parseTasksMd(content: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  const lines = content.split("\n");

  // Pattern: optional checkbox + task id (e.g. "1.1", "2.3") + description
  const taskRe = /^[\s-]*(?:\[([x ])\]\s*)?(?:\*\*)?(\d+(?:\.\d+)?)\*?\*?\s*[.):—–-]?\s*(.+)/i;
  const depRe = /\(depends?:\s*([^)]+)\)/i;

  for (const line of lines) {
    const match = line.match(taskRe);
    if (!match) continue;

    const [, checkbox, taskId, rawDesc] = match;
    const isDone = checkbox === "x";

    // Extract dependencies if declared
    const depMatch = rawDesc.match(depRe);
    const dependencies = depMatch
      ? depMatch[1].split(",").map(s => s.trim()).filter(Boolean)
      : [];
    const description = rawDesc.replace(depRe, "").trim();

    tasks.push({
      taskId,
      description,
      status: isDone ? "done" : "pending",
      dependencies,
    });
  }

  return tasks;
}

/**
 * 将任务列表序列化回 tasks.md 格式
 */
export function serializeTasksMd(tasks: SpecTask[]): string {
  const lines = ["# Tasks\n"];

  // Group by major version (1.x, 2.x, ...)
  const groups = new Map<string, SpecTask[]>();
  for (const task of tasks) {
    const major = task.taskId.split(".")[0];
    if (!groups.has(major)) groups.set(major, []);
    groups.get(major)!.push(task);
  }

  for (const [, groupTasks] of groups) {
    for (const task of groupTasks) {
      const check = task.status === "done" ? "x" : " ";
      const assignee = task.assignee ? ` → ${task.assignee}` : "";
      const deps = task.dependencies.length > 0
        ? ` (depends: ${task.dependencies.join(", ")})`
        : "";
      const statusTag = task.status === "working" ? " 🔨" :
                        task.status === "failed" ? " ❌" :
                        task.status === "assigned" ? " 📌" : "";
      lines.push(`- [${check}] ${task.taskId} ${task.description}${deps}${assignee}${statusTag}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// SpecEngine
// ---------------------------------------------------------------------------

export interface SpecEngineOptions {
  /** 项目根目录 */
  projectDir: string;
  /** 变更名称 (e.g. "add-dark-mode") */
  changeName?: string;
}

export interface SpecEngineEvents {
  phaseChanged: (phase: SpecPhase) => void;
  fileUpdated: (file: string, content: string) => void;
  tasksUpdated: (tasks: SpecTask[]) => void;
}

export class SpecEngine {
  private projectDir: string;
  private changeName: string;
  private _phase: SpecPhase = "propose";
  private _tasks: SpecTask[] = [];
  private eventHandlers: Partial<SpecEngineEvents> = {};

  get phase(): SpecPhase { return this._phase; }
  get tasks(): SpecTask[] { return [...this._tasks]; }

  /** OpenSpec 变更目录路径 */
  get changeDir(): string {
    return path.join(this.projectDir, "openspec", "changes", this.changeName);
  }

  /** OpenSpec 归档目录 */
  get archiveDir(): string {
    return path.join(this.projectDir, "openspec", "changes", "archive");
  }

  constructor(opts: SpecEngineOptions) {
    this.projectDir = opts.projectDir;
    this.changeName = opts.changeName ?? "project";
  }

  on<K extends keyof SpecEngineEvents>(event: K, handler: SpecEngineEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  // ── Phase transitions ──────────────────────────────────

  /**
   * Phase 1: Propose — 创建提案
   * 接收用户的需求描述，生成 proposal.md
   */
  propose(idea: string): string {
    this.ensureDir(this.changeDir);

    const proposal = this.buildProposal(idea);
    this.writeSpecFile("proposal.md", proposal);

    this._phase = "propose";
    this.eventHandlers.phaseChanged?.("propose");

    return proposal;
  }

  /**
   * Phase 2: Plan — 规划
   * 由 Leader Claw 生成 specs/ + design.md + tasks.md
   * 这里只设置阶段，实际内容由 AI 生成后通过 updateFile() 写入
   */
  startPlanning(): void {
    this._phase = "plan";
    this.eventHandlers.phaseChanged?.("plan");

    // 确保 specs 子目录存在
    this.ensureDir(path.join(this.changeDir, "specs"));
  }

  /**
   * 批准规划，进入执行阶段
   * 在进入 apply 之前，解析 tasks.md 生成任务列表
   */
  approve(): SpecTask[] {
    // 解析 tasks.md
    const tasksPath = path.join(this.changeDir, "tasks.md");
    if (existsSync(tasksPath)) {
      const content = readFileSync(tasksPath, "utf-8");
      this._tasks = parseTasksMd(content);
    }

    this._phase = "apply";
    this.eventHandlers.phaseChanged?.("apply");
    this.eventHandlers.tasksUpdated?.(this._tasks);

    return this._tasks;
  }

  /**
   * Phase 3: Apply — 执行
   * 按 tasks.md 逐项执行，各 Claw 领取任务
   */
  assignTask(taskId: string, clawId: string): boolean {
    const task = this._tasks.find(t => t.taskId === taskId);
    if (!task) return false;
    if (task.status !== "pending") return false;

    // 检查依赖是否都已完成
    for (const depId of task.dependencies) {
      const dep = this._tasks.find((t: SpecTask) => t.taskId === depId);
      if (dep && dep.status !== "done") return false;
    }

    task.assignee = clawId;
    task.status = "assigned";
    this.syncTasksFile();
    this.eventHandlers.tasksUpdated?.(this._tasks);
    return true;
  }

  updateTaskStatus(taskId: string, status: SpecTaskStatus, output?: string): boolean {
    const task = this._tasks.find(t => t.taskId === taskId);
    if (!task) return false;

    task.status = status;
    if (output) task.output = output;

    this.syncTasksFile();
    this.eventHandlers.tasksUpdated?.(this._tasks);

    // 检查是否所有任务完成
    if (this._tasks.every(t => t.status === "done" || t.status === "skipped")) {
      // 所有任务完成，但不自动进入 archive — 等用户确认
    }

    return true;
  }

  /** 获取下一个可分配的任务（依赖已满足） */
  getNextAvailableTask(): SpecTask | null {
    for (const task of this._tasks) {
      if (task.status !== "pending") continue;

      // 检查依赖
      const depsOk = task.dependencies.every((depId: string) => {
        const dep = this._tasks.find((t: SpecTask) => t.taskId === depId);
        return !dep || dep.status === "done";
      });

      if (depsOk) return task;
    }
    return null;
  }

  /** 获取所有可并行执行的任务 */
  getAvailableTasks(): SpecTask[] {
    return this._tasks.filter(task => {
      if (task.status !== "pending") return false;
      return task.dependencies.every((depId: string) => {
        const dep = this._tasks.find((t: SpecTask) => t.taskId === depId);
        return !dep || dep.status === "done";
      });
    });
  }

  /**
   * Phase 4: Archive — 归档
   * 将变更文件夹移到 archive/，更新主 specs
   */
  archive(): string | null {
    if (!existsSync(this.changeDir)) return null;

    this.ensureDir(this.archiveDir);

    const dateStr = new Date().toISOString().slice(0, 10);
    const archiveName = `${dateStr}-${this.changeName}`;
    const archivePath = path.join(this.archiveDir, archiveName);

    try {
      cpSync(this.changeDir, archivePath, { recursive: true });
      console.log(`[SpecEngine] Archived to ${archivePath}`);
    } catch (err) {
      console.error(`[SpecEngine] Archive failed: ${err}`);
      return null;
    }

    this._phase = "archive";
    this.eventHandlers.phaseChanged?.("archive");

    return archivePath;
  }

  // ── File operations ──────────────────────────────────

  /**
   * 写入/更新 Spec 文件
   * @param file 相对于 changeDir 的路径 (e.g. "proposal.md", "specs/auth.md")
   */
  updateFile(file: string, content: string): void {
    const filePath = path.join(this.changeDir, file);
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    writeFileSync(filePath, content, "utf-8");

    this.eventHandlers.fileUpdated?.(file, content);

    // 如果更新了 tasks.md，重新解析
    if (file === "tasks.md") {
      this._tasks = parseTasksMd(content);
      this.eventHandlers.tasksUpdated?.(this._tasks);
    }
  }

  /** 读取 Spec 文件 */
  readFile(file: string): string | null {
    const filePath = path.join(this.changeDir, file);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  }

  /** 列出 specs/ 目录下的所有文件 */
  listSpecFiles(): string[] {
    const specsDir = path.join(this.changeDir, "specs");
    if (!existsSync(specsDir)) return [];
    return readdirSync(specsDir)
      .filter(f => f.endsWith(".md"))
      .map(f => `specs/${f}`);
  }

  /** 获取所有 Spec 文件的快照 */
  getSnapshot(): Array<{ path: string; content: string }> {
    const files: Array<{ path: string; content: string }> = [];

    const addFile = (relPath: string) => {
      const content = this.readFile(relPath);
      if (content) files.push({ path: relPath, content });
    };

    addFile("proposal.md");
    addFile("design.md");
    addFile("tasks.md");
    for (const specFile of this.listSpecFiles()) {
      addFile(specFile);
    }

    return files;
  }

  // ── State restoration ────────────────────────────────

  /** 从磁盘恢复状态（gateway 重启后） */
  restore(): void {
    // 检测当前阶段
    if (!existsSync(this.changeDir)) {
      this._phase = "propose";
      return;
    }

    const hasProposal = existsSync(path.join(this.changeDir, "proposal.md"));
    const hasDesign = existsSync(path.join(this.changeDir, "design.md"));
    const hasTasks = existsSync(path.join(this.changeDir, "tasks.md"));

    if (hasTasks) {
      const content = readFileSync(path.join(this.changeDir, "tasks.md"), "utf-8");
      this._tasks = parseTasksMd(content);

      const hasWorkingTasks = this._tasks.some(t =>
        t.status === "assigned" || t.status === "working"
      );
      const allDone = this._tasks.every(t =>
        t.status === "done" || t.status === "skipped"
      );

      if (allDone) {
        this._phase = "apply"; // ready for archive
      } else if (hasWorkingTasks) {
        this._phase = "apply";
      } else {
        this._phase = "plan"; // tasks exist but not yet approved
      }
    } else if (hasDesign) {
      this._phase = "plan";
    } else if (hasProposal) {
      this._phase = "propose";
    }

    console.log(`[SpecEngine] Restored phase: ${this._phase} (${this._tasks.length} tasks)`);
  }

  // ── Private helpers ──────────────────────────────────

  private writeSpecFile(file: string, content: string): void {
    const filePath = path.join(this.changeDir, file);
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    writeFileSync(filePath, content, "utf-8");
    this.eventHandlers.fileUpdated?.(file, content);
  }

  private syncTasksFile(): void {
    if (this._tasks.length > 0) {
      const content = serializeTasksMd(this._tasks);
      const filePath = path.join(this.changeDir, "tasks.md");
      writeFileSync(filePath, content, "utf-8");
    }
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private buildProposal(idea: string): string {
    return `# Proposal: ${this.changeName}

## Why
${idea}

## What
<!-- AI will fill this section -->

## Scope
<!-- Boundaries and constraints -->

## Success Criteria
<!-- How do we know it's done? -->
`;
  }
}
