"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { folderPickCallbacks } from "@/store/office-store";
import { BACKEND_OPTIONS } from "./office-constants";
import { TERM_PANEL, TERM_SURFACE, TERM_DIM, TERM_TEXT_BRIGHT, TERM_BORDER, TERM_BG, TERM_GREEN, TERM_SEM_YELLOW } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import TermInput from "./primitives/TermInput";

function HireTeamModal({ agentDefs, onCreateTeam, onClose, assetsReady, detectedBackends }: {
  agentDefs: AgentDefinition[];
  onCreateTeam: (leadId: string, memberIds: string[], backends: Record<string, string>, workDir?: string, customNames?: Record<string, string>) => void;
  onClose: () => void;
  assetsReady?: boolean;
  detectedBackends?: string[];
}) {
  const leader = agentDefs.find((a) => a.teamRole === "leader");
  const reviewer = agentDefs.find((a) => a.teamRole === "reviewer");
  const devAgents = agentDefs.filter((a) => a.teamRole === "dev");

  // Multi-select: set of selected dev agent definition IDs
  const [selectedDevIds, setSelectedDevIds] = useState<Set<string>>(() => {
    return new Set(devAgents.length > 0 ? [devAgents[0].id] : []);
  });
  const [backends, setBackends] = useState<Record<string, string>>({});
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [workDir, setWorkDir] = useState<string>("");

  const setName = (defId: string, name: string) => {
    setCustomNames((prev) => ({ ...prev, [defId]: name }));
  };

  const toggleDev = (defId: string) => {
    setSelectedDevIds((prev) => {
      const next = new Set(prev);
      if (next.has(defId)) {
        // Don't allow deselecting the last one
        if (next.size > 1) next.delete(defId);
      } else {
        next.add(defId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedDevIds(new Set(devAgents.map((d) => d.id)));
  };

  const handleCreate = () => {
    if (!leader) return;
    const memberIds: string[] = [...selectedDevIds];
    if (reviewer) memberIds.push(reviewer.id);
    // Only pass non-empty custom names
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(customNames)) {
      if (name.trim()) names[id] = name.trim();
    }
    onCreateTeam(leader.id, memberIds, backends, workDir || undefined, Object.keys(names).length > 0 ? names : undefined);
  };

  const fixedRows: { def: AgentDefinition; label: string }[] = [];
  if (leader) fixedRows.push({ def: leader, label: "LEAD" });
  if (reviewer) fixedRows.push({ def: reviewer, label: "REVIEWER" });

  return (
    <TermModal
      open={true}
      onClose={onClose}
      maxWidth={540}
      zIndex={100}
      title="Hire Team"
      footer={
        <>
          <TermButton variant="primary" onClick={handleCreate} disabled={!leader || selectedDevIds.size === 0} style={{ flex: 1, fontWeight: 700 }}>
            Create Team ({1 + selectedDevIds.size + (reviewer ? 1 : 0)} members)
          </TermButton>
          <TermButton variant="dim" onClick={onClose}>Cancel</TermButton>
        </>
      }
    >
      {/* Working directory picker */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>PROJECT DIRECTORY</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <TermInput
            type="text"
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="Paste path or click Browse"
            style={{ flex: 1 }}
          />
          <TermButton
            variant="dim"
            onClick={() => {
              const rid = nanoid(6);
              folderPickCallbacks.set(rid, (p) => setWorkDir(p));
              sendCommand({ type: "PICK_FOLDER", requestId: rid });
            }}
          >Browse</TermButton>
        </div>
        <div style={{ fontSize: 10, color: TERM_DIM, marginTop: 3, fontFamily: "var(--font-mono)", opacity: 0.7 }}>
          Empty = default workspace
        </div>
      </div>

      <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 6, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>SELECT TEAM MEMBERS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        {/* Fixed rows: leader and reviewer */}
        {fixedRows.map(({ def, label }) => (
          <div
            key={def.id}
            title={def.skills ? `Skills: ${def.skills}` : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
              border: `1px solid ${TERM_SEM_YELLOW}70`,
              backgroundColor: TERM_SURFACE,
              textAlign: "left",
            }}
          >
            <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="text"
                  value={customNames[def.id] ?? ""}
                  onChange={(e) => setName(def.id, e.target.value)}
                  placeholder={def.name}
                  style={{
                    width: 80, padding: "2px 6px", fontSize: 14, fontWeight: 700,
                    color: TERM_TEXT_BRIGHT, backgroundColor: "transparent",
                    border: `1px solid ${customNames[def.id] ? TERM_GREEN + "60" : TERM_BORDER}`,
                    fontFamily: "inherit", outline: "none",
                    transition: "border-color 0.15s",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = TERM_GREEN; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = customNames[def.id] ? TERM_GREEN + "60" : TERM_BORDER; }}
                />
                <span style={{ color: TERM_SEM_YELLOW, fontSize: 11, fontFamily: "var(--font-mono)" }}>{label}</span>
              </div>
              <div style={{ fontSize: 13, color: TERM_DIM }}>{def.role}</div>
            </div>
            <select
              value={backends[def.id] ?? "codebuddy"}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setBackends((prev) => ({ ...prev, [def.id]: e.target.value }))}
              style={{
                padding: "3px 6px", border: `1px solid ${TERM_BORDER}`,
                backgroundColor: TERM_BG, color: TERM_DIM, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
              }}
            >
              {BACKEND_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{detectedBackends && detectedBackends.length > 0 && !detectedBackends.includes(b.id) ? " (?)" : ""}</option>
              ))}
            </select>
          </div>
        ))}

        {/* Dev cards — multi-select */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, marginBottom: 4 }}>
          <div style={{ fontSize: 12, color: TERM_DIM, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
            DEV AGENTS — select multiple
          </div>
          <button
            onClick={selectAll}
            style={{
              background: "none", border: `1px solid ${TERM_BORDER}`, cursor: "pointer",
              color: TERM_DIM, fontSize: 11, padding: "2px 8px", fontFamily: "var(--font-mono)",
              transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TERM_GREEN; e.currentTarget.style.borderColor = TERM_GREEN; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = TERM_DIM; e.currentTarget.style.borderColor = TERM_BORDER; }}
          >
            Select All
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
          {devAgents.map((def) => {
            const selected = selectedDevIds.has(def.id);
            return (
              <button
                key={def.id}
                onClick={() => toggleDev(def.id)}
                title={def.skills ? `Skills: ${def.skills}` : undefined}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: "12px 6px 10px",
                  border: selected ? `1px solid ${TERM_GREEN}60` : `1px solid ${TERM_BORDER}`,
                  backgroundColor: selected ? `${TERM_GREEN}0a` : "transparent",
                  cursor: "pointer", textAlign: "center",
                  opacity: selected ? 1 : 0.5,
                  transition: "opacity 0.15s, border-color 0.15s, background-color 0.15s",
                  position: "relative",
                }}
              >
                {/* Selection indicator */}
                {selected && (
                  <span style={{
                    position: "absolute", top: 4, right: 6,
                    fontSize: 14, color: TERM_GREEN, fontWeight: 700, lineHeight: 1,
                  }}>✓</span>
                )}
                <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                <input
                  type="text"
                  value={customNames[def.id] ?? ""}
                  onChange={(e) => { e.stopPropagation(); setName(def.id, e.target.value); }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={def.name}
                  style={{
                    width: "90%", marginTop: 6, padding: "2px 4px", fontSize: 13, fontWeight: 700,
                    color: TERM_TEXT_BRIGHT, backgroundColor: "transparent", textAlign: "center",
                    border: `1px solid ${customNames[def.id] ? TERM_GREEN + "60" : TERM_BORDER}`,
                    fontFamily: "inherit", outline: "none",
                    transition: "border-color 0.15s",
                  }}
                  onFocus={(e) => { e.stopPropagation(); e.currentTarget.style.borderColor = TERM_GREEN; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = customNames[def.id] ? TERM_GREEN + "60" : TERM_BORDER; }}
                />
                <div style={{ fontSize: 12, color: TERM_DIM, marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                <select
                  value={backends[def.id] ?? "codebuddy"}
                  onClick={(e) => { e.stopPropagation(); if (!selected) toggleDev(def.id); }}
                  onChange={(e) => {
                    if (!selectedDevIds.has(def.id)) toggleDev(def.id);
                    setBackends((prev) => ({ ...prev, [def.id]: e.target.value }));
                  }}
                  style={{
                    marginTop: 6, padding: "3px 6px", border: `1px solid ${TERM_BORDER}`,
                    backgroundColor: TERM_BG, color: TERM_DIM, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
                  }}
                >
                  {BACKEND_OPTIONS.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{detectedBackends && detectedBackends.length > 0 && !detectedBackends.includes(b.id) ? " (?)" : ""}</option>
                  ))}
                </select>
              </button>
            );
          })}
        </div>

        {/* Selection summary */}
        {selectedDevIds.size > 0 && (
          <div style={{
            fontSize: 11, color: TERM_GREEN, fontFamily: "var(--font-mono)",
            marginTop: 6, padding: "4px 8px",
            backgroundColor: `${TERM_GREEN}08`,
            border: `1px solid ${TERM_GREEN}20`,
          }}>
            {selectedDevIds.size} dev agent{selectedDevIds.size > 1 ? "s" : ""} selected
            {selectedDevIds.size > 1 && " — Lead will coordinate parallel work"}
          </div>
        )}
      </div>
    </TermModal>
  );
}

export default HireTeamModal;
