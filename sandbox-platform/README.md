# Sandbox Platform

A production-grade sandbox platform for running isolated containerized environments. Users can define OCI container environments, spin up isolated sandboxes, stream logs in real-time, and manage the full lifecycle from creation to destruction.

## Features

### Core
- **User Authentication**: Email/password signup with bcrypt hashing, JWT tokens, and API key management
- **Environment Definitions**: Define immutable, versioned container configurations
- **Sandbox Lifecycle**: Create, start, stop, restart, and destroy sandboxes
- **Log Streaming**: Real-time WebSocket log streaming with polling fallback
- **Secrets Management**: Encrypted at rest using AES-256-GCM
- **Replication**: Clone sandboxes with optional overrides
- **Resource Limits**: Enforced CPU/memory caps via cgroups
- **Rate Limiting**: Per-user rate limits and quota enforcement
- **Observability**: Prometheus metrics, structured JSON logging, audit trail

### Bonus Features
- **Interactive Terminal**: Full PTY shell access via WebSocket + xterm.js (vim, htop, etc. work)
- **Process-Level Metrics**: Real-time CPU, memory, network I/O, and disk I/O per sandbox
- **TypeScript SDK**: Fully typed client library with convenience methods
- **Performance Documentation**: Benchmarks, scaling strategies, and Kubernetes deployment examples

## Quick Start

### Prerequisites

- Node.js 18+
- Docker
- PostgreSQL 16+

### 1. Start Infrastructure (PostgreSQL + Prometheus + Grafana)

```bash
cd backend
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Prometheus on port 9090
- Grafana on port 3000 (admin/admin)

### 2. Configure Environment

```bash
# Backend
cp backend/.env.example backend/.env

# Generate secrets
echo "JWT_SECRET=$(openssl rand -base64 32)" >> backend/.env
echo "SECRETS_MASTER_KEY=$(openssl rand -base64 32)" >> backend/.env
```

### 3. Install Dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 4. Start Development Servers

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

### 5. Access the Platform

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001
- **Health**: http://localhost:3001/health
- **Metrics**: http://localhost:3001/metrics
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/admin)

## Demo Flow

### 1. Sign Up

```bash
curl -X POST http://localhost:3001/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@example.com", "password": "password123"}'
```

Response:
```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "email": "demo@example.com" },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### 2. Create an API Key

```bash
export TOKEN="<jwt-token-from-signup>"

curl -X POST http://localhost:3001/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Development Key"}'
```

### 3. Create an Environment

```bash
curl -X POST http://localhost:3001/environments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "nginx-demo",
    "image": "nginx:alpine",
    "cpu": 1,
    "memory": 256,
    "ports": [{"container": 80, "host": 8080}],
    "env": {"NGINX_HOST": "localhost"}
  }'
```

### 4. Add a Secret

```bash
export ENV_ID="<environment-id>"

curl -X POST http://localhost:3001/environments/$ENV_ID/secrets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "API_KEY", "value": "super-secret-value"}'
```

### 5. Create a Sandbox

```bash
curl -X POST http://localhost:3001/sandboxes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "environmentId": "'$ENV_ID'",
    "name": "demo-sandbox",
    "ttlSeconds": 3600
  }'
```

### 6. View Sandbox Logs

```bash
export SANDBOX_ID="<sandbox-id>"

# Polling
curl http://localhost:3001/sandboxes/$SANDBOX_ID/logs?tail=100 \
  -H "Authorization: Bearer $TOKEN"

# WebSocket
wscat -c "ws://localhost:3001/ws/sandboxes/$SANDBOX_ID/logs?token=$TOKEN"
```

### 7. Lifecycle Operations

```bash
# Stop
curl -X POST http://localhost:3001/sandboxes/$SANDBOX_ID/stop \
  -H "Authorization: Bearer $TOKEN"

# Start
curl -X POST http://localhost:3001/sandboxes/$SANDBOX_ID/start \
  -H "Authorization: Bearer $TOKEN"

# Replicate
curl -X POST http://localhost:3001/sandboxes/$SANDBOX_ID/replicate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "demo-sandbox-clone"}'

# Destroy
curl -X DELETE http://localhost:3001/sandboxes/$SANDBOX_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 8. Interactive Terminal (WebSocket)

Connect to a running sandbox's terminal via WebSocket:

```bash
# Using wscat
wscat -c "ws://localhost:3001/ws/sandboxes/$SANDBOX_ID/terminal?token=$TOKEN"
```

Or use the frontend UI which provides a full xterm.js terminal with PTY support.

### 9. Container Metrics

```bash
curl http://localhost:3001/sandboxes/$SANDBOX_ID/metrics \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "success": true,
  "data": {
    "cpu": { "usagePercent": 2.5, "systemPercent": 1.2, "cores": 1 },
    "memory": { "usageBytes": 52428800, "limitBytes": 268435456, "usagePercent": 19.5 },
    "network": { "rxBytes": 1024, "txBytes": 512, "rxPackets": 10, "txPackets": 5 },
    "io": { "readBytes": 4096, "writeBytes": 2048 }
  }
}
```

## TypeScript SDK

Install the SDK in your project:

```bash
npm install @sandbox-platform/sdk
```

### Usage

```typescript
import { SandboxClient } from '@sandbox-platform/sdk';

const client = new SandboxClient({
  baseUrl: 'http://localhost:3001',
  apiKey: 'sk_your_api_key',
});

// Create an environment
const env = await client.createEnvironment({
  name: 'node-app',
  image: 'node:20-alpine',
  cpu: 1,
  memory: 512,
  ports: [{ container: 3000, host: 8080 }],
});

// Create and start a sandbox
const sandbox = await client.createSandbox({
  environmentId: env.id,
  name: 'my-sandbox',
  ttlSeconds: 3600,
});

// Get real-time metrics
const metrics = await client.getMetrics(sandbox.id);
console.log(`CPU: ${metrics.cpu.usagePercent}%`);

// Execute a command
const result = await client.exec(sandbox.id, 'node --version');
console.log(result.stdout); // v20.x.x

// Clean up
await client.destroySandbox(sandbox.id);
```

### SDK Methods

| Method | Description |
|--------|-------------|
| `login(email, password)` | Authenticate and get JWT token |
| `createEnvironment(config)` | Create container environment |
| `listEnvironments()` | List all environments |
| `createSandbox(config)` | Create new sandbox |
| `listSandboxes()` | List all sandboxes |
| `getSandbox(id)` | Get sandbox details |
| `startSandbox(id)` | Start stopped sandbox |
| `stopSandbox(id)` | Stop running sandbox |
| `destroySandbox(id)` | Destroy sandbox |
| `replicateSandbox(id, overrides)` | Clone sandbox |
| `getLogs(id, options)` | Get sandbox logs |
| `getMetrics(id)` | Get CPU/memory/network metrics |
| `exec(id, command)` | Execute command in sandbox |

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Create account |
| POST | `/auth/login` | Get JWT token |
| GET | `/auth/me` | Get current user |

### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api-keys` | Create API key |
| GET | `/api-keys` | List API keys |
| DELETE | `/api-keys/:id` | Revoke API key |

### Environments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/environments` | Create environment |
| GET | `/environments` | List environments |
| GET | `/environments/:id` | Get environment |
| PUT | `/environments/:id` | Update (new version) |
| DELETE | `/environments/:id` | Delete environment |
| POST | `/environments/:id/secrets` | Set secret |
| DELETE | `/environments/:id/secrets/:key` | Delete secret |

### Sandboxes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/sandboxes` | Create sandbox |
| GET | `/sandboxes` | List sandboxes |
| GET | `/sandboxes/:id` | Get sandbox |
| POST | `/sandboxes/:id/start` | Start sandbox |
| POST | `/sandboxes/:id/stop` | Stop sandbox |
| POST | `/sandboxes/:id/restart` | Restart sandbox |
| DELETE | `/sandboxes/:id` | Destroy sandbox |
| POST | `/sandboxes/:id/replicate` | Clone sandbox |
| GET | `/sandboxes/:id/logs` | Get logs (polling) |
| GET | `/sandboxes/:id/metrics` | Get CPU/memory/network/IO metrics |
| POST | `/sandboxes/:id/exec` | Execute command in sandbox |
| WS | `/ws/sandboxes/:id/logs` | Stream logs |
| WS | `/ws/sandboxes/:id/terminal` | Interactive PTY terminal |

### Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/health/ready` | Readiness check |
| GET | `/health/live` | Liveness check |
| GET | `/metrics` | Prometheus metrics |

## Security Design

### Authentication
- Passwords hashed with bcrypt (cost factor 12)
- JWT tokens with configurable expiry
- API keys hashed (only shown once on creation)

### Secrets Encryption
- AES-256-GCM authenticated encryption
- Random IV per encryption
- Master key from environment variable
- Never logged or returned to frontend

### Container Isolation
- CPU/memory limits via cgroups
- No host mounts (explicit allow-list only)
- Dropped capabilities (`CAP_DROP: ALL`)
- `no-new-privileges` security option
- Network isolation (Docker bridge)

### API Security
- Rate limiting per user (100/min default)
- Stricter auth rate limits (20/15min)
- CORS configuration
- Request/response logging (secrets redacted)
- Audit trail for all actions

## Observability

### Prometheus Metrics

```
# Request metrics
http_request_duration_seconds{method,path,status}
http_requests_total{method,path,status}

# Business metrics
sandboxes_running
sandboxes_total
environments_total
users_total
```

### Health Check

```bash
curl http://localhost:3001/health
```

```json
{
  "status": "ok",
  "db": "ok",
  "docker": "ok",
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

### Structured Logging

All requests are logged in JSON format with:
- Trace ID (x-trace-id header)
- Method, path, status
- Duration (ms)
- User ID (if authenticated)
- Secrets redacted

## Testing

```bash
cd backend

# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests cover:
- Authentication (signup, login, JWT, API keys)
- Secrets encryption/decryption
- Sandbox lifecycle states
- Resource limit configuration
- Quota enforcement
- Integration happy path

## What's Real vs Mocked

### Real (Fully Implemented)
- Docker containers (via dockerode SDK)
- PostgreSQL database
- Secrets encryption (AES-256-GCM)
- JWT authentication + bcrypt password hashing
- WebSocket log streaming
- Interactive terminal with full PTY (vim, htop work)
- Container resource metrics (CPU, memory, network, I/O)
- Rate limiting
- Prometheus metrics + Grafana dashboards
- TypeScript SDK client library

### Simplified/Not Included
- Multi-node scheduling (single Docker host)
- Persistent volumes (ephemeral containers only)
- Custom networking (Docker bridge only)
- Container image building (uses pre-built images)

## Known Trade-offs

1. **Single-node only**: All sandboxes run on one Docker host. For scale, would need distributed scheduler (Kubernetes, Nomad).

2. **Ephemeral sandboxes**: No persistent storage. Data is lost on container restart.

3. **Basic networking**: Docker bridge + port mapping. No custom overlay networks or service mesh.

4. **Simple health checks**: Wait-for-running vs proper health endpoints. Production would use container HEALTHCHECK.

5. **Log storage**: PostgreSQL table with 10K line limit. Production would use dedicated log aggregation (ELK, Loki).

## Next 2 Things I'd Ship

1. **Distributed Scheduling**: Multi-node support with Kubernetes or Nomad for horizontal scaling. The current architecture cleanly separates container orchestration (`docker.ts`) from business logic, making this a natural extension. Would add node health monitoring, pod affinity rules, and auto-scaling based on queue depth.

2. **Persistent Volumes**: Container-native storage with snapshot/restore capabilities. Would enable stateful workloads (databases, ML training) with copy-on-write snapshots for instant sandbox cloning with data.

## Project Structure

```
sandbox-platform/
├── backend/
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── db.ts              # PostgreSQL + migrations
│   │   ├── docker.ts          # Docker SDK wrapper + interactive exec
│   │   ├── logger.ts          # Pino setup with secret redaction
│   │   ├── websocket.ts       # WebSocket server (logs + terminal)
│   │   ├── types.ts           # TypeScript types
│   │   ├── middleware/        # Auth, logging, rate-limit
│   │   ├── routes/            # API endpoints
│   │   ├── services/          # Business logic + audit
│   │   └── tests/             # Test suites
│   ├── docker-compose.yml     # PostgreSQL + Prometheus + Grafana
│   ├── prometheus.yml         # Metrics scraping config
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts             # API client
│   │   ├── types.ts
│   │   ├── hooks/             # React Query hooks
│   │   ├── components/        # UI components (Terminal, Metrics, etc.)
│   │   └── pages/             # Route pages
│   └── package.json
├── sdk/                        # TypeScript SDK
│   ├── src/
│   │   ├── client.ts          # SandboxClient class
│   │   ├── types.ts           # Exported types
│   │   └── index.ts           # Public API
│   ├── package.json
│   └── tsconfig.json
├── PERFORMANCE.md              # Benchmarks & scaling documentation
└── README.md
```