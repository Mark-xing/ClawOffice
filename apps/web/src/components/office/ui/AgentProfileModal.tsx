"use client";

import { useEffect, useState, useRef } from "react";
import type { AgentDefinition } from "@office/shared";
import { useOfficeStore } from "@/store/office-store";
import SpriteAvatar from "./SpriteAvatar";
import { BACKEND_OPTIONS, getStatusConfig } from "./office-constants";
import {
  TERM_BG, TERM_PANEL, TERM_SURFACE, TERM_BORDER, TERM_BORDER_DIM,
  TERM_TEXT, TERM_TEXT_BRIGHT, TERM_DIM, TERM_GREEN, TERM_SEM_BLUE,
  TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SEM_RED,
} from "./termTheme";

interface McpServer {
  command?: string;
  args?: string[];
  url?: string;
  tools?: string[];
}

interface AgentProfileProps {
  agentId: string;
  name: string;
  role: string;
  palette?: number;
  personality?: string;
  backend?: string;
  status: string;
  teamId?: string;
  isTeamLead?: boolean;
  isExternal?: boolean;
  workDir?: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  /** Matched agent definition (for skillFiles) */
  agentDef?: AgentDefinition | null;
  /** Available skill metadata */
  availableSkills: Array<{ name: string; title: string; isFolder: boolean }>;
  /** Global MCP config from ~/.codebuddy/mcp.json */
  mcpServers: Record<string, McpServer>;
  /** Send command to gateway */
  sendCommand: (cmd: any) => void;
  assetsReady?: boolean;
  onClose: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function StatusDot({ status }: { status: string }) {
  const cfg = getStatusConfig();
  const s = cfg[status] ?? cfg.idle;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        backgroundColor: s.color,
        boxShadow: `0 0 6px ${s.color}80`,
        display: "inline-block",
      }} />
      <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, color: TERM_DIM, fontFamily: "var(--font-mono)",
      letterSpacing: "0.1em", textTransform: "uppercase",
      marginBottom: 8, paddingBottom: 4,
      borderBottom: `1px solid ${TERM_BORDER_DIM}`,
    }}>
      {children}
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", fontSize: 12,
      fontFamily: "var(--font-mono)", fontWeight: 600,
      color, backgroundColor: `${color}15`,
      border: `1px solid ${color}40`,
    }}>
      {children}
    </span>
  );
}

export default function AgentProfileModal({
  agentId, name, role, palette, personality, backend, status,
  teamId, isTeamLead, isExternal, workDir, tokenUsage,
  agentDef, availableSkills, mcpServers, sendCommand, assetsReady, onClose,
}: AgentProfileProps) {
  const backendInfo = BACKEND_OPTIONS.find(b => b.id === backend);
  const initialSkills = agentDef?.skillFiles ?? [];
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set(initialSkills));
  const [skillsDirty, setSkillsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clawhubInput, setClawhubInput] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<{ message: string; success: boolean } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const clawhubResults = useOfficeStore(s => s.clawhubSearchResults);

  // Debounced search as user types
  useEffect(() => {
    if (!clawhubInput.trim() || clawhubInput.trim().length < 2) {
      setDropdownOpen(false);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      sendCommand({ type: "SEARCH_CLAWHUB_SKILLS", query: clawhubInput.trim() });
      setDropdownOpen(true);
    }, 500);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [clawhubInput, sendCommand]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleInstallSkill = (slug: string, title: string) => {
    setInstalling(slug);
    setInstallStatus(null);
    setDropdownOpen(false);
    setClawhubInput("");
    sendCommand({ type: "INSTALL_CLAWHUB_SKILL", slug });

    // Poll for skill list refresh and detect when the new skill appears
    const startSkillCount = availableSkills.length;
    let pollCount = 0;
    const maxPolls = 15; // 15 * 2s = 30s max wait
    const pollId = setInterval(() => {
      sendCommand({ type: "LIST_SKILLS" });
      pollCount++;
      if (pollCount >= maxPolls) {
        // Timed out — likely rate limited or install failed
        clearInterval(pollId);
        setInstalling(null);
        setInstallStatus({ message: `安装超时或被限流，请稍后重试`, success: false });
      }
    }, 2000);

    // Also watch availableSkills for changes via a separate check
    const checkInstalled = setInterval(() => {
      // If the slug now appears in availableSkills, it worked
      const currentSkills = useOfficeStore.getState().availableSkills;
      if (currentSkills.some(s => s.name === slug)) {
        clearInterval(pollId);
        clearInterval(checkInstalled);
        setInstalling(null);
        setInstallStatus({ message: `已安装 "${title}"，请在上方勾选启用`, success: true });
      }
    }, 1000);

    // Safety timeout: clean up after 35s regardless
    setTimeout(() => {
      clearInterval(pollId);
      clearInterval(checkInstalled);
      if (installing === slug) {
        setInstalling(null);
        // Check one last time
        const finalSkills = useOfficeStore.getState().availableSkills;
        if (finalSkills.some(s => s.name === slug)) {
          setInstallStatus({ message: `已安装 "${title}"，请在上方勾选启用`, success: true });
        } else {
          setInstallStatus({ message: `安装失败（可能被 API 限流），请稍后重试`, success: false });
        }
      }
    }, 35000);
  };

  const skillMeta = availableSkills; // show all available, highlight selected

  const toggleSkill = (skillName: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev);
      if (next.has(skillName)) next.delete(skillName);
      else next.add(skillName);
      return next;
    });
    setSkillsDirty(true);
  };

  const handleSaveSkills = () => {
    setSaving(true);
    const skillFiles = Array.from(selectedSkills);
    sendCommand({ type: "UPDATE_AGENT_SKILLS", agentId, skillFiles });
    if (agentDef) {
      sendCommand({ type: "SAVE_AGENT_DEF", agent: { ...agentDef, skillFiles } });
    }
    setTimeout(() => {
      setSaving(false);
      setSkillsDirty(false);
    }, 500);
  };

  const mcpEntries = Object.entries(mcpServers);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          width: "90vw", maxWidth: 560, maxHeight: "90vh",
          backgroundColor: TERM_BG,
          border: `1px solid ${TERM_GREEN}40`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px ${TERM_GREEN}15`,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: `1px solid ${TERM_BORDER}`,
          display: "flex", alignItems: "flex-start", gap: 16,
          backgroundColor: TERM_PANEL,
        }}>
          {/* Large Avatar */}
          <div style={{
            border: `2px solid ${TERM_GREEN}40`,
            padding: 4,
            backgroundColor: TERM_SURFACE,
            flexShrink: 0,
          }}>
            <SpriteAvatar palette={palette ?? 0} zoom={5} ready={assetsReady} />
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 22, fontWeight: 700, color: TERM_TEXT_BRIGHT,
              fontFamily: "var(--font-mono)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {name}
              {isTeamLead && <Tag color={TERM_SEM_YELLOW}>LEAD</Tag>}
              {isExternal && <Tag color={TERM_SEM_BLUE}>外部</Tag>}
            </div>
            <div style={{ fontSize: 13, color: TERM_DIM, marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {role}
            </div>
            <div style={{
              display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap", alignItems: "center",
            }}>
              {backendInfo && (
                <span style={{
                  fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600,
                  color: backendInfo.color,
                  padding: "2px 8px",
                  border: `1px solid ${backendInfo.color}40`,
                  backgroundColor: `${backendInfo.color}10`,
                }}>
                  {backendInfo.name}
                </span>
              )}
              <StatusDot status={status} />
            </div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: TERM_DIM, fontSize: 22, padding: "0 4px", lineHeight: 1,
              fontWeight: 300,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TERM_TEXT; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = TERM_DIM; }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div data-scrollbar style={{
          flex: 1, overflowY: "auto", padding: "16px 24px 24px",
          display: "flex", flexDirection: "column", gap: 20,
        }}>

          {/* Personality */}
          {personality && (
            <div>
              <SectionTitle>人格特征</SectionTitle>
              <div style={{
                fontSize: 13, color: TERM_TEXT, fontFamily: "var(--font-mono)",
                lineHeight: 1.6, padding: "8px 12px",
                backgroundColor: TERM_SURFACE,
                borderLeft: `2px solid ${TERM_GREEN}40`,
              }}>
                {personality}
              </div>
            </div>
          )}

          {/* Skills — toggleable */}
          <div>
            <SectionTitle>技能文件 ({selectedSkills.size}/{availableSkills.length})</SectionTitle>
            {skillMeta.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {skillMeta.map(s => {
                  const active = selectedSkills.has(s.name);
                  return (
                    <label
                      key={s.name}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                        cursor: "pointer", fontSize: 13, fontFamily: "var(--font-mono)",
                        color: active ? TERM_GREEN : TERM_DIM,
                        backgroundColor: active ? `${TERM_GREEN}0c` : "transparent",
                        border: `1px solid ${active ? TERM_GREEN + "30" : TERM_BORDER_DIM}`,
                        transition: "all 0.15s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleSkill(s.name)}
                        style={{ accentColor: TERM_GREEN, cursor: "pointer" }}
                      />
                      <span style={{ fontSize: 14 }}>📄</span>
                      <span style={{ flex: 1, fontWeight: active ? 600 : 400 }}>{s.title}</span>
                      {s.isFolder && (
                        <span style={{ fontSize: 10, color: TERM_DIM, opacity: 0.6 }}>[dir]</span>
                      )}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: TERM_DIM, fontFamily: "var(--font-mono)", opacity: 0.6 }}>
                暂无技能文件，可在设置中创建
              </div>
            )}
            {skillsDirty && (
              <button
                onClick={handleSaveSkills}
                disabled={saving}
                style={{
                  marginTop: 8, padding: "8px 16px", width: "100%",
                  fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)",
                  cursor: saving ? "wait" : "pointer",
                  color: saving ? TERM_DIM : "#000",
                  backgroundColor: saving ? TERM_SURFACE : TERM_GREEN,
                  border: `1px solid ${TERM_GREEN}`,
                  transition: "all 0.2s",
                }}
              >
                {saving ? "保存中..." : `保存技能变更 (${selectedSkills.size} 项)`}
              </button>
            )}

            {/* ClawHub Search & Install */}
            <div ref={dropdownRef} style={{
              marginTop: 10, padding: "10px 12px",
              backgroundColor: TERM_SURFACE,
              border: `1px solid ${TERM_BORDER_DIM}`,
              position: "relative",
            }}>
              <div style={{
                fontSize: 11, color: TERM_SEM_BLUE, fontFamily: "var(--font-mono)",
                fontWeight: 700, marginBottom: 6, letterSpacing: "0.05em",
              }}>
                🔗 从 CLAWHUB 搜索安装
              </div>
              <input
                type="text"
                value={clawhubInput}
                onChange={(e) => { setClawhubInput(e.target.value); setInstallStatus(null); }}
                onFocus={() => { if (clawhubResults.length > 0 && clawhubInput.trim()) setDropdownOpen(true); }}
                placeholder="搜索 ClawHub 技能... (如: code review, testing)"
                disabled={!!installing}
                style={{
                  width: "100%", padding: "8px 10px", fontSize: 12, boxSizing: "border-box",
                  fontFamily: "var(--font-mono)",
                  backgroundColor: TERM_BG, color: TERM_TEXT,
                  border: `1px solid ${dropdownOpen ? TERM_SEM_BLUE : TERM_BORDER}`,
                  outline: "none", transition: "border-color 0.15s",
                }}
              />
              {/* Dropdown results */}
              {dropdownOpen && clawhubResults.length > 0 && (
                <div data-scrollbar style={{
                  position: "absolute", left: 12, right: 12, top: "100%",
                  maxHeight: 200, overflowY: "auto", zIndex: 400,
                  backgroundColor: TERM_BG, border: `1px solid ${TERM_SEM_BLUE}60`,
                  borderTop: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                }}>
                  {clawhubResults.map(r => {
                    const isInstalling = installing === r.slug;
                    const alreadyInstalled = availableSkills.some(s => s.name === r.slug);
                    return (
                      <div
                        key={r.slug}
                        onClick={() => {
                          if (!isInstalling && !alreadyInstalled) handleInstallSkill(r.slug, r.title);
                        }}
                        style={{
                          padding: "8px 10px", cursor: alreadyInstalled ? "default" : "pointer",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          fontSize: 13, fontFamily: "var(--font-mono)",
                          color: alreadyInstalled ? TERM_DIM : TERM_TEXT,
                          backgroundColor: "transparent",
                          borderBottom: `1px solid ${TERM_BORDER_DIM}`,
                          opacity: alreadyInstalled ? 0.5 : 1,
                          transition: "background-color 0.1s",
                        }}
                        onMouseEnter={(e) => { if (!alreadyInstalled) e.currentTarget.style.backgroundColor = TERM_SURFACE; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: alreadyInstalled ? TERM_DIM : TERM_TEXT_BRIGHT }}>
                            {r.title}
                          </div>
                          <div style={{ fontSize: 11, color: TERM_DIM, marginTop: 1 }}>{r.slug}</div>
                        </div>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 8px", whiteSpace: "nowrap",
                          color: alreadyInstalled ? TERM_SEM_GREEN : TERM_SEM_BLUE,
                          border: `1px solid ${alreadyInstalled ? TERM_SEM_GREEN + "40" : TERM_SEM_BLUE + "40"}`,
                        }}>
                          {alreadyInstalled ? "已安装" : isInstalling ? "安装中..." : "安装"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Installing progress */}
              {installing && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 12, color: TERM_SEM_BLUE, fontFamily: "var(--font-mono)", marginBottom: 4 }}>
                    正在安装 {installing}...
                  </div>
                  <div style={{ height: 3, backgroundColor: TERM_BORDER_DIM, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", backgroundColor: TERM_SEM_BLUE,
                      animation: "clawhub-progress 2s ease-in-out infinite",
                      width: "60%",
                    }} />
                    <style>{`@keyframes clawhub-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }`}</style>
                  </div>
                </div>
              )}
              {installStatus && (
                <div style={{
                  marginTop: 6, fontSize: 11, fontFamily: "var(--font-mono)",
                  color: installStatus.success ? TERM_SEM_GREEN : TERM_SEM_RED,
                }}>
                  {installStatus.success ? "✓" : "✗"} {installStatus.message}
                </div>
              )}
            </div>
          </div>

          {/* MCP Servers */}
          <div>
            <SectionTitle>MCP 服务 ({mcpEntries.length})</SectionTitle>
            {mcpEntries.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {mcpEntries.map(([name, server]) => (
                  <div
                    key={name}
                    style={{
                      padding: "8px 12px",
                      backgroundColor: TERM_SURFACE,
                      border: `1px solid ${TERM_BORDER_DIM}`,
                    }}
                  >
                    <div style={{
                      fontSize: 14, fontWeight: 700, color: TERM_SEM_BLUE,
                      fontFamily: "var(--font-mono)", marginBottom: 4,
                    }}>
                      ⚡ {name}
                    </div>
                    {server.command && (
                      <div style={{ fontSize: 11, color: TERM_DIM, fontFamily: "var(--font-mono)" }}>
                        命令: <span style={{ color: TERM_TEXT }}>{server.command} {server.args?.join(" ") ?? ""}</span>
                      </div>
                    )}
                    {server.url && (
                      <div style={{ fontSize: 11, color: TERM_DIM, fontFamily: "var(--font-mono)" }}>
                        URL: <span style={{ color: TERM_TEXT }}>{server.url}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: TERM_DIM, fontFamily: "var(--font-mono)", opacity: 0.6 }}>
                暂无 MCP 服务配置
              </div>
            )}
          </div>

          {/* Token Usage */}
          <div>
            <SectionTitle>Token 使用量</SectionTitle>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
            }}>
              {[
                { label: "输入", value: tokenUsage.inputTokens, color: TERM_SEM_BLUE },
                { label: "输出", value: tokenUsage.outputTokens, color: TERM_SEM_GREEN },
                { label: "总计", value: tokenUsage.inputTokens + tokenUsage.outputTokens, color: TERM_SEM_YELLOW },
              ].map(item => (
                <div
                  key={item.label}
                  style={{
                    padding: "10px 12px", textAlign: "center",
                    backgroundColor: TERM_SURFACE,
                    border: `1px solid ${TERM_BORDER_DIM}`,
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color: item.color, fontFamily: "var(--font-mono)" }}>
                    {formatTokens(item.value)}
                  </div>
                  <div style={{ fontSize: 11, color: TERM_DIM, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Work Directory */}
          {workDir && (
            <div>
              <SectionTitle>工作目录</SectionTitle>
              <div style={{
                fontSize: 12, color: TERM_TEXT, fontFamily: "var(--font-mono)",
                padding: "6px 10px", backgroundColor: TERM_SURFACE,
                border: `1px solid ${TERM_BORDER_DIM}`,
                wordBreak: "break-all",
              }}>
                📁 {workDir}
              </div>
            </div>
          )}

          {/* Agent ID (small footer) */}
          <div style={{
            fontSize: 10, color: `${TERM_DIM}80`, fontFamily: "var(--font-mono)",
            borderTop: `1px solid ${TERM_BORDER_DIM}`,
            paddingTop: 8,
          }}>
            ID: {agentId}
          </div>
        </div>
      </div>
    </div>
  );
}
