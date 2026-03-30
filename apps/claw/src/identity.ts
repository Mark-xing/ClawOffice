/**
 * identity.ts — OpenClaw 身份配置管理
 *
 * 持久化存储在 ~/.openclaw/identity.json
 * 保存后加入房间时自动使用，免去每次输入 --name --backend 等参数。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { homedir } from "os";
import { nanoid } from "nanoid";

const CONFIG_DIR = path.join(homedir(), ".openclaw");
const IDENTITY_FILE = path.join(CONFIG_DIR, "identity.json");

export interface PersistedIdentity {
  clawId: string;
  name: string;
  owner: string;
  backend: string;
  capabilities: string[];
  personality?: string;
  palette?: number;
  model?: string;
  /** 上次连接的服务器 */
  lastServer?: string;
  /** 上次加入的房间 */
  lastRoom?: string;
}

/** 加载已保存的身份，不存在则返回 null */
export function loadIdentity(): PersistedIdentity | null {
  try {
    if (existsSync(IDENTITY_FILE)) {
      return JSON.parse(readFileSync(IDENTITY_FILE, "utf-8"));
    }
  } catch { /* corrupt file */ }
  return null;
}

/** 保存身份配置 */
export function saveIdentity(identity: PersistedIdentity): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), "utf-8");
  console.log(`[Identity] Saved to ${IDENTITY_FILE}`);
}

/** 创建默认身份 */
export function createDefaultIdentity(): PersistedIdentity {
  return {
    clawId: `claw-${nanoid(8)}`,
    name: `OpenClaw-${nanoid(4)}`,
    owner: process.env.USER ?? "anonymous",
    backend: "claude",
    capabilities: ["code"],
  };
}

/** 合并 CLI 参数和已保存的身份（CLI 参数优先） */
export function mergeIdentity(
  saved: PersistedIdentity | null,
  flags: Record<string, string>,
): PersistedIdentity {
  const base = saved ?? createDefaultIdentity();

  return {
    clawId: base.clawId,
    name: flags.name ?? base.name,
    owner: flags.owner ?? base.owner,
    backend: flags.backend ?? base.backend,
    capabilities: flags.capabilities
      ? flags.capabilities.split(",").map(s => s.trim())
      : base.capabilities,
    personality: flags.personality ?? base.personality,
    palette: flags.palette ? parseInt(flags.palette) : base.palette,
    model: flags.model ?? base.model,
    lastServer: flags._positional ?? base.lastServer,
    lastRoom: flags.room ?? base.lastRoom,
  };
}

/** 显示当前身份 */
export function printIdentity(identity: PersistedIdentity): void {
  console.log(`\n🦞 OpenClaw Identity`);
  console.log(`   ID:           ${identity.clawId}`);
  console.log(`   Name:         ${identity.name}`);
  console.log(`   Owner:        ${identity.owner}`);
  console.log(`   Backend:      ${identity.backend}`);
  console.log(`   Capabilities: ${identity.capabilities.join(", ")}`);
  if (identity.model) console.log(`   Model:        ${identity.model}`);
  if (identity.personality) console.log(`   Personality:  ${identity.personality.slice(0, 60)}`);
  if (identity.lastServer) console.log(`   Last Server:  ${identity.lastServer}`);
  if (identity.lastRoom) console.log(`   Last Room:    ${identity.lastRoom}`);
  console.log(`   Config:       ${IDENTITY_FILE}`);
  console.log();
}
