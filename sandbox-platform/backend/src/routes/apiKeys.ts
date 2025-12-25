import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/AuthService.js';
import { auditService } from '../services/AuditService.js';
import { authenticate } from '../middleware/auth.js';
import { CreateApiKeySchema } from '../types.js';

const router = Router();

// POST /api-keys - Create a new API key
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateApiKeySchema.parse(req.body);

    const { apiKey, rawKey } = await authService.createApiKey(req.auth!.userId, data.name);

    await auditService.logApiKeyCreated(req.auth!.userId, apiKey.id, apiKey.keyPrefix);

    res.status(201).json({
      success: true,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        key: rawKey, // Only returned once, on creation
        createdAt: apiKey.createdAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api-keys - List API keys
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKeys = await authService.listApiKeys(req.auth!.userId);

    res.json({
      success: true,
      data: apiKeys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api-keys/:id - Revoke an API key
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const revoked = await authService.revokeApiKey(req.auth!.userId, id!);

    if (!revoked) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
      return;
    }

    await auditService.logApiKeyRevoked(req.auth!.userId, id!);

    res.json({
      success: true,
      data: { message: 'API key revoked' },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
