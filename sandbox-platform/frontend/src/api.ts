import type {
  ApiResponse,
  User,
  ApiKey,
  Environment,
  Sandbox,
  LogEntry,
  PortMapping,
  ContainerMetrics,
  ExecResult,
} from './types';

const API_BASE = '/api';

// Hash password client-side before sending to server
// This ensures plain-text password never appears in network requests
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const data: ApiResponse<T> = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'An error occurred');
    }

    return data.data as T;
  }

  // Auth
  async signup(email: string, password: string): Promise<{ user: User; token: string }> {
    const hashedPassword = await hashPassword(password);
    return this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: hashedPassword }),
    });
  }

  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const hashedPassword = await hashPassword(password);
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: hashedPassword }),
    });
  }

  async getMe(): Promise<User> {
    return this.request('/auth/me');
  }

  // API Keys
  async createApiKey(name: string): Promise<ApiKey> {
    return this.request('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async listApiKeys(): Promise<ApiKey[]> {
    return this.request('/api-keys');
  }

  async revokeApiKey(id: string): Promise<void> {
    return this.request(`/api-keys/${id}`, { method: 'DELETE' });
  }

  // Environments
  async createEnvironment(data: {
    name: string;
    image: string;
    cpu?: number;
    memory?: number;
    ports?: PortMapping[];
    env?: Record<string, string>;
  }): Promise<Environment> {
    return this.request('/environments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listEnvironments(): Promise<Environment[]> {
    return this.request('/environments');
  }

  async getEnvironment(id: string): Promise<Environment> {
    return this.request(`/environments/${id}`);
  }

  async updateEnvironment(
    id: string,
    data: Partial<{
      image: string;
      cpu: number;
      memory: number;
      ports: PortMapping[];
      env: Record<string, string>;
    }>
  ): Promise<Environment> {
    return this.request(`/environments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteEnvironment(id: string): Promise<void> {
    return this.request(`/environments/${id}`, { method: 'DELETE' });
  }

  async setSecret(envId: string, key: string, value: string): Promise<void> {
    return this.request(`/environments/${envId}/secrets`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });
  }

  async deleteSecret(envId: string, key: string): Promise<void> {
    return this.request(`/environments/${envId}/secrets/${key}`, {
      method: 'DELETE',
    });
  }

  // Sandboxes
  async createSandbox(data: {
    environmentId: string;
    environmentVersionId?: string;
    name?: string;
    ttlSeconds?: number;
    overrides?: {
      env?: Record<string, string>;
      ports?: PortMapping[];
    };
  }): Promise<Sandbox> {
    return this.request('/sandboxes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listSandboxes(filters?: {
    status?: string;
    environmentId?: string;
  }): Promise<Sandbox[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.environmentId) params.set('environmentId', filters.environmentId);

    const query = params.toString();
    return this.request(`/sandboxes${query ? `?${query}` : ''}`);
  }

  async getSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}`);
  }

  async startSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/start`, { method: 'POST' });
  }

  async stopSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/stop`, { method: 'POST' });
  }

  async restartSandbox(id: string): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/restart`, { method: 'POST' });
  }

  async destroySandbox(id: string): Promise<void> {
    return this.request(`/sandboxes/${id}`, { method: 'DELETE' });
  }

  async replicateSandbox(
    id: string,
    data?: {
      name?: string;
      overrides?: {
        env?: Record<string, string>;
        ports?: PortMapping[];
      };
    }
  ): Promise<Sandbox> {
    return this.request(`/sandboxes/${id}/replicate`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  async getSandboxLogs(id: string, tail = 100): Promise<LogEntry[]> {
    return this.request(`/sandboxes/${id}/logs?tail=${tail}`);
  }

  async getSandboxMetrics(id: string): Promise<ContainerMetrics> {
    return this.request(`/sandboxes/${id}/metrics`);
  }

  async execInSandbox(id: string, command: string[]): Promise<ExecResult> {
    return this.request(`/sandboxes/${id}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  // WebSocket for log streaming
  createLogStream(sandboxId: string): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/sandboxes/${sandboxId}/logs?token=${this.token}`;
    return new WebSocket(wsUrl);
  }
}

export const api = new ApiClient();
export default api;
