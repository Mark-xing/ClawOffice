"use client";

/**
 * RoomSwitcher — 多房间选择器
 *
 * 显示已有房间列表，支持创建新房间和切换。
 * 集成到顶部工具栏或侧边栏。
 */
import { useState, memo } from "react";
import { useRoomStore, type RoomInfo } from "@/store/room-store";
import { sendCommand } from "@/lib/connection";

const FONT = `"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", monospace`;
const SIZE = 12;
const GREEN = "var(--term-accent, #e8b040)";
const DIM = "var(--term-dim, #6a5c40)";
const TEXT = "var(--term-text, #c8b88a)";
const TEXT_BRIGHT = "var(--term-text-bright, #f0e6c8)";
const PANEL = "var(--term-panel, #201c16)";
const BORDER = "var(--term-border, #3a3428)";
const SEM_GREEN = "var(--sem-green, #4ade80)";
const SEM_YELLOW = "var(--sem-yellow, #facc15)";

const PHASE_ICONS: Record<string, string> = {
  propose: "💡",
  plan: "📋",
  apply: "⚡",
  archive: "📦",
};

const RoomCard = memo(function RoomCard({
  room,
  isActive,
  onClick,
}: {
  room: RoomInfo;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", width: "100%",
        border: isActive ? `1px solid ${GREEN}50` : `1px solid ${BORDER}`,
        backgroundColor: isActive ? `color-mix(in srgb, ${GREEN} 6%, transparent)` : "transparent",
        cursor: "pointer", textAlign: "left",
        fontFamily: FONT, fontSize: SIZE,
        transition: "border-color 0.15s, background-color 0.15s",
        borderRadius: 4,
      }}
    >
      {/* Phase icon */}
      <span style={{ fontSize: 14, flexShrink: 0 }}>
        {room.specPhase ? PHASE_ICONS[room.specPhase] ?? "🏠" : "🏠"}
      </span>
      {/* Room info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: isActive ? TEXT_BRIGHT : TEXT,
          fontWeight: isActive ? 600 : 400,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {room.name}
        </div>
        <div style={{ color: DIM, fontSize: SIZE - 2, marginTop: 1 }}>
          {room.clawCount} claw{room.clawCount !== 1 ? "s" : ""}
          {room.specPhase && ` · ${room.specPhase}`}
        </div>
      </div>
      {/* Active indicator */}
      {isActive && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          backgroundColor: SEM_GREEN,
          boxShadow: `0 0 4px ${SEM_GREEN}60`,
          flexShrink: 0,
        }} />
      )}
    </button>
  );
});

function RoomSwitcher() {
  const { rooms, currentRoomId, setCurrentRoom } = useRoomStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const handleCreate = () => {
    if (!newRoomName.trim()) return;
    sendCommand({ type: "CREATE_ROOM", name: newRoomName.trim() } as any);
    setNewRoomName("");
    setShowCreate(false);
  };

  const handleSwitch = (room: RoomInfo) => {
    setCurrentRoom(room.roomId, room.name);
    sendCommand({ type: "JOIN_ROOM", roomId: room.roomId } as any);
  };

  return (
    <div style={{
      padding: "10px 12px",
      fontFamily: FONT, fontSize: SIZE,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <span style={{
          color: DIM, fontSize: SIZE - 1,
          letterSpacing: "0.06em", textTransform: "uppercase",
        }}>ROOMS</span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: "2px 8px", border: `1px solid ${BORDER}`,
            backgroundColor: "transparent", color: DIM,
            fontFamily: FONT, fontSize: SIZE - 1, cursor: "pointer",
            borderRadius: 3,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = GREEN; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = DIM; }}
        >
          + New
        </button>
      </div>

      {/* Create room input */}
      {showCreate && (
        <div style={{
          display: "flex", gap: 4, marginBottom: 8,
        }}>
          <input
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            placeholder="Room name..."
            autoFocus
            style={{
              flex: 1, padding: "5px 8px",
              border: `1px solid ${BORDER}`,
              backgroundColor: "transparent", color: TEXT_BRIGHT,
              fontFamily: FONT, fontSize: SIZE, outline: "none",
              borderRadius: 3,
            }}
          />
          <button
            onClick={handleCreate}
            disabled={!newRoomName.trim()}
            style={{
              padding: "5px 10px", border: `1px solid ${GREEN}60`,
              backgroundColor: "transparent",
              color: newRoomName.trim() ? GREEN : DIM,
              fontFamily: FONT, fontSize: SIZE, cursor: newRoomName.trim() ? "pointer" : "default",
              borderRadius: 3,
            }}
          >Create</button>
        </div>
      )}

      {/* Room list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rooms.length === 0 && (
          <div style={{ color: DIM, padding: "8px 0", textAlign: "center" }}>
            No rooms yet
          </div>
        )}
        {rooms.map(room => (
          <RoomCard
            key={room.roomId}
            room={room}
            isActive={room.roomId === currentRoomId}
            onClick={() => handleSwitch(room)}
          />
        ))}
      </div>
    </div>
  );
}

export default RoomSwitcher;
