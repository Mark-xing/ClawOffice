/**
 * spec-api.ts — Spec 文件 HTTP REST API
 *
 * 供远程 OpenClaw 通过 HTTP 拉取和推送 spec 文件。
 * 挂载在现有 HTTP server 上:
 *   GET  /api/spec/:roomId/files          → 获取所有文件列表
 *   GET  /api/spec/:roomId/file?path=...  → 获取单个文件内容
 *   POST /api/spec/:roomId/file           → 更新文件内容
 *   GET  /api/spec/:roomId/tasks          → 获取任务列表
 *   GET  /api/spec/:roomId/snapshot       → 获取完整快照
 */
import type { IncomingMessage, ServerResponse } from "http";
import { getSpecEngine } from "./spec-handler.js";

/**
 * 处理 /api/spec/* 请求
 * @returns true 如果请求被处理，false 如果不匹配
 */
export function handleSpecApi(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/api/spec/")) return false;

  // 设置 CORS 和 JSON
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  // 解析: /api/spec/:roomId/:action
  const parts = url.replace("/api/spec/", "").split("?")[0].split("/");
  const roomId = parts[0];
  const action = parts[1];

  if (!roomId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing roomId" }));
    return true;
  }

  const engine = getSpecEngine(roomId);
  if (!engine) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "No active spec for this room" }));
    return true;
  }

  switch (action) {
    case "files": {
      // GET /api/spec/:roomId/files → 文件列表
      if (req.method !== "GET") { res.writeHead(405); res.end(); return true; }
      const files = [
        "proposal.md",
        "design.md",
        "tasks.md",
        ...engine.listSpecFiles(),
      ].filter(f => engine.readFile(f) !== null);
      res.writeHead(200);
      res.end(JSON.stringify({ files, phase: engine.phase }));
      return true;
    }

    case "file": {
      if (req.method === "GET") {
        // GET /api/spec/:roomId/file?path=proposal.md
        const urlObj = new URL(url, "http://localhost");
        const filePath = urlObj.searchParams.get("path");
        if (!filePath) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Missing path parameter" }));
          return true;
        }
        const content = engine.readFile(filePath);
        if (content === null) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "File not found" }));
          return true;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ path: filePath, content }));
        return true;
      }

      if (req.method === "POST") {
        // POST /api/spec/:roomId/file — body: { path, content }
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          try {
            const { path: filePath, content } = JSON.parse(body);
            if (!filePath || typeof content !== "string") {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "Missing path or content" }));
              return;
            }
            engine.updateFile(filePath, content);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
          }
        });
        return true;
      }

      res.writeHead(405);
      res.end();
      return true;
    }

    case "tasks": {
      // GET /api/spec/:roomId/tasks → 任务列表
      if (req.method !== "GET") { res.writeHead(405); res.end(); return true; }
      res.writeHead(200);
      res.end(JSON.stringify({ tasks: engine.tasks, phase: engine.phase }));
      return true;
    }

    case "snapshot": {
      // GET /api/spec/:roomId/snapshot → 完整快照
      if (req.method !== "GET") { res.writeHead(405); res.end(); return true; }
      res.writeHead(200);
      res.end(JSON.stringify({
        phase: engine.phase,
        files: engine.getSnapshot(),
        tasks: engine.tasks,
      }));
      return true;
    }

    default: {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Unknown action" }));
      return true;
    }
  }
}
