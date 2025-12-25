# Sandbox Platform

A platform for spinning up, observing, and tearing down isolated container sandboxes on demand.

**Sandbox** = OCI image → fenced process with its own FS/NET/CPU/RAM, fully lifecycle-managed via API.

## What It Does

- **Auth & Tenancy**: User signup, JWT tokens, API keys (create/revoke), tenant isolation
- **Environment Definitions**: OCI image + config (ports, env vars, resources), immutable versioning
- **Sandbox Lifecycle**: Create, start, stop, restart, destroy, optional TTL auto-cleanup
- **Status & Logs**: Live phase tracking, WebSocket log streaming, audit trail
- **Replication**: Clone sandboxes with optional overrides
- **Secrets**: AES-256-GCM encrypted at rest, injected at runtime, never logged
- **Observer UI**: List/filter sandboxes, detail view with live logs + metrics
- **Guardrails**: Per-user quotas, rate limits, health endpoints, Prometheus metrics

**Bonus implemented**: Interactive terminal (PTY via WebSocket), process-level metrics (CPU/RAM/network/IO), TypeScript SDK.

---

## How to Run Locally

### Prerequisites
- Node.js 18+
- Docker
- PostgreSQL (or use docker-compose)

### 1. Start Infrastructure

```bash
cd backend
docker-compose up -d   # PostgreSQL + Prometheus + Grafana
```

### 2. Configure Environment

```bash
cp backend/.env.example backend/.env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> backend/.env
echo "SECRETS_MASTER_KEY=$(openssl rand -base64 32)" >> backend/.env
```

### 3. Install & Run

```bash
# Terminal 1
cd backend && npm install && npm run dev

# Terminal 2
cd frontend && npm install && npm run dev
```

### 4. Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| API | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 (admin/admin) |

---

## Demo Flow

### 1. Sign Up & Get Token

```bash
curl -X POST http://localhost:3001/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@example.com", "password": "password123"}'

export TOKEN="<token-from-response>"
```

### 2. Create API Key

```bash
curl -X POST http://localhost:3001/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "dev-key"}'
```

### 3. Define Environment

```bash
curl -X POST http://localhost:3001/environments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "nginx-demo",
    "image": "nginx:alpine",
    "cpu": 1,
    "memory": 256,
    "ports": [{"container": 80, "host": 8080}]
  }'

export ENV_ID="<id-from-response>"
```

### 4. Add Secret (encrypted at rest)

```bash
curl -X POST http://localhost:3001/environments/$ENV_ID/secrets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "API_KEY", "value": "secret-value"}'
```

### 5. Create Sandbox

```bash
curl -X POST http://localhost:3001/sandboxes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environmentId": "'$ENV_ID'", "name": "demo-sandbox", "ttlSeconds": 3600}'

export SANDBOX_ID="<id-from-response>"
```

### 6. Stream Logs (WebSocket)

```bash
wscat -c "ws://localhost:3001/ws/sandboxes/$SANDBOX_ID/logs?token=$TOKEN"
```

### 7. Interactive Terminal (WebSocket)

```bash
wscat -c "ws://localhost:3001/ws/sandboxes/$SANDBOX_ID/terminal?token=$TOKEN"
```

### 8. Get Metrics

```bash
curl http://localhost:3001/sandboxes/$SANDBOX_ID/metrics \
  -H "Authorization: Bearer $TOKEN"
```

### 9. Replicate Sandbox

```bash
curl -X POST http://localhost:3001/sandboxes/$SANDBOX_ID/replicate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "sandbox-clone"}'
```

### 10. Lifecycle Controls

```bash
curl -X POST http://localhost:3001/sandboxes/$SANDBOX_ID/stop -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3001/sandboxes/$SANDBOX_ID/start -H "Authorization: Bearer $TOKEN"
curl -X DELETE http://localhost:3001/sandboxes/$SANDBOX_ID -H "Authorization: Bearer $TOKEN"
```

---

## What's Real vs Mocked

### Real (Fully Implemented)
| Feature | Implementation |
|---------|----------------|
| Container isolation | Docker with cgroups (CPU/memory limits), dropped capabilities, no-new-privileges |
| Secrets encryption | AES-256-GCM with random IV per encryption |
| Auth | bcrypt password hashing (cost 12), JWT tokens, hashed API keys |
| Log streaming | WebSocket with real Docker log tailing |
| Interactive terminal | Full PTY via Docker exec (vim, htop work) |
| Metrics | Real Docker stats API (CPU%, memory, network, I/O) |
| Rate limiting | express-rate-limit with per-user tracking |
| Observability | Prometheus metrics, structured JSON logging, Grafana dashboards |

### Simplified (Would Enhance for Production)
| Feature | Current | Production |
|---------|---------|------------|
| Scheduling | Single Docker host | Kubernetes/Nomad multi-node |
| Storage | Ephemeral containers | Persistent volumes with snapshots |
| Networking | Docker bridge + port mapping | Overlay networks, mTLS |
| Log storage | PostgreSQL (10K line limit) | ELK/Loki dedicated aggregation |
| Health checks | Container running state | Custom HEALTHCHECK endpoints |

---

## Trade-offs

1. **Single-node architecture**: Chose simplicity over distributed complexity. All sandboxes run on one Docker host. Clean separation in `docker.ts` makes Kubernetes migration straightforward.

2. **Ephemeral storage**: No persistent volumes. Data lost on container restart. Acceptable for sandbox use case; would add volume mounts for stateful workloads.

3. **PostgreSQL for logs**: Quick to implement, queryable, but won't scale. Would move to dedicated log aggregation at ~1000 sandboxes.

4. **Port mapping over overlay networking**: Simpler setup, but each exposed port consumes a host port. Would use overlay networks for multi-tenant isolation at scale.

5. **Synchronous provisioning**: Container pull/start blocks the request. Would add job queue for async provisioning with webhook callbacks.

---

## Next 2 Things I'd Ship

1. **Distributed Scheduling**: Multi-node support via Kubernetes. The current `docker.ts` abstraction makes this clean—swap dockerode calls for K8s API. Would add node affinity, resource-aware placement, and auto-scaling based on queue depth.

2. **Persistent Volumes**: Container-native storage with copy-on-write snapshots. Enables stateful workloads (databases, ML training) and instant sandbox cloning with data intact.

---

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── db.ts             # PostgreSQL + migrations
│   │   ├── docker.ts         # Container orchestration
│   │   ├── websocket.ts      # Log streaming + terminal
│   │   ├── middleware/       # Auth, rate-limit, logging
│   │   ├── routes/           # API endpoints
│   │   └── services/         # Business logic
│   └── docker-compose.yml    # PostgreSQL + Prometheus + Grafana
├── frontend/
│   └── src/
│       ├── components/       # Terminal, Metrics, LogViewer
│       └── pages/            # Dashboard, SandboxDetail
├── sdk/                      # TypeScript client library
└── README.md
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Create account |
| POST | `/auth/login` | Get JWT token |
| POST | `/api-keys` | Create API key |
| DELETE | `/api-keys/:id` | Revoke API key |
| POST | `/environments` | Create environment |
| PUT | `/environments/:id` | Update (new version) |
| POST | `/environments/:id/secrets` | Set encrypted secret |
| POST | `/sandboxes` | Create sandbox |
| POST | `/sandboxes/:id/start` | Start |
| POST | `/sandboxes/:id/stop` | Stop |
| POST | `/sandboxes/:id/replicate` | Clone |
| DELETE | `/sandboxes/:id` | Destroy |
| GET | `/sandboxes/:id/metrics` | CPU/memory/network |
| WS | `/ws/sandboxes/:id/logs` | Live log stream |
| WS | `/ws/sandboxes/:id/terminal` | Interactive PTY |
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |

---

## Security Measures

- **Container isolation**: cgroups resource limits, dropped capabilities (`CAP_DROP: ALL`), `no-new-privileges`
- **No host mounts**: Containers can't access host filesystem
- **Secrets**: AES-256-GCM encryption, never logged, redacted in all outputs
- **Auth**: bcrypt (cost 12), JWT with expiry, API keys hashed before storage
- **Rate limiting**: 100 req/min general, 20 req/15min for auth endpoints
- **Tenant isolation**: All queries scoped to authenticated user_id
