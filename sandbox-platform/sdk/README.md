# Sandbox Platform SDK

TypeScript SDK for the Sandbox Platform API.

## Installation

```bash
npm install @sandbox-platform/sdk
```

## Quick Start

```typescript
import { SandboxClient } from '@sandbox-platform/sdk';

const client = new SandboxClient({
  baseUrl: 'http://localhost:3001',
  apiKey: 'your-api-key',
});

// Create an environment
const env = await client.createEnvironment({
  name: 'my-python-env',
  image: 'python:3.11',
  cpu: 1,
  memory: 512,
  ports: [{ container: 8000, host: 8000 }],
  env: { DEBUG: 'true' },
});

// Create a sandbox from the environment
const sandbox = await client.createSandbox({
  environmentId: env.id,
  name: 'my-sandbox',
  ttlSeconds: 3600,
});

// Wait for sandbox to be running
const runningSandbox = await client.waitForStatus(sandbox.id, 'running');

// Execute commands in the sandbox
const result = await client.exec(sandbox.id, ['python', '--version']);
console.log(result.output); // Python 3.11.x

// Get resource metrics
const metrics = await client.getSandboxMetrics(sandbox.id);
console.log(`CPU: ${metrics.cpu.usagePercent}%`);
console.log(`Memory: ${metrics.memory.usagePercent}%`);

// Stop and destroy when done
await client.stopSandbox(sandbox.id);
await client.destroySandbox(sandbox.id);
```

## API Reference

### Client Configuration

```typescript
interface SandboxClientConfig {
  baseUrl: string;  // API base URL
  apiKey: string;   // Your API key
  timeout?: number; // Request timeout in ms (default: 30000)
}
```

### Environments

```typescript
// Create environment
const env = await client.createEnvironment({
  name: 'my-env',
  image: 'node:20',
  cpu: 1,        // Optional: CPU cores
  memory: 512,   // Optional: Memory in MB
  ports: [{ container: 3000, host: 3000 }], // Optional
  env: { NODE_ENV: 'production' }, // Optional
});

// List environments
const environments = await client.listEnvironments();

// Get environment
const env = await client.getEnvironment('env-id');

// Update environment (creates new version)
const updated = await client.updateEnvironment('env-id', {
  image: 'node:21',
});

// Delete environment
await client.deleteEnvironment('env-id');

// Manage secrets
await client.setSecret('env-id', 'API_KEY', 'secret-value');
await client.deleteSecret('env-id', 'API_KEY');
```

### Sandboxes

```typescript
// Create sandbox
const sandbox = await client.createSandbox({
  environmentId: 'env-id',
  name: 'my-sandbox',         // Optional
  ttlSeconds: 3600,           // Optional: TTL in seconds
  overrides: {                // Optional
    env: { DEBUG: 'true' },
    ports: [{ container: 8080, host: 8080 }],
  },
});

// Create and wait for running
const sandbox = await client.createAndWaitForRunning({
  environmentId: 'env-id',
});

// List sandboxes
const sandboxes = await client.listSandboxes();
const running = await client.listSandboxes({ status: 'running' });
const byEnv = await client.listSandboxes({ environmentId: 'env-id' });

// Get sandbox
const sandbox = await client.getSandbox('sandbox-id');

// Lifecycle operations
await client.startSandbox('sandbox-id');
await client.stopSandbox('sandbox-id');
await client.restartSandbox('sandbox-id');
await client.destroySandbox('sandbox-id');

// Clone a sandbox
const clone = await client.replicateSandbox('sandbox-id', {
  name: 'cloned-sandbox',
});

// Get logs
const logs = await client.getSandboxLogs('sandbox-id', 100);

// Get metrics
const metrics = await client.getSandboxMetrics('sandbox-id');

// Execute command
const result = await client.exec('sandbox-id', ['ls', '-la']);
console.log(result.exitCode);
console.log(result.output);
```

### Error Handling

```typescript
import { SandboxClient, SandboxApiError } from '@sandbox-platform/sdk';

try {
  await client.getSandbox('invalid-id');
} catch (error) {
  if (error instanceof SandboxApiError) {
    console.log(error.code);    // 'NOT_FOUND'
    console.log(error.message); // 'Sandbox not found'
  }
}
```

## Types

All types are exported from the package:

```typescript
import type {
  Environment,
  Sandbox,
  SandboxStatus,
  ContainerMetrics,
  ExecResult,
  // ... etc
} from '@sandbox-platform/sdk';
```

## License

MIT
