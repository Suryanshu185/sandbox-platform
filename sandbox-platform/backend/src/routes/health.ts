import { Router, Request, Response } from 'express';
import { healthCheck as dbHealthCheck } from '../db.js';
import { healthCheck as dockerHealthCheck } from '../docker.js';

const router = Router();

// GET /health - Health check endpoint
router.get('/', async (_req: Request, res: Response) => {
  const dbOk = await dbHealthCheck();
  const dockerOk = await dockerHealthCheck();

  const allOk = dbOk && dockerOk;

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    docker: dockerOk ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
  });
});

// GET /health/ready - Readiness check
router.get('/ready', async (_req: Request, res: Response) => {
  const dbOk = await dbHealthCheck();
  const dockerOk = await dockerHealthCheck();

  if (dbOk && dockerOk) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({
      ready: false,
      checks: {
        db: dbOk,
        docker: dockerOk,
      },
    });
  }
});

// GET /health/live - Liveness check
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ alive: true });
});

export default router;
