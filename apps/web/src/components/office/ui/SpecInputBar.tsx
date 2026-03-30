"use client";

/**
 * SpecInputBar — OpenSpec 工作流交互入口
 *
 * 根据当前 Spec 阶段显示不同的操作界面：
 * - 无阶段 / archive: 输入框 → SPEC_PROPOSE
 * - propose: 显示 proposal，等待 Leader 生成计划
 * - plan: 显示 Approve / Feedback 按钮
 * - apply: 显示进度，可追加反馈
 * - archive: 显示完成，可开始新项目
 */
import { useState, useRef, useEffect } from "react";
import { useRoomStore } from "@/store/room-store";
import { sendCommand } from "@/lib/connection";
import type { SpecPhase } from "@office/shared";

const FONT = `"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", monospace`;
const SIZE = 13;
const GREEN = "var(--term-accent, #e8b040)";
const DIM = "var(--term-dim, #6a5c40)";
const TEXT = "var(--term-text, #c8b88a)";
const TEXT_BRIGHT = "var(--term-text-bright, #f0e6c8)";
const PANEL = "var(--term-panel, #201c16)";
const BORDER = "var(--term-border, #3a3428)";
const SEM_GREEN = "var(--sem-green, #4ade80)";
const SEM_YELLOW = "var(--sem-yellow, #facc15)";

function SpecInputBar() {
  const { specPhase, currentRoomId, specTasks, claws } = useRoomStore();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const clawCount = claws.size;
  const busyCount = Array.from(claws.values()).filter(c => c.status === "working").length;
  const doneTasks = specTasks.filter(t => t.status === "done").length;
  const totalTasks = specTasks.length;

  if (!currentRoomId) return null;

  const submit = () => {
    const text = input.trim();
    if (!text) return;

    if (!specPhase || specPhase === "archive") {
      // 发起新提案
      sendCommand({ type: "SPEC_PROPOSE", roomId: currentRoomId, idea: text } as any);
    } else if (specPhase === "plan") {
      // 对计划给反馈
      sendCommand({ type: "SPEC_FEEDBACK", roomId: currentRoomId, feedback: text } as any);
    } else if (specPhase === "apply") {
      // 执行中追加反馈
      sendCommand({ type: "SPEC_FEEDBACK", roomId: currentRoomId, feedback: text } as any);
    }
    setInput("");
  };

  const approve = () => {
    sendCommand({ type: "SPEC_APPROVE", roomId: currentRoomId } as any);
  };

  const archive = () => {
    sendCommand({ type: "SPEC_ARCHIVE", roomId: currentRoomId } as any);
  };

  // ── Render based on phase ──

  // No phase or archived → propose new
  if (!specPhase || specPhase === "archive") {
    return (
      <div style={{
        display: "flex", gap: 6, alignItems: "flex-end",
        padding: "10px 14px",
        backgroundColor: PANEL,
        borderTop: `1px solid ${BORDER}`,
        fontFamily: FONT,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: SIZE - 2, color: DIM, marginBottom: 4,
            letterSpacing: "0.05em",
          }}>
            {clawCount > 0
              ? `💡 ${clawCount} claw${clawCount > 1 ? "s" : ""} ready — describe what to build`
              : "💡 Describe what to build (hire claws first)"
            }
          </div>
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Build a dark mode toggle with system preference detection..."
            style={{
              width: "100%", padding: "8px 10px",
              border: `1px solid ${BORDER}`,
              backgroundColor: "transparent",
              color: TEXT_BRIGHT, fontSize: SIZE,
              fontFamily: FONT, outline: "none",
              resize: "none", lineHeight: "20px",
              caretColor: GREEN,
            }}
          />
        </div>
        <button
          onClick={submit}
          disabled={!input.trim()}
          style={{
            padding: "8px 16px",
            border: `1px solid ${input.trim() ? `${GREEN}60` : BORDER}`,
            backgroundColor: "transparent",
            color: input.trim() ? GREEN : DIM,
            fontSize: SIZE, fontFamily: FONT,
            cursor: input.trim() ? "pointer" : "default",
            fontWeight: 600, flexShrink: 0,
            marginBottom: 1,
          }}
        >
          Propose
        </button>
      </div>
    );
  }

  // Propose phase → waiting for Leader to generate plan
  if (specPhase === "propose") {
    return (
      <div style={{
        padding: "10px 14px",
        backgroundColor: PANEL,
        borderTop: `1px solid ${BORDER}`,
        fontFamily: FONT, fontSize: SIZE,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span className="working-dots" style={{ color: GREEN }}>
          <span className="working-dots-mid" />
        </span>
        <span style={{ color: DIM }}>Leader is analyzing your proposal...</span>
      </div>
    );
  }

  // Plan phase → Approve or give feedback
  if (specPhase === "plan") {
    return (
      <div style={{
        padding: "10px 14px",
        backgroundColor: PANEL,
        borderTop: `1px solid ${BORDER}`,
        fontFamily: FONT,
      }}>
        <div style={{
          display: "flex", gap: 6, alignItems: "center",
        }}>
          <button
            onClick={approve}
            style={{
              padding: "7px 18px",
              border: `1px solid ${SEM_GREEN}60`,
              backgroundColor: "transparent",
              color: SEM_GREEN, fontSize: SIZE,
              fontFamily: FONT, cursor: "pointer",
              fontWeight: 600, flexShrink: 0,
            }}
          >
            ✓ Approve & Execute
          </button>
          <div style={{
            flex: 1, display: "flex", alignItems: "center",
            border: `1px solid ${BORDER}`,
            padding: "0 2px",
          }}>
            <span style={{ color: DIM, fontSize: SIZE, padding: "0 6px" }}>&gt;</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
              }}
              placeholder="or give feedback on the plan..."
              style={{
                flex: 1, padding: "7px 4px",
                border: "none", backgroundColor: "transparent",
                color: TEXT_BRIGHT, fontSize: SIZE,
                fontFamily: FONT, outline: "none",
                caretColor: GREEN,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Apply phase → show progress + optional feedback
  if (specPhase === "apply") {
    return (
      <div style={{
        padding: "10px 14px",
        backgroundColor: PANEL,
        borderTop: `1px solid ${BORDER}`,
        fontFamily: FONT,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
          fontSize: SIZE - 1,
        }}>
          <span style={{ color: GREEN }}>⚡ Executing</span>
          <span style={{ color: DIM }}>
            {doneTasks}/{totalTasks} tasks · {busyCount} claw{busyCount !== 1 ? "s" : ""} working
          </span>
          {/* Progress bar */}
          <div style={{
            flex: 1, height: 3, borderRadius: 2,
            backgroundColor: `${DIM}30`,
          }}>
            <div style={{
              width: totalTasks > 0 ? `${(doneTasks / totalTasks) * 100}%` : "0%",
              height: "100%", borderRadius: 2,
              backgroundColor: doneTasks === totalTasks ? SEM_GREEN : GREEN,
              transition: "width 0.3s",
            }} />
          </div>
          {doneTasks === totalTasks && totalTasks > 0 && (
            <button
              onClick={archive}
              style={{
                padding: "4px 12px",
                border: `1px solid ${SEM_GREEN}60`,
                backgroundColor: "transparent",
                color: SEM_GREEN, fontSize: SIZE - 1,
                fontFamily: FONT, cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Archive ✓
            </button>
          )}
        </div>
        <div style={{
          display: "flex", alignItems: "center",
          border: `1px solid ${BORDER}`,
          padding: "0 2px",
        }}>
          <span style={{ color: DIM, fontSize: SIZE, padding: "0 6px" }}>&gt;</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(); }
            }}
            placeholder="add feedback or request changes..."
            style={{
              flex: 1, padding: "6px 4px",
              border: "none", backgroundColor: "transparent",
              color: TEXT_BRIGHT, fontSize: SIZE,
              fontFamily: FONT, outline: "none",
              caretColor: GREEN,
            }}
          />
        </div>
      </div>
    );
  }

  return null;
}

export default SpecInputBar;
