import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "http";
import { Duplex } from "stream";
import { parse } from "url";
import { authService } from "./services/AuthService.js";
import { sandboxService } from "./services/SandboxService.js";
import * as docker from "./docker.js";
import logger, { redactSecrets } from "./logger.js";
import { query, queryOne } from "./db.js";
import type { WsMessage } from "./types.js";

interface DbSandbox {
  id: string;
  user_id: string;
  container_id: string | null;
  status: string;
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade requests manually to support paths like /ws/sandboxes/:id/logs
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = parse(req.url || "", true);
    const pathname = url.pathname || "";

    // Only handle /ws/* paths
    if (!pathname.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws: WebSocket, req) => {
    const url = parse(req.url || "", true);
    const pathname = url.pathname || "";

    // Remove /ws prefix and parse remaining path
    const remainingPath = pathname.replace(/^\/ws/, "");
    const pathParts = remainingPath.split("/").filter(Boolean);

    // Expected paths:
    // /ws/sandboxes/:id/logs -> pathParts = ['sandboxes', ':id', 'logs']
    // /ws/sandboxes/:id/terminal -> pathParts = ['sandboxes', ':id', 'terminal']
    if (pathParts.length !== 3 || pathParts[0] !== "sandboxes") {
      sendError(
        ws,
        "Invalid WebSocket path. Use: /ws/sandboxes/:id/logs or /ws/sandboxes/:id/terminal",
      );
      ws.close(4000, "Invalid path");
      return;
    }

    const sandboxId = pathParts[1]!;
    const endpoint = pathParts[2]!;

    if (endpoint !== "logs" && endpoint !== "terminal") {
      sendError(ws, "Invalid endpoint. Use: logs or terminal");
      ws.close(4000, "Invalid endpoint");
      return;
    }

    // Authenticate
    const token =
      (url.query.token as string) ||
      req.headers["authorization"]?.replace("Bearer ", "");

    if (!token) {
      sendError(
        ws,
        "Authentication required. Provide token query param or Authorization header.",
      );
      ws.close(4001, "Unauthorized");
      return;
    }

    let userId: string | undefined;

    // Try JWT first, then API key
    if (token.startsWith("sk_")) {
      const result = await authService.validateApiKey(token);
      if (result) {
        userId = result.userId;
      }
    } else {
      const payload = authService.verifyToken(token);
      if (payload) {
        userId = payload.sub;
      }
    }

    if (!userId) {
      sendError(ws, "Invalid or expired token");
      ws.close(4001, "Unauthorized");
      return;
    }

    // Verify sandbox ownership
    const sandbox = await queryOne<DbSandbox>(
      "SELECT id, user_id, container_id, status FROM sandboxes WHERE id = $1",
      [sandboxId],
    );

    if (!sandbox || sandbox.user_id !== userId) {
      sendError(ws, "Sandbox not found");
      ws.close(4004, "Not found");
      return;
    }

    // Route to appropriate handler
    if (endpoint === "logs") {
      await handleLogStream(ws, sandboxId, userId, sandbox);
    } else if (endpoint === "terminal") {
      await handleTerminal(ws, sandboxId, userId, sandbox);
    }
  });

  logger.info("WebSocket server initialized");
  return wss;
}

// Handle log streaming WebSocket
async function handleLogStream(
  ws: WebSocket,
  sandboxId: string,
  userId: string,
  sandbox: DbSandbox,
): Promise<void> {
  logger.info(
    { sandboxId, userId },
    "WebSocket connection established for log streaming",
  );

  // Send initial status
  sendMessage(ws, {
    event: "status",
    data: { status: sandbox.status as "running" },
  });

  // Send historical logs first
  const historicalLogs = await query<{
    type: string;
    text: string;
    timestamp: Date;
  }>(
    "SELECT type, text, timestamp FROM sandbox_logs WHERE sandbox_id = $1 ORDER BY timestamp DESC LIMIT 100",
    [sandboxId],
  );

  for (const log of historicalLogs.reverse()) {
    sendMessage(ws, {
      event: "log",
      data: {
        type: log.type as "stdout" | "stderr",
        text: log.text,
        timestamp: log.timestamp.toISOString(),
      },
    });
  }

  // Set up live log streaming if container is running
  let cleanup: (() => void) | undefined;

  if (sandbox.container_id && sandbox.status === "running") {
    cleanup = await streamContainerLogs(
      ws,
      sandboxId,
      String(sandbox.container_id),
    );
  }

  // Handle client disconnect
  ws.on("close", () => {
    logger.info({ sandboxId, userId }, "WebSocket connection closed");
    if (cleanup) cleanup();
  });

  ws.on("error", (err) => {
    logger.error({ err, sandboxId, userId }, "WebSocket error");
    if (cleanup) cleanup();
  });

  // Handle messages from client (e.g., ping)
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") {
        ws.send(
          JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }),
        );
      }
    } catch {
      // Ignore invalid messages
    }
  });
}

// Handle interactive terminal WebSocket
async function handleTerminal(
  ws: WebSocket,
  sandboxId: string,
  userId: string,
  sandbox: DbSandbox,
): Promise<void> {
  logger.info(
    { sandboxId, userId },
    "WebSocket connection established for terminal",
  );

  // Check if sandbox is running
  if (sandbox.status !== "running" || !sandbox.container_id) {
    sendError(ws, "Sandbox is not running");
    ws.close(4003, "Sandbox not running");
    return;
  }

  try {
    // Create interactive exec session
    const execSession = await docker.createInteractiveExec(
      sandbox.container_id,
    );

    logger.info({ sandboxId, userId }, "Interactive terminal session started");

    // Send ready message
    ws.send(JSON.stringify({ type: "ready" }));

    // Pipe container output to WebSocket
    execSession.stream.on("data", (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    execSession.stream.on("end", () => {
      logger.info({ sandboxId, userId }, "Terminal stream ended");
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Session ended");
      }
    });

    execSession.stream.on("error", (err) => {
      logger.error({ err, sandboxId, userId }, "Terminal stream error");
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, "Stream error");
      }
    });

    // Handle WebSocket messages (input from client)
    ws.on("message", async (data) => {
      try {
        // Check if it's a control message (JSON) or raw terminal input
        const message = data.toString();

        // Try to parse as JSON for control messages
        if (message.startsWith("{")) {
          try {
            const ctrl = JSON.parse(message);
            if (ctrl.type === "resize" && ctrl.cols && ctrl.rows) {
              await execSession.resize(ctrl.cols, ctrl.rows);
              return;
            }
            if (ctrl.type === "ping") {
              ws.send(
                JSON.stringify({
                  type: "pong",
                  timestamp: new Date().toISOString(),
                }),
              );
              return;
            }
          } catch {
            // Not valid JSON, treat as terminal input
          }
        }

        // Send raw input to container
        execSession.stream.write(Buffer.from(data as ArrayBuffer));
      } catch (err) {
        logger.error({ err, sandboxId }, "Error handling terminal input");
      }
    });

    // Handle WebSocket close
    ws.on("close", () => {
      logger.info({ sandboxId, userId }, "Terminal WebSocket closed");
      execSession.close();
    });

    ws.on("error", (err) => {
      logger.error({ err, sandboxId, userId }, "Terminal WebSocket error");
      execSession.close();
    });
  } catch (err) {
    logger.error(
      { err, sandboxId, userId },
      "Failed to create terminal session",
    );
    sendError(ws, "Failed to create terminal session");
    ws.close(1011, "Failed to create session");
  }
}

async function streamContainerLogs(
  ws: WebSocket,
  sandboxId: string,
  containerId: string,
): Promise<() => void> {
  let running = true;

  const streamLogs = async () => {
    try {
      const logGenerator = docker.streamLogs(
        containerId,
        Math.floor(Date.now() / 1000),
      );

      for await (const log of logGenerator) {
        if (!running || ws.readyState !== WebSocket.OPEN) {
          break;
        }

        const redactedText = redactSecrets(log.text);

        sendMessage(ws, {
          event: "log",
          data: {
            type: log.type,
            text: redactedText,
            timestamp: log.timestamp.toISOString(),
          },
        });

        // Also store in database
        await query(
          "INSERT INTO sandbox_logs (sandbox_id, type, text, timestamp) VALUES ($1, $2, $3, $4)",
          [sandboxId, log.type, redactedText, log.timestamp],
        );
      }
    } catch (err) {
      if (running) {
        logger.debug({ err, sandboxId }, "Log streaming ended");
      }
    }
  };

  // Start streaming in background
  streamLogs();

  // Return cleanup function
  return () => {
    running = false;
  };
}

function sendMessage(ws: WebSocket, message: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, message: string): void {
  sendMessage(ws, { event: "error", data: { message } });
}
