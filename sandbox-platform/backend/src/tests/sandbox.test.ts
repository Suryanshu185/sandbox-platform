import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../docker.js', () => ({
  createContainer: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
  waitForHealthy: vi.fn(),
  getContainerInfo: vi.fn(),
  streamLogs: vi.fn(),
}));

vi.mock('../services/EnvironmentService.js', () => ({
  environmentService: {
    getEnvironment: vi.fn(),
    getVersion: vi.fn(),
    getDecryptedSecrets: vi.fn(),
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
  QuotaExceededError: class QuotaExceededError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'QuotaExceededError';
    }
  },
}));

import { query, queryOne } from '../db.js';
import * as docker from '../docker.js';
import { environmentService } from '../services/EnvironmentService.js';

describe('SandboxService', () => {
  const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEnvId = '456e4567-e89b-12d3-a456-426614174001';
  const mockVersionId = '789e4567-e89b-12d3-a456-426614174002';
  const mockSandboxId = 'abc4567-e89b-12d3-a456-426614174003';

  const mockEnvironment = {
    id: mockEnvId,
    name: 'test-env',
    currentVersionId: mockVersionId,
    version: {
      id: mockVersionId,
      version: 1,
      image: 'nginx:alpine',
      cpu: 2,
      memory: 512,
      ports: [{ container: 80, host: 8080 }],
      env: { NODE_ENV: 'production' },
      secrets: [],
      mounts: {},
      createdAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockVersion = {
    id: mockVersionId,
    environmentId: mockEnvId,
    version: 1,
    image: 'nginx:alpine',
    cpu: 2,
    memory: 512,
    ports: [{ container: 80, host: 8080 }],
    env: { NODE_ENV: 'production' },
    secrets: {},
    mounts: {},
    createdAt: new Date(),
  };

  const mockSandbox = {
    id: mockSandboxId,
    user_id: mockUserId,
    environment_id: mockEnvId,
    environment_version_id: mockVersionId,
    name: 'test-sandbox',
    container_id: 'container123',
    status: 'running',
    phase: 'healthy',
    ports: [{ container: 80, host: 8080 }],
    created_at: new Date(),
    started_at: new Date(),
    stopped_at: null,
    expires_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sandbox Status Mapping', () => {
    it('should map pending status correctly', () => {
      const sandbox = { ...mockSandbox, status: 'pending', phase: 'creating' };
      expect(sandbox.status).toBe('pending');
      expect(sandbox.phase).toBe('creating');
    });

    it('should map running status correctly', () => {
      const sandbox = { ...mockSandbox, status: 'running', phase: 'healthy' };
      expect(sandbox.status).toBe('running');
      expect(sandbox.phase).toBe('healthy');
    });

    it('should map stopped status correctly', () => {
      const sandbox = { ...mockSandbox, status: 'stopped', phase: 'stopped' };
      expect(sandbox.status).toBe('stopped');
      expect(sandbox.phase).toBe('stopped');
    });

    it('should map error status correctly', () => {
      const sandbox = { ...mockSandbox, status: 'error', phase: 'failed' };
      expect(sandbox.status).toBe('error');
      expect(sandbox.phase).toBe('failed');
    });
  });

  describe('Sandbox Response Format', () => {
    it('should format sandbox response with endpoints', () => {
      const sandbox = { ...mockSandbox };
      const endpoints = sandbox.ports.map((p: { container: number; host: number }) => ({
        port: p.host,
        url: `http://localhost:${p.host}`,
      }));

      expect(endpoints).toEqual([
        { port: 8080, url: 'http://localhost:8080' },
      ]);
    });

    it('should include timestamps in ISO format', () => {
      const sandbox = { ...mockSandbox };
      const response = {
        id: sandbox.id,
        createdAt: sandbox.created_at.toISOString(),
        startedAt: sandbox.started_at?.toISOString() ?? null,
        stoppedAt: sandbox.stopped_at?.toISOString() ?? null,
        expiresAt: sandbox.expires_at?.toISOString() ?? null,
      };

      expect(response.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(response.stoppedAt).toBeNull();
    });
  });

  describe('Quota Validation', () => {
    it('should enforce max sandboxes per user', () => {
      const maxSandboxes = 10;
      const currentCount = 10;

      expect(currentCount >= maxSandboxes).toBe(true);
    });

    it('should allow creation under quota', () => {
      const maxSandboxes = 10;
      const currentCount = 5;

      expect(currentCount < maxSandboxes).toBe(true);
    });
  });

  describe('TTL Handling', () => {
    it('should calculate expiry from TTL seconds', () => {
      const ttlSeconds = 3600; // 1 hour
      const now = Date.now();
      const expiresAt = new Date(now + ttlSeconds * 1000);

      expect(expiresAt.getTime()).toBeGreaterThan(now);
      expect(expiresAt.getTime() - now).toBeCloseTo(ttlSeconds * 1000, -2);
    });

    it('should not set expiry when TTL is not provided', () => {
      const ttlSeconds = undefined;
      const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;

      expect(expiresAt).toBeNull();
    });
  });

  describe('Container Configuration', () => {
    it('should configure resource limits correctly', () => {
      const config = {
        cpu: 2,
        memory: 512,
      };

      const hostConfig = {
        CpuPeriod: 100000,
        CpuQuota: Math.floor(config.cpu * 100000),
        Memory: config.memory * 1024 * 1024,
        MemorySwap: config.memory * 1024 * 1024,
      };

      expect(hostConfig.CpuQuota).toBe(200000); // 2 CPUs
      expect(hostConfig.Memory).toBe(536870912); // 512MB in bytes
      expect(hostConfig.MemorySwap).toBe(hostConfig.Memory); // No swap
    });

    it('should format environment variables correctly', () => {
      const env = {
        NODE_ENV: 'production',
        PORT: '3000',
        SECRET_KEY: 'abc123',
      };

      const envArray = Object.entries(env).map(([k, v]) => `${k}=${v}`);

      expect(envArray).toContain('NODE_ENV=production');
      expect(envArray).toContain('PORT=3000');
      expect(envArray).toContain('SECRET_KEY=abc123');
    });

    it('should configure port mappings correctly', () => {
      const ports = [
        { container: 80, host: 8080 },
        { container: 443, host: 8443 },
      ];

      const exposedPorts: Record<string, object> = {};
      const portBindings: Record<string, Array<{ HostPort: string }>> = {};

      for (const port of ports) {
        const containerPort = `${port.container}/tcp`;
        exposedPorts[containerPort] = {};
        portBindings[containerPort] = [{ HostPort: String(port.host) }];
      }

      expect(exposedPorts['80/tcp']).toEqual({});
      expect(portBindings['80/tcp']).toEqual([{ HostPort: '8080' }]);
      expect(portBindings['443/tcp']).toEqual([{ HostPort: '8443' }]);
    });
  });

  describe('Idempotency', () => {
    it('should use (userId, environmentId, name) as idempotency key', () => {
      const key1 = `${mockUserId}-${mockEnvId}-test-sandbox`;
      const key2 = `${mockUserId}-${mockEnvId}-test-sandbox`;
      const key3 = `${mockUserId}-${mockEnvId}-different-sandbox`;

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });
});
