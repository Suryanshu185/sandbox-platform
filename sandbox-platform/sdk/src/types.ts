// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// User types
export interface User {
  id: string;
  email: string;
  createdAt: string;
}

// API Key types
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  key?: string; // Only present on creation
  createdAt: string;
  lastUsedAt: string | null;
}

// Port mapping
export interface PortMapping {
  container: number;
  host: number;
}

// Environment types
export interface EnvironmentVersion {
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
}

export interface Environment {
  id: string;
  name: string;
  currentVersionId: string | null;
  version?: EnvironmentVersion;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnvironmentParams {
  name: string;
  image: string;
  cpu?: number;
  memory?: number;
  ports?: PortMapping[];
  env?: Record<string, string>;
}

export interface UpdateEnvironmentParams {
  image?: string;
  cpu?: number;
  memory?: number;
  ports?: PortMapping[];
  env?: Record<string, string>;
}

// Sandbox types
export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'error' | 'expired';
export type SandboxPhase = 'creating' | 'starting' | 'healthy' | 'stopping' | 'stopped' | 'failed';

export interface Endpoint {
  port: number;
  url: string;
}

export interface Sandbox {
  id: string;
  name: string;
  environmentId: string;
  environmentVersionId: string;
  status: SandboxStatus;
  phase: SandboxPhase;
  ports: PortMapping[];
  endpoints: Endpoint[];
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  expiresAt: string | null;
  logsPreview?: string[];
  provisionProgress?: number;
  provisionStatus?: string;
}

export interface CreateSandboxParams {
  environmentId: string;
  environmentVersionId?: string;
  name?: string;
  ttlSeconds?: number;
  overrides?: {
    env?: Record<string, string>;
    ports?: PortMapping[];
  };
}

export interface ReplicateSandboxParams {
  name?: string;
  overrides?: {
    env?: Record<string, string>;
    ports?: PortMapping[];
  };
}

export interface ListSandboxesParams {
  status?: SandboxStatus;
  environmentId?: string;
}

// Log types
export interface LogEntry {
  type: 'stdout' | 'stderr';
  text: string;
  timestamp: string;
}

// Metrics types
export interface ContainerMetrics {
  cpu: {
    usagePercent: number;
    systemUsage: number;
    containerUsage: number;
  };
  memory: {
    usageBytes: number;
    limitBytes: number;
    usagePercent: number;
  };
  network: {
    rxBytes: number;
    txBytes: number;
  };
  blockIO: {
    readBytes: number;
    writeBytes: number;
  };
  timestamp: string;
}

// Exec types
export interface ExecResult {
  exitCode: number;
  output: string;
}

// Client configuration
export interface SandboxClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}
