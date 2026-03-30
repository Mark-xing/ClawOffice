"use client";

/**
 * RoomBar — 房间信息条
 *
 * 显示:
 * - 房间名称
 * - 在线 Claw 头像 + 名称
 * - 本地/远程标识
 * - 邀请按钮 + 邀请码
 */
import { useState, memo } from "react";
import { useRoomStore } from "@/store/room-store";
import { sendCommand } from "@/lib/connection";

// Theme
const FONT = `"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", monospace`;
const SIZE = 12;
const GREEN = "var(--term-accent, #e8b040)";
const DIM = "var(--term-dim, #6a5c40)";
const TEXT = "var(--term-text, #c8b88a)";
const TEXT_BRIGHT = "var(--term-text-bright, #f0e6c8)";
const PANEL = "var(--term-panel, #201c16)";
const BORDER = "var(--term-border, #3a3428)";
const SEM_GREEN = "var(--sem-green, #4ade80)";

// Role badge colors
const ROLE_COLORS: Record<string, string> = {
  leader: "var(--sem-yellow, #facc15)",
  dev: GREEN,
  reviewer: "var(--sem-purple, #c084fc)",
  spectator: DIM,
};

const ClawAvatar = memo(function ClawAvatar({
  name,
  role,
  status,
  isLocal,
  backend,
}: {
  name: string;
  role: string;
  status: string;
  isLocal: boolean;
  backend: string;
}) {
  const roleColor = ROLE_COLORS[role] ?? DIM;
  const isOnline = status !== "offline";

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "3px 8px", borderRadius: 4,
        border: `1px solid ${isOnline ? `${roleColor}30` : `${DIM}20`}`,
        backgroundColor: isOnline ? `color-mix(in srgb, ${roleColor} 5%, transparent)` : "transparent",
        opacity: isOnline ? 1 : 0.4,
        transition: "opacity 0.2s, border-color 0.2s",
      }}
      title={`${name} (${backend}) — ${role} — ${isLocal ? "local" : "remote"}`}
    >
      {/* Status dot */}
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        backgroundColor: status === "working" ? SEM_GREEN :
                         status === "idle" ? GREEN :
                         status === "error" ? "var(--sem-red, #f87171)" : DIM,
        boxShadow: status === "working" ? `0 0 4px ${SEM_GREEN}60` : "none",
        flexShrink: 0,
      }} />
      {/* Name */}
      <span style={{
        fontFamily: FONT, fontSize: SIZE,
        color: isOnline ? TEXT_BRIGHT : DIM,
        maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {name}
      </span>
      {/* Role badge */}
      <span style={{
        fontFamily: FONT, fontSize: 9, fontWeight: 600,
        color: roleColor, letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        {role === "leader" ? "L" : role === "reviewer" ? "R" : ""}
      </span>
      {/* Remote indicator */}
      {!isLocal && (
        <span style={{
          fontFamily: FONT, fontSize: 9,
          color: DIM, opacity: 0.7,
        }}>🌐</span>
      )}
    </div>
  );
});

function RoomBar() {
  const {
    currentRoomId,
    currentRoomName,
    claws,
    activeInvite,
    specPhase,
  } = useRoomStore();

  const [showInvite, setShowInvite] = useState(false);

  if (!currentRoomId) return null;

  const clawList = Array.from(claws.values()).sort((a, b) => {
    // Leader first, then dev, then reviewer
    const roleOrder: Record<string, number> = { leader: 0, dev: 1, reviewer: 2, spectator: 3 };
    return (roleOrder[a.role ?? "dev"] ?? 9) - (roleOrder[b.role ?? "dev"] ?? 9);
  });

  const localCount = clawList.filter(c => c.isLocal).length;
  const remoteCount = clawList.filter(c => !c.isLocal).length;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "6px 14px",
      backgroundColor: PANEL,
      borderBottom: `1px solid ${BORDER}`,
      fontFamily: FONT, fontSize: SIZE,
      flexShrink: 0,
    }}>
      {/* Room name */}
      <span style={{
        color: GREEN, fontWeight: 600,
        letterSpacing: "0.04em",
      }}>
        🏠 {currentRoomName ?? currentRoomId}
      </span>

      {/* Separator */}
      <span style={{ color: `${DIM}40` }}>│</span>

      {/* Claw avatars */}
      <div style={{ display: "flex", gap: 4, flex: 1, overflowX: "auto", minWidth: 0 }}>
        {clawList.map(claw => (
          <ClawAvatar
            key={claw.clawId}
            name={claw.name}
            role={claw.role ?? "dev"}
            status={claw.status}
            isLocal={claw.isLocal}
            backend={claw.backend}
          />
        ))}
      </div>

      {/* Count */}
      <span style={{ color: DIM, fontSize: SIZE - 1, flexShrink: 0 }}>
        {localCount > 0 && `${localCount} local`}
        {localCount > 0 && remoteCount > 0 && " · "}
        {remoteCount > 0 && `${remoteCount} remote`}
      </span>

      {/* Invite button */}
      <button
        onClick={() => {
          if (!showInvite && currentRoomId) {
            sendCommand({
              type: "INVITE_CLAW",
              roomId: currentRoomId,
              maxUses: 5,
              expiresInMinutes: 30,
            } as any);
          }
          setShowInvite(!showInvite);
        }}
        style={{
          padding: "3px 10px", border: `1px solid ${BORDER}`,
          backgroundColor: "transparent", color: showInvite ? GREEN : DIM,
          fontFamily: FONT, fontSize: SIZE - 1, cursor: "pointer",
          borderRadius: 3, transition: "color 0.15s, border-color 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = GREEN; e.currentTarget.style.borderColor = `${GREEN}60`; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = showInvite ? GREEN : DIM; e.currentTarget.style.borderColor = BORDER; }}
      >
        + Invite
      </button>

      {/* Invite code popup */}
      {showInvite && activeInvite && (
        <div style={{
          position: "absolute", top: "100%", right: 14, marginTop: 4,
          padding: "10px 14px", zIndex: 50,
          backgroundColor: PANEL, border: `1px solid ${BORDER}`,
          borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          fontFamily: FONT, fontSize: SIZE,
        }}>
          <div style={{ color: DIM, marginBottom: 6, letterSpacing: "0.05em" }}>
            INVITE CODE
          </div>
          <div style={{
            fontSize: 20, fontWeight: 700, color: GREEN,
            letterSpacing: "0.15em", textAlign: "center",
            padding: "4px 0",
          }}>
            {activeInvite.code}
          </div>
          <div style={{ color: DIM, fontSize: SIZE - 2, marginTop: 4 }}>
            Valid for {Math.round((activeInvite.expiresAt - Date.now()) / 60000)}min
            · {activeInvite.maxUses - activeInvite.usedCount} uses left
          </div>
          <div style={{ color: DIM, fontSize: SIZE - 2, marginTop: 6 }}>
            <code style={{ color: TEXT, fontSize: SIZE - 1 }}>
              openclaw join ws://... --token {activeInvite.code}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoomBar;
