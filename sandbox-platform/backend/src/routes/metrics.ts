import { Router, Request, Response, NextFunction } from 'express';
import client from 'prom-client';
import { query } from '../db.js';

const router = Router();

// Create a registry
const register = new client.Registry();

// Add default metrics (process, event loop, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const sandboxesRunning = new client.Gauge({
  name: 'sandboxes_running',
  help: 'Number of currently running sandboxes',
  registers: [register],
});

const sandboxesTotal = new client.Gauge({
  name: 'sandboxes_total',
  help: 'Total number of sandboxes',
  registers: [register],
});

const environmentsTotal = new client.Gauge({
  name: 'environments_total',
  help: 'Total number of environments',
  registers: [register],
});

const usersTotal = new client.Gauge({
  name: 'users_total',
  help: 'Total number of users',
  registers: [register],
});

// Middleware to track HTTP metrics
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const path = normalizePath(req.path);

    httpRequestDuration.observe(
      { method: req.method, path, status: res.statusCode.toString() },
      duration
    );

    httpRequestsTotal.inc(
      { method: req.method, path, status: res.statusCode.toString() }
    );
  });

  next();
}

// Normalize path for metrics (avoid high cardinality)
function normalizePath(path: string): string {
  // Replace UUIDs and IDs with placeholder
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id');
}

// Update gauge metrics periodically
async function updateGaugeMetrics(): Promise<void> {
  try {
    const [sandboxRunningResult, sandboxTotalResult, envResult, userResult] = await Promise.all([
      query<{ count: string }>("SELECT COUNT(*) as count FROM sandboxes WHERE status = 'running'"),
      query<{ count: string }>('SELECT COUNT(*) as count FROM sandboxes'),
      query<{ count: string }>('SELECT COUNT(*) as count FROM environments'),
      query<{ count: string }>('SELECT COUNT(*) as count FROM users'),
    ]);

    sandboxesRunning.set(parseInt(sandboxRunningResult[0]?.count ?? '0', 10));
    sandboxesTotal.set(parseInt(sandboxTotalResult[0]?.count ?? '0', 10));
    environmentsTotal.set(parseInt(envResult[0]?.count ?? '0', 10));
    usersTotal.set(parseInt(userResult[0]?.count ?? '0', 10));
  } catch {
    // Ignore errors in metrics collection
  }
}

// Update metrics every 15 seconds
setInterval(updateGaugeMetrics, 15000);

// GET /metrics - Prometheus metrics endpoint
router.get('/', async (_req: Request, res: Response) => {
  // Update metrics before scraping
  await updateGaugeMetrics();

  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

export { register, httpRequestDuration, httpRequestsTotal, sandboxesRunning, environmentsTotal };
export default router;
