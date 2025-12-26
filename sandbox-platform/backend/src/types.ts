import { z } from "zod";

// Database models
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  userId: string;
  keyPrefix: string;
  keyHash: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface Environment {
  id: string;
  userId: string;
  name: string;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnvironmentVersion {
  id: string;
  environmentId: string;
  version: number;
  image: string;
  dockerfile?: string;
  buildFiles?: Record<string, string>;
  command?: string[];
  cpu: number;
  memory: number;
  ports: PortMapping[];
  env: Record<string, string>;
  secrets: Record<string, string>; // encrypted values
  mounts: Record<string, string>;
  createdAt: Date;
}

export interface PortMapping {
  container: number;
  host: number;
}

export type SandboxStatus =
  | "pending"
  | "running"
  | "stopped"
  | "error"
  | "expired";
export type SandboxPhase =
  | "creating"
  | "starting"
  | "healthy"
  | "stopping"
  | "stopped"
  | "failed";

export interface Sandbox {
  id: string;
  userId: string;
  environmentId: string;
  environmentVersionId: string;
  name: string;
  containerId: string | null;
  status: SandboxStatus;
  phase: SandboxPhase;
  ports: PortMapping[];
  createdAt: Date;
  startedAt: Date | null;
  stoppedAt: Date | null;
  expiresAt: Date | null;
  provisionProgress: number;
  provisionStatus: string;
}

export interface SandboxLog {
  id: string;
  sandboxId: string;
  type: "stdout" | "stderr";
  text: string;
  timestamp: Date;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resourceType: "environment" | "sandbox" | "api_key" | "user";
  resourceId: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// Request/Response schemas
export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
});

export const PortMappingSchema = z.object({
  container: z.number().int().min(1).max(65535),
  host: z.number().int().min(1024).max(65535),
});

export const CreateEnvironmentSchema = z
  .object({
    name: z.string().min(1).max(100),
    // Either image OR dockerfile must be provided
    image: z
      .string()
      .min(1)
      .max(500)
      .regex(
        /^[a-z0-9][a-z0-9._\-/]*(:[\w][\w.\-]*)?$/i,
        "Invalid Docker image format",
      )
      .optional(),
    dockerfile: z.string().min(1).max(50000).optional(), // Max 50KB Dockerfile
    buildFiles: z.record(z.string()).optional(), // Additional files for build context (filename -> content)
    command: z.array(z.string()).optional(), // Override container CMD
    cpu: z.number().min(0.25).max(4).default(2),
    memory: z.number().int().min(128).max(2048).default(512),
    ports: z.array(PortMappingSchema).max(10).default([]),
    env: z.record(z.string()).default({}),
    mounts: z.record(z.string()).default({}), // container_path -> volume_name (no host mounts)
  })
  .refine((data) => data.image || data.dockerfile, {
    message: "Either image or dockerfile must be provided",
  });

export const UpdateEnvironmentSchema = z.object({
  image: z
    .string()
    .min(1)
    .max(500)
    .regex(/^[a-z0-9][a-z0-9._\-/]*(:[\w][\w.\-]*)?$/i)
    .optional(),
  dockerfile: z.string().min(1).max(50000).optional(),
  buildFiles: z.record(z.string()).optional(),
  command: z.array(z.string()).optional(),
  cpu: z.number().min(0.25).max(4).optional(),
  memory: z.number().int().min(128).max(2048).optional(),
  ports: z.array(PortMappingSchema).max(10).optional(),
  env: z.record(z.string()).optional(),
  mounts: z.record(z.string()).optional(),
});

export const CreateSecretSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z_][A-Z0-9_]*$/, "Secret key must be UPPER_SNAKE_CASE"),
  value: z.string().min(1).max(10000),
});

export const CreateSandboxSchema = z.object({
  environmentId: z.string().uuid(),
  environmentVersionId: z.string().uuid().optional(),
  name: z.string().min(1).max(100).optional(),
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(86400 * 7)
    .optional(), // max 7 days
  overrides: z
    .object({
      env: z.record(z.string()).optional(),
      ports: z.array(PortMappingSchema).optional(),
    })
    .optional(),
});

export const ReplicateSandboxSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  overrides: z
    .object({
      env: z.record(z.string()).optional(),
      ports: z.array(PortMappingSchema).optional(),
    })
    .optional(),
});

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// Auth context
export interface AuthContext {
  userId: string;
  email?: string;
  apiKeyId?: string;
  traceId: string;
}

// JWT payload
export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

// WebSocket message types
export interface LogMessage {
  type: "stdout" | "stderr";
  text: string;
  timestamp: string;
}

export interface WsMessage {
  event: "log" | "status" | "error";
  data: LogMessage | { status: SandboxStatus } | { message: string };
}

// Environment response (with redacted secrets)
export interface EnvironmentResponse {
  id: string;
  name: string;
  currentVersionId: string | null;
  version?: {
    id: string;
    version: number;
    image: string;
    cpu: number;
    memory: number;
    ports: PortMapping[];
    env: Record<string, string>;
    secrets: Array<{ key: string; redacted: true }>;
    mounts: Record<string, string>;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

// Sandbox response
export interface SandboxResponse {
  id: string;
  name: string;
  environmentId: string;
  environmentVersionId: string;
  status: SandboxStatus;
  phase: SandboxPhase;
  ports: PortMapping[];
  endpoints: Array<{ port: number; url: string }>;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  expiresAt: string | null;
  logsPreview?: string[];
  provisionProgress?: number;
  provisionStatus?: string;
}
