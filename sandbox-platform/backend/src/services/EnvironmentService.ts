import { query, queryOne, transaction } from '../db.js';
import logger from '../logger.js';
import { secretsService } from './SecretsService.js';
import type { Environment, EnvironmentVersion, PortMapping, EnvironmentResponse } from '../types.js';

interface DbEnvironment {
  id: string;
  user_id: string;
  name: string;
  current_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DbEnvironmentVersion {
  id: string;
  environment_id: string;
  version: number;
  image: string | null;
  dockerfile: string | null;
  build_files: Record<string, string>;
  cpu: number;
  memory: number;
  ports: PortMapping[];
  env: Record<string, string>;
  secrets: Record<string, string>;
  mounts: Record<string, string>;
  created_at: Date;
}

const MAX_ENVIRONMENTS_PER_USER = 5;

class EnvironmentService {
  // Create a new environment
  async createEnvironment(
    userId: string,
    data: {
      name: string;
      image?: string;
      dockerfile?: string;
      buildFiles?: Record<string, string>;
      cpu?: number;
      memory?: number;
      ports?: PortMapping[];
      env?: Record<string, string>;
      mounts?: Record<string, string>;
    }
  ): Promise<{ environment: Environment; version: EnvironmentVersion }> {
    // Validate: either image or dockerfile must be provided
    if (!data.image && !data.dockerfile) {
      throw new Error('Either image or dockerfile must be provided');
    }

    // Check quota
    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM environments WHERE user_id = $1',
      [userId]
    );
    const count = parseInt(countResult?.count ?? '0', 10);

    if (count >= MAX_ENVIRONMENTS_PER_USER) {
      throw new QuotaExceededError(`Maximum ${MAX_ENVIRONMENTS_PER_USER} environments allowed per user`);
    }

    return transaction(async (client) => {
      // Create environment
      const envResult = await client.query<DbEnvironment>(
        `INSERT INTO environments (user_id, name)
         VALUES ($1, $2)
         RETURNING id, user_id, name, current_version_id, created_at, updated_at`,
        [userId, data.name]
      );

      const envRow = envResult.rows[0];
      if (!envRow) {
        throw new Error('Failed to create environment');
      }

      // Create initial version
      const versionResult = await client.query<DbEnvironmentVersion>(
        `INSERT INTO environment_versions (environment_id, version, image, dockerfile, build_files, cpu, memory, ports, env, secrets, mounts)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, environment_id, version, image, dockerfile, build_files, cpu, memory, ports, env, secrets, mounts, created_at`,
        [
          envRow.id,
          data.image || null,
          data.dockerfile || null,
          JSON.stringify(data.buildFiles ?? {}),
          data.cpu ?? 2,
          data.memory ?? 512,
          JSON.stringify(data.ports ?? []),
          JSON.stringify(data.env ?? {}),
          JSON.stringify({}), // No secrets initially
          JSON.stringify(data.mounts ?? {}),
        ]
      );

      const versionRow = versionResult.rows[0];
      if (!versionRow) {
        throw new Error('Failed to create environment version');
      }

      // Update current version
      await client.query('UPDATE environments SET current_version_id = $1 WHERE id = $2', [
        versionRow.id,
        envRow.id,
      ]);

      logger.info({ userId, environmentId: envRow.id, version: 1, hasDockerfile: !!data.dockerfile }, 'Environment created');

      return {
        environment: this.mapEnvironment({ ...envRow, current_version_id: versionRow.id }),
        version: this.mapVersion(versionRow),
      };
    });
  }

  // Get environment by ID (scoped to user)
  async getEnvironment(userId: string, environmentId: string): Promise<EnvironmentResponse | null> {
    const envRow = await queryOne<DbEnvironment>(
      'SELECT id, user_id, name, current_version_id, created_at, updated_at FROM environments WHERE id = $1 AND user_id = $2',
      [environmentId, userId]
    );

    if (!envRow) {
      return null;
    }

    let version: EnvironmentVersion | undefined;
    if (envRow.current_version_id) {
      const versionRow = await queryOne<DbEnvironmentVersion>(
        `SELECT id, environment_id, version, image, dockerfile, build_files, cpu, memory, ports, env, secrets, mounts, created_at
         FROM environment_versions WHERE id = $1`,
        [envRow.current_version_id]
      );
      if (versionRow) {
        version = this.mapVersion(versionRow);
      }
    }

    return this.toResponse(this.mapEnvironment(envRow), version);
  }

  // List environments for user
  async listEnvironments(userId: string): Promise<EnvironmentResponse[]> {
    const envRows = await query<DbEnvironment>(
      `SELECT id, user_id, name, current_version_id, created_at, updated_at
       FROM environments
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const results: EnvironmentResponse[] = [];

    for (const envRow of envRows) {
      let version: EnvironmentVersion | undefined;
      if (envRow.current_version_id) {
        const versionRow = await queryOne<DbEnvironmentVersion>(
          `SELECT id, environment_id, version, image, dockerfile, build_files, cpu, memory, ports, env, secrets, mounts, created_at
           FROM environment_versions WHERE id = $1`,
          [envRow.current_version_id]
        );
        if (versionRow) {
          version = this.mapVersion(versionRow);
        }
      }
      results.push(this.toResponse(this.mapEnvironment(envRow), version));
    }

    return results;
  }

  // Update environment (creates new version)
  async updateEnvironment(
    userId: string,
    environmentId: string,
    data: {
      image?: string;
      cpu?: number;
      memory?: number;
      ports?: PortMapping[];
      env?: Record<string, string>;
      mounts?: Record<string, string>;
    }
  ): Promise<{ environment: Environment; version: EnvironmentVersion }> {
    return transaction(async (client) => {
      // Get current environment and version
      const envResult = await client.query<DbEnvironment>(
        'SELECT id, user_id, name, current_version_id, created_at, updated_at FROM environments WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [environmentId, userId]
      );

      const envRow = envResult.rows[0];
      if (!envRow) {
        throw new NotFoundError('Environment not found');
      }

      // Get current version
      const currentVersionResult = await client.query<DbEnvironmentVersion>(
        `SELECT id, environment_id, version, image, cpu, memory, ports, env, secrets, mounts, created_at
         FROM environment_versions WHERE id = $1`,
        [envRow.current_version_id]
      );

      const currentVersion = currentVersionResult.rows[0];
      if (!currentVersion) {
        throw new Error('Environment version not found');
      }

      // Create new version
      const newVersion = currentVersion.version + 1;
      const versionResult = await client.query<DbEnvironmentVersion>(
        `INSERT INTO environment_versions (environment_id, version, image, cpu, memory, ports, env, secrets, mounts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, environment_id, version, image, cpu, memory, ports, env, secrets, mounts, created_at`,
        [
          environmentId,
          newVersion,
          data.image ?? currentVersion.image,
          data.cpu ?? currentVersion.cpu,
          data.memory ?? currentVersion.memory,
          JSON.stringify(data.ports ?? currentVersion.ports),
          JSON.stringify(data.env ?? currentVersion.env),
          JSON.stringify(currentVersion.secrets), // Keep existing secrets
          JSON.stringify(data.mounts ?? currentVersion.mounts),
        ]
      );

      const versionRow = versionResult.rows[0];
      if (!versionRow) {
        throw new Error('Failed to create environment version');
      }

      // Update current version
      await client.query('UPDATE environments SET current_version_id = $1, updated_at = NOW() WHERE id = $2', [
        versionRow.id,
        environmentId,
      ]);

      logger.info({ userId, environmentId, version: newVersion }, 'Environment updated');

      return {
        environment: this.mapEnvironment({ ...envRow, current_version_id: versionRow.id }),
        version: this.mapVersion(versionRow),
      };
    });
  }

  // Add or update a secret
  async setSecret(
    userId: string,
    environmentId: string,
    key: string,
    value: string
  ): Promise<{ key: string; redacted: true }> {
    return transaction(async (client) => {
      // Get current environment
      const envResult = await client.query<DbEnvironment>(
        'SELECT id, current_version_id FROM environments WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [environmentId, userId]
      );

      const envRow = envResult.rows[0];
      if (!envRow || !envRow.current_version_id) {
        throw new NotFoundError('Environment not found');
      }

      // Get current version
      const versionResult = await client.query<DbEnvironmentVersion>(
        'SELECT id, secrets FROM environment_versions WHERE id = $1',
        [envRow.current_version_id]
      );

      const versionRow = versionResult.rows[0];
      if (!versionRow) {
        throw new Error('Environment version not found');
      }

      // Encrypt the secret
      const encryptedValue = secretsService.encrypt(value);

      // Update secrets
      const secrets = versionRow.secrets ?? {};
      secrets[key] = encryptedValue;

      await client.query('UPDATE environment_versions SET secrets = $1 WHERE id = $2', [
        JSON.stringify(secrets),
        versionRow.id,
      ]);

      logger.info({ userId, environmentId, secretKey: key }, 'Secret set');

      return { key, redacted: true as const };
    });
  }

  // Delete a secret
  async deleteSecret(userId: string, environmentId: string, key: string): Promise<boolean> {
    return transaction(async (client) => {
      const envResult = await client.query<DbEnvironment>(
        'SELECT id, current_version_id FROM environments WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [environmentId, userId]
      );

      const envRow = envResult.rows[0];
      if (!envRow || !envRow.current_version_id) {
        throw new NotFoundError('Environment not found');
      }

      const versionResult = await client.query<DbEnvironmentVersion>(
        'SELECT id, secrets FROM environment_versions WHERE id = $1',
        [envRow.current_version_id]
      );

      const versionRow = versionResult.rows[0];
      if (!versionRow) {
        return false;
      }

      const secrets = versionRow.secrets ?? {};
      if (!(key in secrets)) {
        return false;
      }

      delete secrets[key];

      await client.query('UPDATE environment_versions SET secrets = $1 WHERE id = $2', [
        JSON.stringify(secrets),
        versionRow.id,
      ]);

      logger.info({ userId, environmentId, secretKey: key }, 'Secret deleted');
      return true;
    });
  }

  // Get decrypted secrets for a version (internal use only)
  async getDecryptedSecrets(versionId: string): Promise<Record<string, string>> {
    const versionRow = await queryOne<DbEnvironmentVersion>(
      'SELECT secrets FROM environment_versions WHERE id = $1',
      [versionId]
    );

    if (!versionRow || !versionRow.secrets) {
      return {};
    }

    return secretsService.decryptSecrets(versionRow.secrets);
  }

  // Get environment version
  async getVersion(versionId: string): Promise<EnvironmentVersion | null> {
    const row = await queryOne<DbEnvironmentVersion>(
      `SELECT id, environment_id, version, image, cpu, memory, ports, env, secrets, mounts, created_at
       FROM environment_versions WHERE id = $1`,
      [versionId]
    );

    return row ? this.mapVersion(row) : null;
  }

  // Delete environment
  async deleteEnvironment(userId: string, environmentId: string): Promise<boolean> {
    const result = await query('DELETE FROM environments WHERE id = $1 AND user_id = $2 RETURNING id', [
      environmentId,
      userId,
    ]);

    if (result.length > 0) {
      logger.info({ userId, environmentId }, 'Environment deleted');
      return true;
    }

    return false;
  }

  private mapEnvironment(row: DbEnvironment): Environment {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      currentVersionId: row.current_version_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapVersion(row: DbEnvironmentVersion): EnvironmentVersion {
    return {
      id: row.id,
      environmentId: row.environment_id,
      version: row.version,
      image: row.image || '',
      dockerfile: row.dockerfile || undefined,
      buildFiles: row.build_files ?? {},
      cpu: Number(row.cpu),
      memory: row.memory,
      ports: row.ports ?? [],
      env: row.env ?? {},
      secrets: row.secrets ?? {},
      mounts: row.mounts ?? {},
      createdAt: row.created_at,
    };
  }

  private toResponse(env: Environment, version?: EnvironmentVersion): EnvironmentResponse {
    return {
      id: env.id,
      name: env.name,
      currentVersionId: env.currentVersionId,
      version: version
        ? {
            id: version.id,
            version: version.version,
            image: version.image,
            cpu: version.cpu,
            memory: version.memory,
            ports: version.ports,
            env: version.env,
            secrets: Object.keys(version.secrets).map((key) => ({ key, redacted: true as const })),
            mounts: version.mounts,
            createdAt: version.createdAt.toISOString(),
          }
        : undefined,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
    };
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export const environmentService = new EnvironmentService();
export default environmentService;
