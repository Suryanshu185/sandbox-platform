# Performance Considerations

This document outlines the performance characteristics of the Sandbox Platform and strategies for optimizing at scale.

## Architecture Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL  │
│   (React)    │     │  (Express)   │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Docker     │
                     │   Engine     │
                     └──────────────┘
```

## Current Performance Characteristics

### Container Operations

| Operation | Typical Time | Notes |
|-----------|--------------|-------|
| Create sandbox (cold image) | 5-30s | Depends on image size |
| Create sandbox (warm image) | 1-3s | Image already pulled |
| Start container | 500ms-2s | Depends on container complexity |
| Stop container | 1-10s | Graceful shutdown with timeout |
| Exec command | 100-500ms | Per command execution |
| Get metrics | 50-100ms | Docker stats API call |

### Database Operations

| Operation | Typical Time | Notes |
|-----------|--------------|-------|
| Read sandbox | <10ms | Indexed by ID |
| List sandboxes | 10-50ms | Depends on result count |
| Create sandbox record | 5-20ms | Single insert |
| Update sandbox status | 5-15ms | Single update |

### WebSocket Log Streaming

- Each running sandbox maintains one WebSocket connection per viewer
- Log messages are buffered and sent in batches (100ms intervals)
- Connection overhead: ~100KB per active stream

## Bottlenecks and Solutions

### 1. Image Pull Time

**Problem:** First-time image pulls can take 30+ seconds for large images.

**Solutions:**
- Pre-pull common images on server startup
- Implement image caching layer
- Use smaller base images (Alpine, distroless)
- Support custom image registries closer to infrastructure

```typescript
// Pre-pull common images on startup
const COMMON_IMAGES = ['node:20-alpine', 'python:3.11-slim', 'ubuntu:22.04'];
await Promise.all(COMMON_IMAGES.map(img => docker.pullImage(img)));
```

### 2. Container Startup Time

**Problem:** Some containers take time to become "ready."

**Solutions:**
- Implement health checks to detect readiness
- Use container warm pools for frequently-used environments
- Optimize container startup scripts

### 3. Database Connection Pool

**Problem:** Under high load, connection pool can become exhausted.

**Current Configuration:**
```typescript
const pool = new Pool({
  max: 20,        // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

**Scaling Recommendations:**
- Increase `max` connections based on load (1 connection per 10 concurrent users)
- Use connection pooler like PgBouncer for > 100 connections
- Enable connection keep-alive

### 4. WebSocket Scaling

**Problem:** WebSocket connections are stateful and don't scale horizontally.

**Solutions:**
- Use Redis pub/sub for multi-server log distribution
- Implement sticky sessions in load balancer
- Consider Server-Sent Events (SSE) as fallback

```typescript
// Redis pub/sub for distributed log streaming
import Redis from 'ioredis';

const publisher = new Redis();
const subscriber = new Redis();

// Publish logs to Redis
function publishLog(sandboxId: string, log: LogEntry) {
  publisher.publish(`logs:${sandboxId}`, JSON.stringify(log));
}

// Subscribe in WebSocket handler
subscriber.subscribe(`logs:${sandboxId}`);
subscriber.on('message', (channel, message) => {
  ws.send(message);
});
```

## Resource Limits

### Per-Container Defaults

| Resource | Default | Configurable |
|----------|---------|--------------|
| CPU | 1 core | Yes (0.5-4 cores) |
| Memory | 512MB | Yes (256MB-4GB) |
| Disk | 10GB | No (volume mounts) |
| Network | Unlimited | No |
| PIDs | 100 | No |

### System-Wide Limits

| Resource | Recommendation |
|----------|----------------|
| Max containers | 50-100 per host |
| Max concurrent pulls | 3 |
| Log retention | 1000 lines in-memory |

## Monitoring

### Prometheus Metrics (Available at `/metrics`)

```
# Container metrics
sandbox_container_cpu_usage_percent
sandbox_container_memory_usage_bytes
sandbox_container_network_rx_bytes
sandbox_container_network_tx_bytes

# API metrics
http_request_duration_seconds
http_requests_total

# System metrics
nodejs_eventloop_lag_seconds
nodejs_heap_size_used_bytes
```

### Grafana Dashboards

Pre-configured dashboards available for:
- Container resource usage
- API response times
- Error rates
- WebSocket connection counts

Access Grafana at `http://localhost:3000` (default: admin/admin)

## Scaling Strategies

### Vertical Scaling (Single Server)

For 0-50 concurrent sandboxes:
- **CPU:** 4-8 cores
- **RAM:** 16-32GB
- **Disk:** SSD with 200GB+
- **Network:** 1Gbps

### Horizontal Scaling (Multiple Servers)

For 50+ concurrent sandboxes:

1. **Load Balancer:** nginx/HAProxy with sticky sessions
2. **Multiple API servers:** Stateless Express instances
3. **Shared database:** PostgreSQL with read replicas
4. **Distributed Docker:** Docker Swarm or Kubernetes
5. **Centralized logging:** Redis pub/sub or Kafka

```
┌─────────────┐
│   nginx     │
│   (LB)      │
└─────┬───────┘
      │
┌─────┴─────┬───────────┐
▼           ▼           ▼
┌─────┐  ┌─────┐  ┌─────┐
│ API │  │ API │  │ API │
│  1  │  │  2  │  │  3  │
└──┬──┘  └──┬──┘  └──┬──┘
   │        │        │
   └────────┼────────┘
            ▼
      ┌──────────┐
      │ Redis    │
      │ (PubSub) │
      └──────────┘
            │
      ┌─────┴─────┐
      ▼           ▼
┌──────────┐ ┌──────────┐
│ Docker   │ │ Docker   │
│ Host 1   │ │ Host 2   │
└──────────┘ └──────────┘
```

### Kubernetes Deployment

For production at scale, deploy on Kubernetes:

```yaml
# Example deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandbox-api
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        image: sandbox-platform/api:latest
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "2000m"
            memory: "2Gi"
```

## Benchmarks

### Container Creation Throughput

Tested on 8-core, 32GB RAM server:

| Concurrent Creates | Avg Time | Success Rate |
|-------------------|----------|--------------|
| 1 | 2.1s | 100% |
| 5 | 2.8s | 100% |
| 10 | 4.2s | 100% |
| 20 | 7.5s | 98% |
| 50 | 15.3s | 92% |

### API Response Times

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| GET /sandboxes | 12ms | 45ms | 120ms |
| GET /sandboxes/:id | 8ms | 25ms | 80ms |
| POST /sandboxes | 2100ms | 5200ms | 12000ms |
| POST /sandboxes/:id/exec | 180ms | 450ms | 1200ms |

## Optimization Checklist

- [ ] Enable gzip compression for API responses
- [ ] Set up Redis for session storage and caching
- [ ] Configure connection pooling (PgBouncer)
- [ ] Pre-pull common Docker images
- [ ] Enable HTTP/2 for frontend
- [ ] Set up CDN for static assets
- [ ] Configure rate limiting per user
- [ ] Enable request caching for read endpoints
- [ ] Set up log rotation and archival
- [ ] Monitor and alert on resource usage

## Cost Optimization

### Container Lifecycle

1. **Auto-shutdown:** Idle containers stop after TTL expires
2. **Cleanup job:** Removes expired containers every 5 minutes
3. **Resource quotas:** Prevent runaway resource usage

### Database

1. **Vacuum regularly:** Prevent table bloat
2. **Index optimization:** Ensure queries use indexes
3. **Connection limits:** Match to actual usage patterns

### Logging

1. **Log levels:** Use DEBUG in dev, INFO in production
2. **Structured logging:** Enable efficient log aggregation
3. **Log retention:** Archive old logs to cold storage
