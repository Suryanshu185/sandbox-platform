import { v4 as uuidv4 } from "uuid";
import { createServer } from "net";
import { query, queryOne, transaction } from "../db.js";
import logger, { redactSecrets } from "../logger.js";
import {
  environmentService,
  NotFoundError,
  QuotaExceededError,
} from "./EnvironmentService.js";
import * as docker from "../docker.js";
import type {
  Sandbox,
  SandboxStatus,
  SandboxPhase,
  PortMapping,
  SandboxResponse,
  SandboxLog,
} from "../types.js";

// Check if a port is available
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "0.0.0.0");
  });
}

// Find an available port starting from a base port
async function findAvailablePort(
  basePort: number,
  maxAttempts = 100,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    if (port > 65535) break;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Could not find available port starting from ${basePort}`);
}

interface DbSandbox {
  id: string;
  user_id: string;
  environment_id: string;
  environment_version_id: string;
  name: string;
  container_id: string | null;
  status: SandboxStatus;
  phase: SandboxPhase;
  ports: PortMapping[];
  created_at: Date;
  started_at: Date | null;
  stopped_at: Date | null;
  expires_at: Date | null;
  provision_progress: number;
  provision_status: string;
}

interface DbSandboxLog {
  id: string;
  sandbox_id: string;
  type: "stdout" | "stderr";
  text: string;
  timestamp: Date;
}

const MAX_SANDBOXES_PER_USER = 10;
const CONTAINER_NAME_PREFIX = "sandbox-";

class SandboxService {
  // Create a new sandbox
  async createSandbox(
    userId: string,
    data: {
      environmentId: string;
      environmentVersionId?: string;
      name?: string;
      ttlSeconds?: number;
      overrides?: {
        env?: Record<string, string>;
        ports?: PortMapping[];
      };
    },
  ): Promise<SandboxResponse> {
    // Check quota
    const countResult = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM sandboxes WHERE user_id = $1 AND status NOT IN ('stopped', 'expired', 'error')",
      [userId],
    );
    const count = parseInt(countResult?.count ?? "0", 10);

    if (count >= MAX_SANDBOXES_PER_USER) {
      throw new QuotaExceededError(
        `Maximum ${MAX_SANDBOXES_PER_USER} concurrent sandboxes allowed per user`,
      );
    }

    // Get environment and version
    const env = await environmentService.getEnvironment(
      userId,
      data.environmentId,
    );
    if (!env) {
      throw new NotFoundError("Environment not found");
    }

    const versionId = data.environmentVersionId ?? env.currentVersionId;
    if (!versionId) {
      throw new Error("Environment has no version");
    }

    const version = await environmentService.getVersion(versionId);
    if (!version) {
      throw new NotFoundError("Environment version not found");
    }

    // Generate sandbox name
    const sandboxName = data.name ?? `${env.name}-${uuidv4().slice(0, 8)}`;

    // Check for idempotency (same user, environment, name)
    const existing = await queryOne<DbSandbox>(
      "SELECT id FROM sandboxes WHERE user_id = $1 AND environment_id = $2 AND name = $3",
      [userId, data.environmentId, sandboxName],
    );

    if (existing) {
      return this.getSandbox(userId, existing.id) as Promise<SandboxResponse>;
    }

    // Calculate expiry
    const expiresAt = data.ttlSeconds
      ? new Date(Date.now() + data.ttlSeconds * 1000)
      : null;

    // Merge ports (overrides take precedence)
    const ports = data.overrides?.ports ?? version.ports;

    // Create sandbox record
    const sandboxId = uuidv4();
    await query<DbSandbox>(
      `INSERT INTO sandboxes (id, user_id, environment_id, environment_version_id, name, status, phase, ports, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 'creating', $6, $7)`,
      [
        sandboxId,
        userId,
        data.environmentId,
        versionId,
        sandboxName,
        JSON.stringify(ports),
        expiresAt,
      ],
    );

    // Create container in background
    this.provisionSandbox(
      sandboxId,
      userId,
      version,
      data.overrides?.env ?? {},
    ).catch((err) => {
      logger.error({ err, sandboxId }, "Failed to provision sandbox");
    });

    logger.info(
      { userId, sandboxId, environmentId: data.environmentId },
      "Sandbox creation initiated",
    );

    return this.getSandbox(userId, sandboxId) as Promise<SandboxResponse>;
  }

  // Provision sandbox (create and start container)
  private async provisionSandbox(
    sandboxId: string,
    userId: string,
    version: {
      id: string;
      image: string;
      dockerfile?: string;
      buildFiles?: Record<string, string>;
      command?: string[];
      cpu: number;
      memory: number;
      env: Record<string, string>;
    },
    envOverrides: Record<string, string>,
  ): Promise<void> {
    try {
      // Get sandbox
      const sandbox = await queryOne<DbSandbox>(
        "SELECT * FROM sandboxes WHERE id = $1",
        [sandboxId],
      );
      if (!sandbox) {
        throw new Error("Sandbox not found");
      }

      // Get decrypted secrets
      const secrets = await environmentService.getDecryptedSecrets(version.id);

      // Merge environment variables
      const containerEnv = {
        ...version.env,
        ...secrets,
        ...envOverrides,
        SANDBOX_ID: sandboxId,
      };

      // Progress callback to update database
      let lastProgress = -1;
      const updateProgress = async (progress: number, status: string) => {
        // Only update if progress changed significantly (avoid too many DB writes)
        if (
          progress !== lastProgress &&
          (progress - lastProgress >= 5 || progress === 100)
        ) {
          lastProgress = progress;
          await query(
            "UPDATE sandboxes SET provision_progress = $1, provision_status = $2 WHERE id = $3",
            [progress, status, sandboxId],
          );
        }
      };

      // Determine the image to use
      let imageName = version.image;

      // Create container with progress tracking
      const containerName = `${CONTAINER_NAME_PREFIX}${sandboxId.slice(0, 12)}`;
      const containerId = await docker.createContainer(
        {
          name: containerName,
          image: imageName,
          cpu: version.cpu,
          memory: version.memory,
          ports: sandbox.ports,
          env: containerEnv,
          command: version.command,
          labels: {
            "sandbox-id": sandboxId,
            "user-id": userId,
          },
        },
        version.dockerfile ? undefined : updateProgress, // Don't double-track progress if already building
      );

      // Update sandbox with container ID
      await query(
        "UPDATE sandboxes SET container_id = $1, phase = $2 WHERE id = $3",
        [containerId, "starting", sandboxId],
      );

      // Start container
      await docker.startContainer(containerId);
      logger.info(
        { sandboxId, containerId },
        "Container started, waiting for healthy state...",
      );

      // Small delay to let container initialize
      await new Promise((r) => setTimeout(r, 1000));

      // Wait for healthy
      const healthy = await docker.waitForHealthy(containerId, 30000);
      logger.info({ sandboxId, containerId, healthy }, "Health check result");

      if (healthy) {
        await query(
          "UPDATE sandboxes SET status = 'running', phase = 'healthy', started_at = NOW() WHERE id = $1",
          [sandboxId],
        );
        logger.info({ sandboxId, containerId }, "Sandbox started successfully");

        // Start log collection in background (don't await)
        this.collectLogs(sandboxId, containerId).catch((err) => {
          logger.error({ err, sandboxId }, "Failed to collect logs");
        });
      } else {
        // Get more info about why it failed
        const containerInfo = await docker.getContainerInfo(containerId);
        logger.error(
          { sandboxId, containerId, containerInfo },
          "Sandbox failed to become healthy",
        );
        await query(
          "UPDATE sandboxes SET status = 'error', phase = 'failed' WHERE id = $1",
          [sandboxId],
        );
      }
    } catch (err) {
      logger.error({ err, sandboxId }, "Failed to provision sandbox");
      await query(
        "UPDATE sandboxes SET status = 'error', phase = 'failed' WHERE id = $1",
        [sandboxId],
      );
    }
  }

  // Collect logs from container
  private async collectLogs(
    sandboxId: string,
    containerId: string,
  ): Promise<void> {
    try {
      for await (const log of docker.streamLogs(containerId)) {
        // Redact secrets from log text
        const redactedText = redactSecrets(log.text);

        await query(
          "INSERT INTO sandbox_logs (sandbox_id, type, text, timestamp) VALUES ($1, $2, $3, $4)",
          [sandboxId, log.type, redactedText, log.timestamp],
        );

        // Limit log entries per sandbox (keep last 10000)
        await query(
          `DELETE FROM sandbox_logs WHERE sandbox_id = $1 AND id NOT IN (
            SELECT id FROM sandbox_logs WHERE sandbox_id = $1 ORDER BY timestamp DESC LIMIT 10000
          )`,
          [sandboxId],
        );
      }
    } catch (err) {
      // Container might have stopped
      logger.debug({ err, sandboxId }, "Log collection ended");
    }
  }

  // Get sandbox by ID
  async getSandbox(
    userId: string,
    sandboxId: string,
  ): Promise<SandboxResponse | null> {
    const row = await queryOne<DbSandbox>(
      "SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );

    if (!row) {
      return null;
    }

    // Get logs preview
    const logs = await query<DbSandboxLog>(
      "SELECT type, text FROM sandbox_logs WHERE sandbox_id = $1 ORDER BY timestamp DESC LIMIT 5",
      [sandboxId],
    );

    return this.toResponse(
      this.mapSandbox(row),
      logs.reverse().map((l) => `[${l.type}] ${l.text}`),
    );
  }

  // List sandboxes for user
  async listSandboxes(
    userId: string,
    filters?: { status?: SandboxStatus; environmentId?: string },
  ): Promise<SandboxResponse[]> {
    let sql = "SELECT * FROM sandboxes WHERE user_id = $1";
    const params: unknown[] = [userId];

    if (filters?.status) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(filters.status);
    }

    if (filters?.environmentId) {
      sql += ` AND environment_id = $${params.length + 1}`;
      params.push(filters.environmentId);
    }

    sql += " ORDER BY created_at DESC";

    const rows = await query<DbSandbox>(sql, params);
    return rows.map((row) => this.toResponse(this.mapSandbox(row)));
  }

  // Start a stopped sandbox
  async startSandbox(
    userId: string,
    sandboxId: string,
  ): Promise<SandboxResponse> {
    const sandbox = await queryOne<DbSandbox>(
      "SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );

    if (!sandbox) {
      throw new NotFoundError("Sandbox not found");
    }

    if (sandbox.status === "running") {
      return this.toResponse(this.mapSandbox(sandbox));
    }

    if (!sandbox.container_id) {
      throw new Error("Sandbox has no container");
    }

    await docker.startContainer(sandbox.container_id);
    await query(
      "UPDATE sandboxes SET status = 'running', phase = 'healthy', started_at = NOW(), stopped_at = NULL WHERE id = $1",
      [sandboxId],
    );

    // Restart log collection
    this.collectLogs(sandboxId, sandbox.container_id).catch((err) => {
      logger.error({ err, sandboxId }, "Failed to collect logs");
    });

    logger.info({ userId, sandboxId }, "Sandbox started");

    return this.getSandbox(userId, sandboxId) as Promise<SandboxResponse>;
  }

  // Stop a running sandbox
  async stopSandbox(
    userId: string,
    sandboxId: string,
  ): Promise<SandboxResponse> {
    const sandbox = await queryOne<DbSandbox>(
      "SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );

    if (!sandbox) {
      throw new NotFoundError("Sandbox not found");
    }

    if (sandbox.status === "stopped") {
      return this.toResponse(this.mapSandbox(sandbox));
    }

    if (!sandbox.container_id) {
      throw new Error("Sandbox has no container");
    }

    await docker.stopContainer(sandbox.container_id);
    await query(
      "UPDATE sandboxes SET status = 'stopped', phase = 'stopped', stopped_at = NOW() WHERE id = $1",
      [sandboxId],
    );

    logger.info({ userId, sandboxId }, "Sandbox stopped");

    return this.getSandbox(userId, sandboxId) as Promise<SandboxResponse>;
  }

  // Restart a sandbox
  async restartSandbox(
    userId: string,
    sandboxId: string,
  ): Promise<SandboxResponse> {
    const sandbox = await queryOne<DbSandbox>(
      "SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );

    if (!sandbox) {
      throw new NotFoundError("Sandbox not found");
    }

    if (!sandbox.container_id) {
      throw new Error("Sandbox has no container");
    }

    await docker.restartContainer(sandbox.container_id);
    await query(
      "UPDATE sandboxes SET status = 'running', phase = 'healthy', started_at = NOW(), stopped_at = NULL WHERE id = $1",
      [sandboxId],
    );

    logger.info({ userId, sandboxId }, "Sandbox restarted");

    return this.getSandbox(userId, sandboxId) as Promise<SandboxResponse>;
  }

  // Destroy a sandbox
  async destroySandbox(userId: string, sandboxId: string): Promise<boolean> {
    const sandbox = await queryOne<DbSandbox>(
      "SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );

    if (!sandbox) {
      return false;
    }

    if (sandbox.container_id) {
      await docker.removeContainer(sandbox.container_id);
    }

    await query("DELETE FROM sandboxes WHERE id = $1", [sandboxId]);

    logger.info({ userId, sandboxId }, "Sandbox destroyed");

    return true;
  }

  // Replicate a sandbox
  async replicateSandbox(
    userId: string,
    sandboxId: string,
    data?: {
      name?: string;
      overrides?: {
        env?: Record<string, string>;
        ports?: PortMapping[];
      };
    },
  ): Promise<SandboxResponse> {
    const sandbox = await queryOne<DbSandbox>(
      "SELECT * FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );

    if (!sandbox) {
      throw new NotFoundError("Sandbox not found");
    }

    // Create new sandbox from same environment and version
    const newName =
      data?.name ?? `${sandbox.name}-replica-${uuidv4().slice(0, 4)}`;

    // Auto-assign new ports to avoid conflicts - find actually available ports
    let newPorts = data?.overrides?.ports;
    if (!newPorts && sandbox.ports.length > 0) {
      newPorts = [];
      for (const p of sandbox.ports) {
        // Start searching from original port + 1
        const availablePort = await findAvailablePort(p.host + 1);
        newPorts.push({
          container: p.container,
          host: availablePort,
        });
      }
      logger.info(
        { originalPorts: sandbox.ports, newPorts },
        "Auto-assigned available ports for replica",
      );
    }

    return this.createSandbox(userId, {
      environmentId: sandbox.environment_id,
      environmentVersionId: sandbox.environment_version_id,
      name: newName,
      overrides: {
        ...data?.overrides,
        ports: newPorts,
      },
    });
  }

  // Get sandbox logs
  async getLogs(
    userId: string,
    sandboxId: string,
    tail = 100,
  ): Promise<Array<{ type: string; text: string; timestamp: string }>> {
    // Verify ownership
    const sandbox = await queryOne<DbSandbox>(
      "SELECT id FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );

    if (!sandbox) {
      throw new NotFoundError("Sandbox not found");
    }

    const logs = await query<DbSandboxLog>(
      `SELECT type, text, timestamp FROM sandbox_logs
       WHERE sandbox_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [sandboxId, tail],
    );

    return logs.reverse().map((log) => ({
      type: log.type,
      text: log.text,
      timestamp: log.timestamp.toISOString(),
    }));
  }

  // Check and expire sandboxes (background job)
  async expireSandboxes(): Promise<number> {
    const expired = await query<DbSandbox>(
      "SELECT * FROM sandboxes WHERE expires_at < NOW() AND status NOT IN ('expired', 'stopped', 'error')",
    );

    let count = 0;
    for (const sandbox of expired) {
      try {
        if (sandbox.container_id) {
          await docker.stopContainer(sandbox.container_id);
          await docker.removeContainer(sandbox.container_id);
        }
        await query(
          "UPDATE sandboxes SET status = 'expired', phase = 'stopped', stopped_at = NOW() WHERE id = $1",
          [sandbox.id],
        );
        count++;
        logger.info({ sandboxId: sandbox.id }, "Sandbox expired");
      } catch (err) {
        logger.error(
          { err, sandboxId: sandbox.id },
          "Failed to expire sandbox",
        );
      }
    }

    return count;
  }

  // Get container ID for a sandbox (for direct Docker operations)
  async getContainerId(
    userId: string,
    sandboxId: string,
  ): Promise<string | null> {
    const sandbox = await queryOne<DbSandbox>(
      "SELECT container_id FROM sandboxes WHERE id = $1 AND user_id = $2",
      [sandboxId, userId],
    );
    return sandbox?.container_id ?? null;
  }

  // Sync sandbox status with Docker
  async syncStatus(sandboxId: string): Promise<void> {
    const sandbox = await queryOne<DbSandbox>(
      "SELECT * FROM sandboxes WHERE id = $1",
      [sandboxId],
    );
    if (!sandbox || !sandbox.container_id) {
      return;
    }

    const info = await docker.getContainerInfo(sandbox.container_id);
    if (!info) {
      // Container doesn't exist
      await query(
        "UPDATE sandboxes SET status = 'error', phase = 'failed' WHERE id = $1",
        [sandboxId],
      );
      return;
    }

    let status: SandboxStatus = sandbox.status;
    let phase: SandboxPhase = sandbox.phase;

    if (info.running) {
      status = "running";
      phase = "healthy";
    } else if (info.status === "exited") {
      status = "stopped";
      phase = "stopped";
    } else if (info.status === "dead") {
      status = "error";
      phase = "failed";
    }

    if (status !== sandbox.status || phase !== sandbox.phase) {
      await query(
        "UPDATE sandboxes SET status = $1, phase = $2 WHERE id = $3",
        [status, phase, sandboxId],
      );
    }
  }

  private mapSandbox(row: DbSandbox): Sandbox {
    return {
      id: row.id,
      userId: row.user_id,
      environmentId: row.environment_id,
      environmentVersionId: row.environment_version_id,
      name: row.name,
      containerId: row.container_id,
      status: row.status,
      phase: row.phase,
      ports: row.ports ?? [],
      createdAt: row.created_at,
      startedAt: row.started_at,
      stoppedAt: row.stopped_at,
      expiresAt: row.expires_at,
      provisionProgress: row.provision_progress ?? 0,
      provisionStatus: row.provision_status ?? "",
    };
  }

  private toResponse(
    sandbox: Sandbox,
    logsPreview?: string[],
  ): SandboxResponse {
    const endpoints = sandbox.ports.map((p) => ({
      port: p.host,
      url: `http://localhost:${p.host}`,
    }));

    return {
      id: sandbox.id,
      name: sandbox.name,
      environmentId: sandbox.environmentId,
      environmentVersionId: sandbox.environmentVersionId,
      status: sandbox.status,
      phase: sandbox.phase,
      ports: sandbox.ports,
      endpoints,
      createdAt: sandbox.createdAt.toISOString(),
      startedAt: sandbox.startedAt?.toISOString() ?? null,
      stoppedAt: sandbox.stoppedAt?.toISOString() ?? null,
      expiresAt: sandbox.expiresAt?.toISOString() ?? null,
      logsPreview,
      provisionProgress: sandbox.provisionProgress,
      provisionStatus: sandbox.provisionStatus,
    };
  }
}

export const sandboxService = new SandboxService();
export default sandboxService;
