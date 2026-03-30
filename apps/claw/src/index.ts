#!/usr/bin/env node
/**
 * OpenClaw CLI — 独立的 AI Agent 实例
 *
 * 用法:
 *   openclaw setup                        首次设置身份
 *   openclaw identity                     查看/修改身份
 *   openclaw discover                     发现局域网 Room Server
 *   openclaw join <server-url>            加入房间（自动使用保存的身份）
 *   openclaw join ws://host:port --name "Rex" --backend claude
 */
import { nanoid } from "nanoid";
import { ClawClient } from "./claw-client.js";
import { TaskRunner } from "./task-runner.js";
import { loadIdentity, saveIdentity, mergeIdentity, printIdentity, createDefaultIdentity } from "./identity.js";
import type { ClawIdentity, ClawCapability, ClawEvent } from "./types.js";

// ── CLI argument parsing (minimal, no deps) ───────────────────

function parseArgs(args: string[]): { command: string; flags: Record<string, string> } {
  const command = args[0] ?? "help";
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (!flags._positional) {
      flags._positional = arg;
    }
  }
  return { command, flags };
}

// ── Commands ──────────────────────────────────────────────────

async function cmdJoin(flags: Record<string, string>) {
  // 合并 CLI 参数 + 保存的身份（CLI 优先）
  const saved = loadIdentity();
  const merged = mergeIdentity(saved, flags);

  const serverUrl = flags._positional ?? merged.lastServer;
  if (!serverUrl) {
    console.error("Usage: openclaw join <server-url> [--name NAME] [--backend BACKEND]");
    console.error("  Or run 'openclaw setup' first, then 'openclaw join <url>'");
    process.exit(1);
  }

  const roomId = flags.room ?? merged.lastRoom;
  const authToken = flags.token ?? "dev-token";
  const cwd = flags.cwd ?? process.cwd();

  const identity: ClawIdentity = {
    clawId: merged.clawId,
    name: merged.name,
    owner: merged.owner,
    backend: merged.backend,
    capabilities: merged.capabilities as ClawCapability[],
    personality: merged.personality,
    palette: merged.palette,
    model: merged.model,
  };

  // 保存连接信息供下次复用
  saveIdentity({ ...merged, lastServer: serverUrl, lastRoom: roomId });

  console.log(`\n🦞 OpenClaw starting...`);
  console.log(`   Name:     ${merged.name}`);
  console.log(`   Backend:  ${merged.backend}`);
  console.log(`   Owner:    ${merged.owner}`);
  console.log(`   Server:   ${serverUrl}`);
  console.log(`   Room:     ${roomId ?? "(default)"}`);
  console.log(`   CWD:      ${cwd}`);
  console.log();

  const client = new ClawClient({
    serverUrl,
    authToken,
    identity,
    roomId,
    autoReconnect: true,
  });

  // TaskRunner — 接收到任务后在本地执行
  const runner = new TaskRunner({
    backend: merged.backend,
    cwd,
    client,
  });

  client.on("connected", (roomState) => {
    console.log(`✅ Joined room "${roomState.roomId}" (${roomState.claws.length} claws online)`);
    console.log(`   Phase: ${roomState.specPhase ?? "none"}`);
    console.log(`\n   Waiting for tasks...\n`);
  });

  client.on("rejected", (reason) => {
    console.error(`❌ Join rejected: ${reason}`);
    process.exit(1);
  });

  client.on("disconnected", (reason) => {
    console.log(`🔌 Disconnected: ${reason}`);
  });

  client.on("event", async (event: ClawEvent) => {
    await handleEvent(event, client, runner);
  });

  client.on("error", (err) => {
    console.error(`⚠️  Error: ${err.message}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n🦞 OpenClaw shutting down...");
    runner.cancel();
    client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  client.connect();
}

async function handleEvent(event: ClawEvent, client: ClawClient, runner: TaskRunner) {
  switch (event.type) {
    case "CLAW_JOINED":
      console.log(`👋 ${event.name} (${event.backend}) joined the room`);
      break;
    case "CLAW_LEFT":
      console.log(`👋 Claw ${event.clawId} left: ${event.reason ?? "unknown"}`);
      break;
    case "SPEC_PHASE_CHANGED":
      console.log(`📋 Spec phase → ${event.phase}`);
      break;
    case "SPEC_TASK_ASSIGNED": {
      const taskId = event.taskId as string;
      const description = event.description as string;
      console.log(`\n📌 Task assigned: [${taskId}] ${description}`);
      // 自动执行分配给自己的任务
      const result = await runner.runTask(taskId, description);
      console.log(`${result.success ? "✅" : "❌"} Task ${taskId} ${result.success ? "done" : "failed"}`);
      if (result.output) {
        console.log(`   ${result.output.slice(0, 200)}`);
      }
      break;
    }
    case "SPEC_FILE_UPDATED":
      console.log(`📝 Spec file updated: ${event.file}`);
      break;
    case "ROOM_CHAT":
      console.log(`💬 ${event.fromClawId}: ${event.message}`);
      break;
    default:
      break;
  }
}

async function cmdDiscover(flags: Record<string, string>) {
  const timeout = parseInt(flags.timeout ?? "5") * 1000;

  console.log(`\n🔍 Scanning for Room Servers on local network (${timeout / 1000}s)...\n`);

  // Dynamic import to avoid loading dgram at module level (browser compat)
  const { DiscoveryListener } = await import("./discovery.js");

  const listener = new DiscoveryListener();
  const found = new Set<string>();

  listener.onServerDiscovered((server) => {
    if (found.has(server.gatewayId)) return;
    found.add(server.gatewayId);
    console.log(`  🏠 ${server.roomName} — ${server.url}`);
    console.log(`     Owner: ${server.owner} · Claws: ${server.clawCount} · Phase: ${server.specPhase ?? "none"}`);
    console.log(`     → openclaw join ${server.url}\n`);
  });

  listener.start();

  await new Promise(resolve => setTimeout(resolve, timeout));

  listener.stop();

  if (found.size === 0) {
    console.log("  No Room Servers found on local network.");
    console.log("  Try: openclaw join ws://<ip>:<port> --name 'My Agent'\n");
  } else {
    console.log(`  Found ${found.size} Room Server(s).\n`);
  }
}

function cmdHelp() {
  console.log(`
🦞 OpenClaw CLI — Independent AI Agent Instance

Commands:
  setup                Set up your OpenClaw identity (first time)
  identity             Show current identity
  join <server-url>    Connect to a Room Server
  discover             Find Room Servers on local network
  help                 Show this help

Join options:
    --name NAME        Display name
    --backend BACKEND  AI CLI type (claude/codex/gemini, default: claude)
    --room ROOM_ID     Room to join (default: default)
    --cwd DIR          Working directory (default: current)
    --capabilities CAP Comma-separated (code,review,design,plan,test)
    --model MODEL      AI model (opus/sonnet)
    --token TOKEN      Auth token

Discover options:
    --timeout SECS     Scan duration (default: 5)

Setup options:
    --name NAME        Set display name
    --backend BACKEND  Set default AI backend
    --capabilities CAP Set capabilities

Examples:
  openclaw setup --name "Rex" --backend claude --capabilities code,review
  openclaw join ws://localhost:9876
  openclaw discover
  openclaw identity
`);
}

function cmdSetup(flags: Record<string, string>) {
  const saved = loadIdentity();
  const merged = mergeIdentity(saved, flags);
  saveIdentity(merged);
  printIdentity(merged);
  console.log("  ✅ Identity saved! Use 'openclaw join <url>' to connect.\n");
}

function cmdIdentity() {
  const saved = loadIdentity();
  if (!saved) {
    console.log("\n  No identity configured. Run 'openclaw setup' first.\n");
    return;
  }
  printIdentity(saved);
}

// ── Main ──────────────────────────────────────────────────────

const { command, flags } = parseArgs(process.argv.slice(2));

switch (command) {
  case "join":
    cmdJoin(flags);
    break;
  case "discover":
    cmdDiscover(flags);
    break;
  case "setup":
    cmdSetup(flags);
    break;
  case "identity":
  case "id":
    cmdIdentity();
    break;
  case "help":
  case "--help":
  case "-h":
  default:
    cmdHelp();
    break;
}
