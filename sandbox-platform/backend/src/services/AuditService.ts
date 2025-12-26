import { query } from "../db.js";
import logger from "../logger.js";

type ResourceType = "environment" | "sandbox" | "api_key" | "user";

interface AuditEntry {
  userId: string;
  action: string;
  resourceType: ResourceType;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

class AuditService {
  async log(entry: AuditEntry): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.userId,
          entry.action,
          entry.resourceType,
          entry.resourceId,
          JSON.stringify(entry.metadata ?? {}),
          entry.ipAddress ?? null,
          entry.userAgent ?? null,
        ],
      );

      logger.debug(
        {
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
        },
        "Audit log recorded",
      );
    } catch (err) {
      // Don't fail the request if audit logging fails
      logger.error({ err, entry }, "Failed to record audit log");
    }
  }

  // Convenience methods for common actions
  async logEnvironmentCreated(
    userId: string,
    environmentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log({
      userId,
      action: "environment.created",
      resourceType: "environment",
      resourceId: environmentId,
      metadata,
    });
  }

  async logEnvironmentUpdated(
    userId: string,
    environmentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log({
      userId,
      action: "environment.updated",
      resourceType: "environment",
      resourceId: environmentId,
      metadata,
    });
  }

  async logEnvironmentDeleted(
    userId: string,
    environmentId: string,
  ): Promise<void> {
    await this.log({
      userId,
      action: "environment.deleted",
      resourceType: "environment",
      resourceId: environmentId,
    });
  }

  async logSecretSet(
    userId: string,
    environmentId: string,
    secretKey: string,
  ): Promise<void> {
    await this.log({
      userId,
      action: "secret.set",
      resourceType: "environment",
      resourceId: environmentId,
      metadata: { secretKey },
    });
  }

  async logSandboxCreated(
    userId: string,
    sandboxId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log({
      userId,
      action: "sandbox.created",
      resourceType: "sandbox",
      resourceId: sandboxId,
      metadata,
    });
  }

  async logSandboxStarted(userId: string, sandboxId: string): Promise<void> {
    await this.log({
      userId,
      action: "sandbox.started",
      resourceType: "sandbox",
      resourceId: sandboxId,
    });
  }

  async logSandboxStopped(userId: string, sandboxId: string): Promise<void> {
    await this.log({
      userId,
      action: "sandbox.stopped",
      resourceType: "sandbox",
      resourceId: sandboxId,
    });
  }

  async logSandboxRestarted(userId: string, sandboxId: string): Promise<void> {
    await this.log({
      userId,
      action: "sandbox.restarted",
      resourceType: "sandbox",
      resourceId: sandboxId,
    });
  }

  async logSandboxDestroyed(userId: string, sandboxId: string): Promise<void> {
    await this.log({
      userId,
      action: "sandbox.destroyed",
      resourceType: "sandbox",
      resourceId: sandboxId,
    });
  }

  async logSandboxReplicated(
    userId: string,
    sandboxId: string,
    newSandboxId: string,
  ): Promise<void> {
    await this.log({
      userId,
      action: "sandbox.replicated",
      resourceType: "sandbox",
      resourceId: sandboxId,
      metadata: { newSandboxId },
    });
  }

  async logSandboxExec(
    userId: string,
    sandboxId: string,
    command: string[],
  ): Promise<void> {
    await this.log({
      userId,
      action: "sandbox.exec",
      resourceType: "sandbox",
      resourceId: sandboxId,
      metadata: { command: command.join(" ") },
    });
  }

  async logApiKeyCreated(
    userId: string,
    apiKeyId: string,
    keyPrefix: string,
  ): Promise<void> {
    await this.log({
      userId,
      action: "api_key.created",
      resourceType: "api_key",
      resourceId: apiKeyId,
      metadata: { keyPrefix },
    });
  }

  async logApiKeyRevoked(userId: string, apiKeyId: string): Promise<void> {
    await this.log({
      userId,
      action: "api_key.revoked",
      resourceType: "api_key",
      resourceId: apiKeyId,
    });
  }

  async logUserCreated(userId: string, email: string): Promise<void> {
    await this.log({
      userId,
      action: "user.created",
      resourceType: "user",
      resourceId: userId,
      metadata: { email },
    });
  }

  async logUserLogin(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      userId,
      action: "user.login",
      resourceType: "user",
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }
}

export const auditService = new AuditService();
export default auditService;
