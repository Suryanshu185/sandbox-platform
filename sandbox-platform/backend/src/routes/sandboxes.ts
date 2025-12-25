import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sandboxService } from '../services/SandboxService.js';
import { auditService } from '../services/AuditService.js';
import { authenticate } from '../middleware/auth.js';
import { sandboxCreateLimiter } from '../middleware/rateLimit.js';
import { CreateSandboxSchema, ReplicateSandboxSchema, SandboxStatus } from '../types.js';
import * as docker from '../docker.js';

const ExecSchema = z.object({
  command: z.array(z.string()).min(1),
});

const router = Router();

// POST /sandboxes - Create a new sandbox
router.post('/', authenticate, sandboxCreateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateSandboxSchema.parse(req.body);

    const sandbox = await sandboxService.createSandbox(req.auth!.userId, data);

    await auditService.logSandboxCreated(req.auth!.userId, sandbox.id, {
      environmentId: data.environmentId,
      name: sandbox.name,
    });

    res.status(201).json({
      success: true,
      data: sandbox,
    });
  } catch (err) {
    next(err);
  }
});

// GET /sandboxes - List sandboxes
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, environmentId } = req.query;

    const filters: { status?: SandboxStatus; environmentId?: string } = {};
    if (status && typeof status === 'string') {
      filters.status = status as SandboxStatus;
    }
    if (environmentId && typeof environmentId === 'string') {
      filters.environmentId = environmentId;
    }

    const sandboxes = await sandboxService.listSandboxes(req.auth!.userId, filters);

    res.json({
      success: true,
      data: sandboxes,
    });
  } catch (err) {
    next(err);
  }
});

// GET /sandboxes/:id - Get sandbox by ID
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const sandbox = await sandboxService.getSandbox(req.auth!.userId, id!);

    if (!sandbox) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Sandbox not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: sandbox,
    });
  } catch (err) {
    next(err);
  }
});

// POST /sandboxes/:id/start - Start a sandbox
router.post('/:id/start', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const sandbox = await sandboxService.startSandbox(req.auth!.userId, id!);

    await auditService.logSandboxStarted(req.auth!.userId, id!);

    res.json({
      success: true,
      data: sandbox,
    });
  } catch (err) {
    next(err);
  }
});

// POST /sandboxes/:id/stop - Stop a sandbox
router.post('/:id/stop', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const sandbox = await sandboxService.stopSandbox(req.auth!.userId, id!);

    await auditService.logSandboxStopped(req.auth!.userId, id!);

    res.json({
      success: true,
      data: sandbox,
    });
  } catch (err) {
    next(err);
  }
});

// POST /sandboxes/:id/restart - Restart a sandbox
router.post('/:id/restart', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const sandbox = await sandboxService.restartSandbox(req.auth!.userId, id!);

    await auditService.logSandboxRestarted(req.auth!.userId, id!);

    res.json({
      success: true,
      data: sandbox,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /sandboxes/:id - Destroy a sandbox
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const destroyed = await sandboxService.destroySandbox(req.auth!.userId, id!);

    if (!destroyed) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Sandbox not found' },
      });
      return;
    }

    await auditService.logSandboxDestroyed(req.auth!.userId, id!);

    res.json({
      success: true,
      data: { message: 'Sandbox destroyed' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /sandboxes/:id/replicate - Clone a sandbox
router.post('/:id/replicate', authenticate, sandboxCreateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = req.body ? ReplicateSandboxSchema.parse(req.body) : undefined;

    const newSandbox = await sandboxService.replicateSandbox(req.auth!.userId, id!, data);

    await auditService.logSandboxReplicated(req.auth!.userId, id!, newSandbox.id);

    res.status(201).json({
      success: true,
      data: newSandbox,
    });
  } catch (err) {
    next(err);
  }
});

// GET /sandboxes/:id/logs - Get sandbox logs (polling fallback)
router.get('/:id/logs', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const tail = parseInt(req.query.tail as string, 10) || 100;

    const logs = await sandboxService.getLogs(req.auth!.userId, id!, Math.min(tail, 1000));

    res.json({
      success: true,
      data: logs,
    });
  } catch (err) {
    next(err);
  }
});

// GET /sandboxes/:id/metrics - Get sandbox resource metrics (CPU, RAM, Network, IO)
router.get('/:id/metrics', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Get sandbox to verify ownership and get container ID
    const sandbox = await sandboxService.getSandbox(req.auth!.userId, id!);

    if (!sandbox) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Sandbox not found' },
      });
      return;
    }

    // Sandbox must be running to get metrics
    if (sandbox.status !== 'running') {
      res.status(400).json({
        success: false,
        error: { code: 'NOT_RUNNING', message: 'Sandbox is not running' },
      });
      return;
    }

    // Get container ID from sandbox service
    const containerId = await sandboxService.getContainerId(req.auth!.userId, id!);
    if (!containerId) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_CONTAINER', message: 'No container associated with sandbox' },
      });
      return;
    }

    const metrics = await docker.getContainerStats(containerId);

    if (!metrics) {
      res.status(500).json({
        success: false,
        error: { code: 'METRICS_UNAVAILABLE', message: 'Could not retrieve metrics' },
      });
      return;
    }

    res.json({
      success: true,
      data: metrics,
    });
  } catch (err) {
    next(err);
  }
});

// POST /sandboxes/:id/exec - Execute command in sandbox (SSH-like access)
router.post('/:id/exec', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { command } = ExecSchema.parse(req.body);

    // Get sandbox to verify ownership and get container ID
    const sandbox = await sandboxService.getSandbox(req.auth!.userId, id!);

    if (!sandbox) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Sandbox not found' },
      });
      return;
    }

    // Sandbox must be running to exec
    if (sandbox.status !== 'running') {
      res.status(400).json({
        success: false,
        error: { code: 'NOT_RUNNING', message: 'Sandbox is not running' },
      });
      return;
    }

    const containerId = await sandboxService.getContainerId(req.auth!.userId, id!);
    if (!containerId) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_CONTAINER', message: 'No container associated with sandbox' },
      });
      return;
    }

    const result = await docker.execInContainer(containerId, command);

    await auditService.logSandboxExec(req.auth!.userId, id!, command);

    res.json({
      success: true,
      data: {
        exitCode: result.exitCode,
        output: result.output,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
