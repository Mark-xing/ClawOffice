/**
 * claw-ws.ts — 处理远程 OpenClaw 的 WebSocket 连接
 *
 * 独立于现有的 ws-server.ts（处理 Web UI 连接），避免污染现有逻辑。
 * 挂载在同一个 HTTP server 上，通过 URL path 区分：
 *   - / (default) → 现有 Web UI WebSocket
 *   - /claw       → OpenClaw 连接
 */
import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { ClawRegistry, RemoteClaw } from "./claw-registry.js";
import { RoomManager } from "./room-manager.js";
import { ClawHandshakeSchema } from "@office/shared";
import type { ClawHandshake, ClawEvent, ClawRole } from "@office/shared";

const HANDSHAKE_TIMEOUT_MS = 10000;

export interface ClawWsOptions {
  clawRegistry: ClawRegistry;
  roomManager: RoomManager;
  /** 验证 auth token — 返回 true 表示通过 */
  validateToken?: (token: string) => boolean;
  /** 远程 Claw 发来的命令处理器 */
  onClawCommand?: (clawId: string, msg: Record<string, unknown>) => void;
}

/**
 * 在现有 HTTP server 上挂载 /claw WebSocket 端点
 */
export function mountClawWs(httpServer: Server, opts: ClawWsOptions): WebSocketServer {
  const { clawRegistry, roomManager, validateToken, onClawCommand } = opts;

  const wss = new WebSocketServer({ noServer: true });

  // 拦截 upgrade 请求，只处理 /claw 路径
  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "/";
    if (url.startsWith("/claw")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
    // 其他路径由现有的 wss (ws-server.ts) 处理，不干扰
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    console.log(`[ClawWS] New connection from ${req.socket.remoteAddress}`);

    let authenticated = false;

    // 握手超时
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        console.log("[ClawWS] Handshake timeout, closing");
        ws.close(4001, "Handshake timeout");
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        // ── 握手阶段 ──
        if (!authenticated) {
          if (msg.type !== "CLAW_JOIN") {
            ws.send(JSON.stringify({ type: "JOIN_REJECT", reason: "Expected CLAW_JOIN handshake" }));
            ws.close(4002, "Bad handshake");
            return;
          }

          const parsed = ClawHandshakeSchema.safeParse(msg);
          if (!parsed.success) {
            ws.send(JSON.stringify({ type: "JOIN_REJECT", reason: `Invalid handshake: ${parsed.error.message}` }));
            ws.close(4003, "Invalid handshake");
            return;
          }

          const handshake = parsed.data;

          // Token 验证
          if (validateToken && !validateToken(handshake.authToken)) {
            ws.send(JSON.stringify({ type: "JOIN_REJECT", reason: "Invalid auth token" }));
            ws.close(4004, "Auth failed");
            return;
          }

          // 确定房间和角色
          const roomId = handshake.roomId ?? roomManager.defaultRoomId;
          let role: ClawRole = "dev";

          // 如果有邀请码，验证并获取角色
          // （邀请码可以通过 handshake.authToken 传递，或单独字段）

          // 注册到 ClawRegistry
          const claw = clawRegistry.registerRemote(ws, handshake, role);

          // 加入房间
          const joined = roomManager.joinRoom(roomId, claw, role);
          if (!joined) {
            clawRegistry.unregister(claw.clawId);
            ws.send(JSON.stringify({ type: "JOIN_REJECT", reason: "Failed to join room" }));
            ws.close(4005, "Room join failed");
            return;
          }

          // 发送确认
          const roomState = roomManager.getRoomState(roomId);
          ws.send(JSON.stringify({
            type: "JOIN_ACK",
            roomId,
            clawId: claw.clawId,
            role,
            roomState,
          }));

          authenticated = true;
          clearTimeout(authTimer);
          console.log(`[ClawWS] ${claw.name} (${claw.clawId}) authenticated and joined room ${roomId}`);

          // 设置断开处理
          ws.on("close", () => {
            console.log(`[ClawWS] ${claw.name} (${claw.clawId}) disconnected`);
            if (claw.roomId) {
              roomManager.leaveRoom(claw.roomId, claw.clawId, "disconnect");
            }
            clawRegistry.unregister(claw.clawId);
          });

          return;
        }

        // ── 认证后的消息处理 ──
        // 找到该 ws 对应的 claw
        const claw = findClawByWs(ws, clawRegistry);
        if (!claw) {
          console.warn("[ClawWS] Message from unknown claw, ignoring");
          return;
        }

        // 状态上报
        if (msg.type === "CLAW_STATUS_REPORT") {
          claw.status = msg.status;
          roomManager.broadcastToRoom(claw.roomId!, {
            type: "CLAW_STATUS",
            clawId: claw.clawId,
            status: msg.status,
          }, claw.clawId);
          return;
        }

        // 任务进度上报
        if (msg.type === "TASK_UPDATE") {
          roomManager.broadcastToRoom(claw.roomId!, {
            type: "SPEC_TASK_PROGRESS",
            roomId: claw.roomId!,
            taskId: msg.taskId,
            clawId: claw.clawId,
            status: msg.status,
            activity: msg.activity,
            output: msg.output,
          });
          return;
        }

        // 其他命令转发给上层处理
        onClawCommand?.(claw.clawId, msg);
      } catch (err) {
        console.error("[ClawWS] Message parse error:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("[ClawWS] WebSocket error:", err.message);
    });
  });

  console.log("[ClawWS] /claw WebSocket endpoint mounted");
  return wss;
}

/** 通过 WebSocket 实例反查 RemoteClaw */
function findClawByWs(ws: WebSocket, registry: ClawRegistry): RemoteClaw | undefined {
  for (const claw of registry.getRemote()) {
    // RemoteClaw 内部持有 ws 引用，但它是 private 的
    // 这里通过 send 测试来判断（简单方案，后续可优化为 Map 查找）
    // 更好的方案：在握手成功后把 clawId 存到 ws 的自定义属性上
    if ((claw as any).ws === ws) return claw;
  }
  return undefined;
}
