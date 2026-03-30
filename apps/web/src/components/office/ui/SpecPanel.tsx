"use client";

/**
 * SpecPanel — OpenSpec 工作流面板
 *
 * 显示当前 Spec 阶段、proposal/design/tasks 文件内容、任务进度。
 * 嵌入到主界面侧边或底部。
 */
import { useState, memo } from "react";
import { useRoomStore, type SpecTaskState, type SpecFileState } from "@/store/room-store";
import { sendCommand } from "@/lib/connection";
import type { SpecPhase } from "@office/shared";

// ── Theme (reuse existing terminal theme) ──
const FONT = `"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", monospace`;
const SIZE = 13;
const GREEN = "var(--term-accent, #e8b040)";
const DIM = "var(--term-dim, #6a5c40)";
const TEXT = "var(--term-text, #c8b88a)";
const TEXT_BRIGHT = "var(--term-text-bright, #f0e6c8)";
const BG = "var(--term-bg, #1a1814)";
const PANEL = "var(--term-panel, #201c16)";
const BORDER = "var(--term-border, #3a3428)";
const SEM_GREEN = "var(--sem-green, #4ade80)";
const SEM_YELLOW = "var(--sem-yellow, #facc15)";
const SEM_BLUE = "var(--sem-blue, #60a5fa)";
const SEM_RED = "var(--sem-red, #f87171)";

// ── Phase info ──
const PHASE_CONFIG: Record<SpecPhase, { icon: string; label: string; color: string; hint: string }> = {
  propose: { icon: "💡", label: "PROPOSE", color: SEM_BLUE, hint: "Define what to build" },
  plan: { icon: "📋", label: "PLAN", color: SEM_YELLOW, hint: "Review specs, design & tasks" },
  apply: { icon: "⚡", label: "APPLY", color: GREEN, hint: "Executing tasks" },
  archive: { icon: "📦", label: "ARCHIVE", color: SEM_GREEN, hint: "Project archived" },
};

// ── Task status icons ──
function taskIcon(status: string): string {
  switch (status) {
    case "done": return "✅";
    case "working": return "🔨";
    case "assigned": return "📌";
    case "failed": return "❌";
    case "skipped": return "⏭";
    default: return "⬜";
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const PhaseIndicator = memo(function PhaseIndicator({ phase }: { phase: SpecPhase | null }) {
  if (!phase) {
    return (
      <div style={{ padding: "12px 16px", fontFamily: FONT, fontSize: SIZE, color: DIM }}>
        No active spec — start with a proposal
      </div>
    );
  }

  const cfg = PHASE_CONFIG[phase];
  const phases: SpecPhase[] = ["propose", "plan", "apply", "archive"];
  const currentIdx = phases.indexOf(phase);

  return (
    <div style={{ padding: "10px 16px" }}>
      {/* Phase progress bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {phases.map((p, i) => {
          const pcfg = PHASE_CONFIG[p];
          const isActive = p === phase;
          const isDone = i < currentIdx;
          return (
            <div key={p} style={{
              flex: 1, height: 3, borderRadius: 2,
              backgroundColor: isDone ? `${SEM_GREEN}60` : isActive ? cfg.color : `${DIM}30`,
              transition: "background-color 0.3s",
            }} />
          );
        })}
      </div>
      {/* Current phase */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT }}>
        <span style={{ fontSize: 16 }}>{cfg.icon}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
          color: cfg.color, textTransform: "uppercase",
          padding: "1px 6px", borderRadius: 3,
          background: `color-mix(in srgb, ${cfg.color} 12%, transparent)`,
        }}>{cfg.label}</span>
        <span style={{ fontSize: SIZE - 1, color: DIM }}>{cfg.hint}</span>
      </div>
    </div>
  );
});

const TaskList = memo(function TaskList({
  tasks,
  clawNames,
}: {
  tasks: SpecTaskState[];
  clawNames: Map<string, string>;
}) {
  if (tasks.length === 0) return null;

  const done = tasks.filter(t => t.status === "done").length;
  const total = tasks.length;

  return (
    <div style={{ padding: "0 16px 12px" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
        fontFamily: FONT, fontSize: SIZE - 1, color: DIM,
        letterSpacing: "0.05em",
      }}>
        <span>TASKS</span>
        <span style={{ color: done === total ? SEM_GREEN : TEXT }}>
          {done}/{total}
        </span>
        {/* Mini progress bar */}
        <div style={{
          flex: 1, height: 2, borderRadius: 1,
          backgroundColor: `${DIM}30`,
        }}>
          <div style={{
            width: `${(done / total) * 100}%`,
            height: "100%", borderRadius: 1,
            backgroundColor: done === total ? SEM_GREEN : GREEN,
            transition: "width 0.3s",
          }} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {tasks.map(task => (
          <div key={task.taskId} style={{
            display: "flex", alignItems: "flex-start", gap: 6,
            fontFamily: FONT, fontSize: SIZE - 1,
            opacity: task.status === "done" ? 0.5 : 1,
            lineHeight: 1.6,
          }}>
            <span style={{ flexShrink: 0, width: 18, textAlign: "center" }}>
              {taskIcon(task.status)}
            </span>
            <span style={{ color: DIM, flexShrink: 0, width: 28 }}>{task.taskId}</span>
            <span style={{
              color: task.status === "done" ? DIM : TEXT,
              flex: 1, minWidth: 0,
              textDecoration: task.status === "done" ? "line-through" : "none",
            }}>
              {task.description}
            </span>
            {task.assignee && (
              <span style={{
                color: GREEN, fontSize: SIZE - 2, flexShrink: 0,
                padding: "0 4px", borderRadius: 2,
                background: `color-mix(in srgb, ${GREEN} 10%, transparent)`,
              }}>
                {clawNames.get(task.assignee) ?? task.assignee.slice(-6)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

const SpecFileViewer = memo(function SpecFileViewer({
  files,
}: {
  files: Map<string, SpecFileState>;
}) {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const fileList = Array.from(files.entries()).sort((a, b) => {
    // Order: proposal.md → design.md → tasks.md → specs/*
    const order = ["proposal.md", "design.md", "tasks.md"];
    const ai = order.indexOf(a[0]);
    const bi = order.indexOf(b[0]);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a[0].localeCompare(b[0]);
  });

  if (fileList.length === 0) return null;

  const selected = activeTab ?? fileList[0]?.[0];
  const selectedFile = files.get(selected ?? "");

  return (
    <div style={{ borderTop: `1px solid ${BORDER}` }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 0, overflowX: "auto",
        borderBottom: `1px solid ${BORDER}`,
      }}>
        {fileList.map(([name]) => (
          <button
            key={name}
            onClick={() => setActiveTab(name)}
            style={{
              padding: "6px 12px",
              fontFamily: FONT, fontSize: SIZE - 1,
              color: name === selected ? TEXT_BRIGHT : DIM,
              backgroundColor: name === selected ? `${GREEN}08` : "transparent",
              border: "none",
              borderBottom: name === selected ? `2px solid ${GREEN}` : "2px solid transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {name.replace("specs/", "📄 ")}
          </button>
        ))}
      </div>
      {/* File content */}
      {selectedFile && (
        <div
          data-scrollbar
          style={{
            padding: "10px 16px",
            maxHeight: 200, overflowY: "auto",
            fontFamily: FONT, fontSize: SIZE - 1,
            color: TEXT, lineHeight: 1.7,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}
        >
          {selectedFile.content}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function SpecPanel() {
  const {
    specPhase,
    specFiles,
    specTasks,
    claws,
    currentRoomId,
  } = useRoomStore();

  // Build claw name lookup
  const clawNames = new Map<string, string>();
  for (const [id, claw] of claws) {
    clawNames.set(id, claw.name);
  }

  if (!currentRoomId) return null;

  return (
    <div style={{
      backgroundColor: PANEL,
      borderTop: `1px solid ${BORDER}`,
      fontFamily: FONT,
      fontSize: SIZE,
    }}>
      <PhaseIndicator phase={specPhase} />
      <TaskList tasks={specTasks} clawNames={clawNames} />
      <SpecFileViewer files={specFiles} />
    </div>
  );
}

export default SpecPanel;
