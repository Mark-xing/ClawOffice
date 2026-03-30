/**
 * TaskRunner — 在本地执行 AI CLI 后端任务
 *
 * 当 Room Server 分配任务给这个 OpenClaw 时:
 * 1. 构建 AI CLI 命令（如 claude -p "..." --output-format stream-json）
 * 2. 在本地 spawn 子进程执行
 * 3. 解析输出（流式 JSON 或 plain text）
 * 4. 实时上报进度给 Room Server
 * 5. 完成后上报结果
 */
import { spawn, type ChildProcess } from "child_process";
import type { ClawClient } from "./claw-client.js";

// ---------------------------------------------------------------------------
// Backend definitions (simplified from gateway's backends.ts)
// ---------------------------------------------------------------------------

interface BackendConfig {
  id: string;
  command: string;
  buildArgs: (prompt: string) => string[];
}

const BACKENDS: Record<string, BackendConfig> = {
  claude: {
    id: "claude",
    command: "claude",
    buildArgs: (prompt) => ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
  },
  codebuddy: {
    id: "codebuddy",
    command: "codebuddy",
    buildArgs: (prompt) => ["-p", prompt, "--output-format", "stream-json", "--dangerously-skip-permissions"],
  },
  codex: {
    id: "codex",
    command: "codex",
    buildArgs: (prompt) => ["exec", prompt, "--full-auto", "--skip-git-repo-check"],
  },
  gemini: {
    id: "gemini",
    command: "gemini",
    buildArgs: (prompt) => ["-p", prompt, "--yolo"],
  },
};

// ---------------------------------------------------------------------------
// TaskRunner
// ---------------------------------------------------------------------------

export interface TaskRunnerOptions {
  /** AI backend (claude/codex/gemini...) */
  backend: string;
  /** Working directory */
  cwd: string;
  /** ClawClient for reporting progress */
  client: ClawClient;
}

export class TaskRunner {
  private backendConfig: BackendConfig;
  private cwd: string;
  private client: ClawClient;
  private process: ChildProcess | null = null;
  private currentTaskId: string | null = null;

  constructor(opts: TaskRunnerOptions) {
    this.backendConfig = BACKENDS[opts.backend] ?? BACKENDS.claude;
    this.cwd = opts.cwd;
    this.client = opts.client;
  }

  /** 执行一个任务 */
  async runTask(taskId: string, prompt: string): Promise<{ success: boolean; output: string }> {
    if (this.process) {
      console.warn(`[TaskRunner] Already running task ${this.currentTaskId}, queueing ${taskId}`);
      // TODO: 任务队列
      return { success: false, output: "Another task is already running" };
    }

    this.currentTaskId = taskId;
    this.client.reportStatus("working");
    this.client.reportTaskProgress(taskId, "working");

    console.log(`[TaskRunner] Running task ${taskId}: ${prompt.slice(0, 80)}...`);
    console.log(`[TaskRunner] Backend: ${this.backendConfig.id}, CWD: ${this.cwd}`);

    return new Promise((resolve) => {
      const args = this.backendConfig.buildArgs(prompt);
      let stdout = "";
      let stderr = "";

      try {
        this.process = spawn(this.backendConfig.command, args, {
          cwd: this.cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        });

        this.process.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;

          // 尝试解析 stream-json 获取进度
          for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("{")) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.type === "assistant" && msg.message?.content) {
                for (const block of msg.message.content) {
                  if (block.type === "tool_use" && block.name) {
                    // 上报工具使用活动
                    this.client.send({
                      type: "TASK_UPDATE",
                      roomId: this.client.roomState?.roomId,
                      taskId,
                      status: "working",
                      activity: `Using ${block.name}`,
                    });
                  }
                }
              }
            } catch { /* not JSON, ignore */ }
          }
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        this.process.on("close", (code) => {
          this.process = null;
          this.currentTaskId = null;

          const success = code === 0;
          const output = this.extractSummary(stdout) || stdout.slice(-500) || stderr.slice(-200) || `Exit code: ${code}`;

          console.log(`[TaskRunner] Task ${taskId} ${success ? "completed" : "failed"} (code=${code}, ${stdout.length}ch)`);

          this.client.reportTaskProgress(taskId, success ? "done" : "failed", output);
          this.client.reportStatus("idle");

          resolve({ success, output });
        });

        this.process.on("error", (err) => {
          this.process = null;
          this.currentTaskId = null;

          console.error(`[TaskRunner] Spawn error: ${err.message}`);

          this.client.reportTaskProgress(taskId, "failed", err.message);
          this.client.reportStatus("idle");

          resolve({ success: false, output: err.message });
        });
      } catch (err) {
        this.process = null;
        this.currentTaskId = null;

        const msg = (err as Error).message;
        this.client.reportTaskProgress(taskId, "failed", msg);
        this.client.reportStatus("idle");

        resolve({ success: false, output: msg });
      }
    });
  }

  /** 取消当前任务 */
  cancel(): void {
    if (this.process?.pid) {
      try { process.kill(-this.process.pid, "SIGKILL"); } catch {
        try { this.process.kill("SIGKILL"); } catch { /* dead */ }
      }
    }
  }

  /** 从输出中提取摘要 */
  private extractSummary(stdout: string): string {
    // 尝试从 stream-json 的 result 消息中提取
    const lines = stdout.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith("{")) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "result" && msg.result) {
          return msg.result.slice(0, 500);
        }
      } catch { continue; }
    }

    // Fallback: 取最后几行非空文本
    const textLines = stdout.split("\n").map(l => l.trim()).filter(Boolean);
    return textLines.slice(-5).join("\n").slice(0, 500);
  }
}
