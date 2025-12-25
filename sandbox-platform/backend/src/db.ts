import { Pool, PoolClient } from 'pg';
import logger from './logger.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sandbox_platform',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug({ query: text, duration, rows: result.rowCount }, 'Database query executed');
  return result.rows as T[];
}

export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function migrate(): Promise<void> {
  logger.info('Running database migrations...');

  const migrations = `
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    -- API Keys table
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_prefix VARCHAR(20) NOT NULL,
      key_hash VARCHAR(255) NOT NULL,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

    -- Environments table
    CREATE TABLE IF NOT EXISTS environments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      current_version_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_environments_user_id ON environments(user_id);

    -- Environment versions table (immutable)
    CREATE TABLE IF NOT EXISTS environment_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      version INT NOT NULL,
      image VARCHAR(500), -- NULL if using dockerfile
      dockerfile TEXT, -- Dockerfile content if building
      build_files JSONB DEFAULT '{}', -- Additional build context files
      cpu DECIMAL(3,2) NOT NULL DEFAULT 2.0,
      memory INT NOT NULL DEFAULT 512,
      ports JSONB NOT NULL DEFAULT '[]',
      env JSONB NOT NULL DEFAULT '{}',
      secrets JSONB NOT NULL DEFAULT '{}',
      mounts JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(environment_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_env_versions_env_id ON environment_versions(environment_id);

    -- Add dockerfile columns if they don't exist (migration)
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'environment_versions' AND column_name = 'dockerfile'
      ) THEN
        ALTER TABLE environment_versions ADD COLUMN dockerfile TEXT;
        ALTER TABLE environment_versions ADD COLUMN build_files JSONB DEFAULT '{}';
        ALTER TABLE environment_versions ALTER COLUMN image DROP NOT NULL;
      END IF;
    END $$;

    -- Add command column if it doesn't exist (migration)
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'environment_versions' AND column_name = 'command'
      ) THEN
        ALTER TABLE environment_versions ADD COLUMN command JSONB DEFAULT NULL;
      END IF;
    END $$;

    -- Add foreign key for current_version_id after environment_versions exists
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_env_current_version'
      ) THEN
        ALTER TABLE environments
        ADD CONSTRAINT fk_env_current_version
        FOREIGN KEY (current_version_id) REFERENCES environment_versions(id);
      END IF;
    END $$;

    -- Sandboxes table
    CREATE TABLE IF NOT EXISTS sandboxes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
      environment_version_id UUID NOT NULL REFERENCES environment_versions(id),
      name VARCHAR(100) NOT NULL,
      container_id VARCHAR(64),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      phase VARCHAR(20) NOT NULL DEFAULT 'creating',
      ports JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      stopped_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      UNIQUE(user_id, environment_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_sandboxes_user_id ON sandboxes(user_id);
    CREATE INDEX IF NOT EXISTS idx_sandboxes_env_id ON sandboxes(environment_id);
    CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
    CREATE INDEX IF NOT EXISTS idx_sandboxes_expires_at ON sandboxes(expires_at) WHERE expires_at IS NOT NULL;

    -- Add provision_progress columns to sandboxes (migration)
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sandboxes' AND column_name = 'provision_progress'
      ) THEN
        ALTER TABLE sandboxes ADD COLUMN provision_progress INT DEFAULT 0;
        ALTER TABLE sandboxes ADD COLUMN provision_status VARCHAR(100) DEFAULT '';
      END IF;
    END $$;

    -- Sandbox logs table (bounded)
    CREATE TABLE IF NOT EXISTS sandbox_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
      type VARCHAR(10) NOT NULL,
      text TEXT NOT NULL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sandbox_logs_sandbox_id ON sandbox_logs(sandbox_id);
    CREATE INDEX IF NOT EXISTS idx_sandbox_logs_timestamp ON sandbox_logs(timestamp);

    -- Audit logs table
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(50) NOT NULL,
      resource_type VARCHAR(50) NOT NULL,
      resource_id UUID NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

    -- Clean up old logs (7 day retention) - create function
    CREATE OR REPLACE FUNCTION cleanup_old_logs() RETURNS void AS $$
    BEGIN
      DELETE FROM sandbox_logs WHERE timestamp < NOW() - INTERVAL '7 days';
      DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
    END;
    $$ LANGUAGE plpgsql;
  `;

  await pool.query(migrations);
  logger.info('Database migrations completed successfully');
}

export async function close(): Promise<void> {
  await pool.end();
}

export { pool };

// Run migrations if called directly
if (process.argv[2] === 'migrate') {
  migrate()
    .then(() => {
      logger.info('Migrations complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}
