import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const traceId = (req.headers['x-trace-id'] as string) || uuidv4();

  // Add trace ID to response headers
  res.setHeader('x-trace-id', traceId);

  // Log request
  const requestLog = {
    traceId,
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    userId: req.auth?.userId,
  };

  logger.info(requestLog, 'Incoming request');

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const responseLog = {
      traceId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      userId: req.auth?.userId,
    };

    if (res.statusCode >= 500) {
      logger.error(responseLog, 'Request completed with error');
    } else if (res.statusCode >= 400) {
      logger.warn(responseLog, 'Request completed with client error');
    } else {
      logger.info(responseLog, 'Request completed');
    }
  });

  next();
}
