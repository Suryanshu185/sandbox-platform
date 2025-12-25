import { Router, Request, Response, NextFunction } from 'express';
import { environmentService } from '../services/EnvironmentService.js';
import { auditService } from '../services/AuditService.js';
import { authenticate } from '../middleware/auth.js';
import { CreateEnvironmentSchema, UpdateEnvironmentSchema, CreateSecretSchema } from '../types.js';

const router = Router();

// POST /environments - Create a new environment
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateEnvironmentSchema.parse(req.body);

    const { environment, version } = await environmentService.createEnvironment(req.auth!.userId, data);

    await auditService.logEnvironmentCreated(req.auth!.userId, environment.id, {
      name: data.name,
      image: data.image,
    });

    res.status(201).json({
      success: true,
      data: {
        id: environment.id,
        name: environment.name,
        currentVersionId: version.id,
        version: {
          id: version.id,
          version: version.version,
          image: version.image,
          cpu: version.cpu,
          memory: version.memory,
          ports: version.ports,
          env: version.env,
          secrets: [],
          mounts: version.mounts,
          createdAt: version.createdAt.toISOString(),
        },
        createdAt: environment.createdAt.toISOString(),
        updatedAt: environment.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /environments - List environments
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environments = await environmentService.listEnvironments(req.auth!.userId);

    res.json({
      success: true,
      data: environments,
    });
  } catch (err) {
    next(err);
  }
});

// GET /environments/:id - Get environment by ID
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const environment = await environmentService.getEnvironment(req.auth!.userId, id!);

    if (!environment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Environment not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: environment,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /environments/:id - Update environment (creates new version)
router.put('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = UpdateEnvironmentSchema.parse(req.body);

    const { environment, version } = await environmentService.updateEnvironment(req.auth!.userId, id!, data);

    await auditService.logEnvironmentUpdated(req.auth!.userId, environment.id, {
      newVersion: version.version,
    });

    res.json({
      success: true,
      data: {
        id: environment.id,
        name: environment.name,
        currentVersionId: version.id,
        version: {
          id: version.id,
          version: version.version,
          image: version.image,
          cpu: version.cpu,
          memory: version.memory,
          ports: version.ports,
          env: version.env,
          secrets: Object.keys(version.secrets).map((key) => ({ key, redacted: true as const })),
          mounts: version.mounts,
          createdAt: version.createdAt.toISOString(),
        },
        createdAt: environment.createdAt.toISOString(),
        updatedAt: environment.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /environments/:id - Delete environment
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const deleted = await environmentService.deleteEnvironment(req.auth!.userId, id!);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Environment not found' },
      });
      return;
    }

    await auditService.logEnvironmentDeleted(req.auth!.userId, id!);

    res.json({
      success: true,
      data: { message: 'Environment deleted' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /environments/:id/secrets - Set a secret
router.post('/:id/secrets', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = CreateSecretSchema.parse(req.body);

    const result = await environmentService.setSecret(req.auth!.userId, id!, data.key, data.value);

    await auditService.logSecretSet(req.auth!.userId, id!, data.key);

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /environments/:id/secrets/:key - Delete a secret
router.delete('/:id/secrets/:key', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params;

    const deleted = await environmentService.deleteSecret(req.auth!.userId, id!, key!);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Secret not found' },
      });
      return;
    }

    res.json({
      success: true,
      data: { message: 'Secret deleted' },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
