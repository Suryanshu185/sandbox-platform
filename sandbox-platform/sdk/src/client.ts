import type {
  ApiResponse,
  SandboxClientConfig,
  Environment,
  CreateEnvironmentParams,
  UpdateEnvironmentParams,
  Sandbox,
  CreateSandboxParams,
  ReplicateSandboxParams,
  ListSandboxesParams,
  LogEntry,
  ContainerMetrics,
  ExecResult,
} from './types';

export class SandboxApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SandboxApiError';
  }
}

export class SandboxClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: SandboxClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          ...options.headers,
        },
      });

      const data = (await response.json()) as ApiResponse<T>;

      if (!data.success) {
        throw new SandboxApiError(
          data.error?.code ?? 'UNKNOWN_ERROR',
          data.error?.message ?? 'An unknown error occurred',
          data.error?.details
        );
      }

      return data.data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================
  // Environments
  // ============================================================

  /**
   * Create a new environment
   */
  async createEnvironment(params: CreateEnvironmentParams): Promise<Environment> {
    return this.request('/environments', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * List all environments
   */
  async listEnvironments(): Promise<Environment[]> {
    return this.request('/environments');
  }

  /**
   * Get an environment by ID
   */
  async getEnvironment(id: string): Promise<Environment> {
    return this.request(`/environments/${id}`);
  }

  /**
   * Update an environment (creates a new version)
   */
  async updateEnvironment(id: string, params: UpdateEnvironmentParams): Promise<Environment> {
    return this.request(`/environments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  /**
   * Delete an environment
   */
  async deleteEnvironment(id: string): Promise<void> {
    await this.request(`/environments/${id}`, { method: 'DELETE' });
  }

  /**
   * Set a secret on an environment
   */
  async setSecret(environmentId: string, key: string, value: string): Promise<void> {
    await this.request(`/environments/${environmentId}/secrets`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });
  }

  /**
   * Delete a secret from an environment
   */
  async deleteSecret(environmentId: string, key: string): Promise<void> {
    await this.request(`/environments/${environmentId}/secrets/${key}`, {
      method: 'DELETE',
    });
  }

  // ============================================================
  // Sandboxes
  // ============================================================

  /**
   * Create a new sandbox
   */
  async createSandbox(params: CreateSandboxParams): Promise<Sandbox> {
    return this.request('/sandboxes', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * List sandboxes with optional filters
   */
  async listSandboxes(params?: ListSandboxesParams): Promise<Sandbox[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.environmentId) queryParams.set('environmentId', params.environmentId);

    const query = queryParams.toString();
    return this.request(`/sandboxes${query ? `?${query}` : ''}`);
  }

  /**
   * Get a sandbox by ID
   */
  async getSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}`);
  }

  /**
   * Start a stopped sandbox
   */
  async startSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/start`, { method: 'POST' });
  }

  /**
   * Stop a running sandbox
   */
  async stopSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/stop`, { method: 'POST' });
  }

  /**
   * Restart a sandbox
   */
  async restartSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/restart`, { method: 'POST' });
  }

  /**
   * Destroy a sandbox permanently
   */
  async destroySandbox(id: string): Promise<void> {
    await this.request(`/sandboxes/${id}`, { method: 'DELETE' });
  }

  /**
   * Replicate (clone) a sandbox
   */
  async replicateSandbox(id: string, params?: ReplicateSandboxParams): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/replicate`, {
      method: 'POST',
      body: JSON.stringify(params ?? {}),
    });
  }

  /**
   * Get sandbox logs
   */
  async getSandboxLogs(id: string, tail = 100): Promise<LogEntry[]> {
    return this.request(`/sandboxes/${id}/logs?tail=${tail}`);
  }

  /**
   * Get sandbox resource metrics (CPU, memory, network, I/O)
   */
  async getSandboxMetrics(id: string): Promise<ContainerMetrics> {
    return this.request(`/sandboxes/${id}/metrics`);
  }

  /**
   * Execute a command in a sandbox
   */
  async exec(id: string, command: string[]): Promise<ExecResult> {
    return this.request(`/sandboxes/${id}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  // ============================================================
  // Convenience Methods
  // ============================================================

  /**
   * Wait for a sandbox to reach a specific status
   */
  async waitForStatus(
    id: string,
    targetStatus: Sandbox['status'],
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<Sandbox> {
    const { timeout = 60000, pollInterval = 1000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const sandbox = await this.getSandbox(id);

      if (sandbox.status === targetStatus) {
        return sandbox;
      }

      if (sandbox.status === 'error') {
        throw new SandboxApiError('SANDBOX_ERROR', 'Sandbox entered error state');
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new SandboxApiError('TIMEOUT', `Timed out waiting for sandbox to reach ${targetStatus} status`);
  }

  /**
   * Create a sandbox and wait for it to be running
   */
  async createAndWaitForRunning(
    params: CreateSandboxParams,
    waitOptions?: { timeout?: number; pollInterval?: number }
  ): Promise<Sandbox> {
    const sandbox = await this.createSandbox(params);
    return this.waitForStatus(sandbox.id, 'running', waitOptions);
  }
}
