import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

import logger from "./logger.js";
import { migrate, close as closeDb } from "./db.js";
import { setupWebSocket } from "./websocket.js";
import { sandboxService } from "./services/SandboxService.js";
import {
  listSandboxContainers,
  stopContainer,
  removeContainer,
} from "./docker.js";

// Middleware
import { requestLogger } from "./middleware/logging.js";
import { standardLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { metricsMiddleware } from "./routes/metrics.js";

// Routes
import authRoutes from "./routes/auth.js";
import apiKeyRoutes from "./routes/apiKeys.js";
import environmentRoutes from "./routes/environments.js";
import sandboxRoutes from "./routes/sandboxes.js";
import healthRoutes from "./routes/health.js";
import metricsRoutes from "./routes/metrics.js";

const app = express();
const server = createServer(app);
const PORT = parseInt(process.env.PORT || "3001", 10);

// Global middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(metricsMiddleware);
app.use(requestLogger);

// Health and metrics (no auth, no rate limit)
app.use("/health", healthRoutes);
app.use("/metrics", metricsRoutes);

// Auth routes (separate rate limits)
app.use("/auth", authRoutes);

// Protected routes
app.use("/api-keys", standardLimiter, apiKeyRoutes);
app.use("/environments", standardLimiter, environmentRoutes);
app.use("/sandboxes", standardLimiter, sandboxRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Setup WebSocket for log streaming
setupWebSocket(server);

// Background job: TTL enforcement
const ttlCheckInterval = setInterval(async () => {
  try {
    const expired = await sandboxService.expireSandboxes();
    if (expired > 0) {
      logger.info({ expired }, "Expired sandboxes cleaned up");
    }
  } catch (err) {
    logger.error({ err }, "Failed to run TTL check");
  }
}, 60000); // Check every minute

// Background job: Log cleanup (runs daily)
const logCleanupInterval = setInterval(
  async () => {
    try {
      const { query } = await import("./db.js");
      await query("SELECT cleanup_old_logs()");
      logger.info("Old logs cleaned up");
    } catch (err) {
      logger.error({ err }, "Failed to cleanup old logs");
    }
  },
  24 * 60 * 60 * 1000,
); // Run daily

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received");

  clearInterval(ttlCheckInterval);
  clearInterval(logCleanupInterval);

  // Stop all sandbox containers
  try {
    const containers = await listSandboxContainers();
    logger.info({ count: containers.length }, "Stopping sandbox containers...");

    for (const container of containers) {
      try {
        await stopContainer(container.Id, 5);
        await removeContainer(container.Id);
        logger.info(
          { containerId: container.Id },
          "Container stopped and removed",
        );
      } catch (err) {
        logger.error(
          { err, containerId: container.Id },
          "Failed to stop container",
        );
      }
    }

    logger.info("All sandbox containers cleaned up");
  } catch (err) {
    logger.error({ err }, "Failed to cleanup containers");
  }

  server.close(async () => {
    logger.info("HTTP server closed");
    await closeDb();
    logger.info("Database connection closed");
    process.exit(0);
  });

  // Force exit after 30s
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start server
async function start(): Promise<void> {
  try {
    // Run migrations
    await migrate();

    server.listen(PORT, () => {
      logger.info({ port: PORT }, "Sandbox Platform API started");
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`Metrics: http://localhost:${PORT}/metrics`);
      logger.info(`WebSocket: ws://localhost:${PORT}/ws/sandboxes/:id/logs`);
    });
  } catch (err) {
    logger.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
}

start();
