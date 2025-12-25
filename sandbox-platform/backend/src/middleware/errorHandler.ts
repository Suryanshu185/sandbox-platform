import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import logger from '../logger.js';
import { NotFoundError, QuotaExceededError } from '../services/EnvironmentService.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
}

export function errorHandler(err: AppError, req: Request, res: Response, _next: NextFunction): void {
  const traceId = req.auth?.traceId || req.headers['x-trace-id'] || 'unknown';

  // Log the error
  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        code: err.code,
      },
      traceId,
      method: req.method,
      path: req.path,
      userId: req.auth?.userId,
    },
    'Request error'
  );

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: {
          errors: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
      },
    });
    return;
  }

  // Handle NotFoundError
  if (err instanceof NotFoundError) {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: err.message,
      },
    });
    return;
  }

  // Handle QuotaExceededError
  if (err instanceof QuotaExceededError) {
    res.status(429).json({
      success: false,
      error: {
        code: 'QUOTA_EXCEEDED',
        message: err.message,
      },
    });
    return;
  }

  // Handle duplicate key errors (PostgreSQL)
  if ((err as { code?: string }).code === '23505') {
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'Resource already exists',
      },
    });
    return;
  }

  // Handle specific error codes
  if (err.statusCode) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code || 'ERROR',
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Default to 500 Internal Server Error
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
  });
}

// 404 handler for unknown routes
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
