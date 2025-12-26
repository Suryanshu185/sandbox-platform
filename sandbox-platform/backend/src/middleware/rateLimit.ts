import rateLimit from "express-rate-limit";
import { Request, Response } from "express";

// Standard rate limiter for authenticated endpoints
export const standardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per user
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise IP
    return req.auth?.userId || req.ip || "unknown";
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait before trying again.",
        retryAfter: 60,
      },
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for auth endpoints (prevent brute force)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 minutes
  keyGenerator: (req: Request) => {
    return req.ip || "unknown";
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many authentication attempts. Please try again later.",
        retryAfter: 900,
      },
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for sandbox creation (resource intensive)
export const sandboxCreateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 sandbox creates per minute
  keyGenerator: (req: Request) => {
    return req.auth?.userId || req.ip || "unknown";
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many sandbox creation requests. Please wait.",
        retryAfter: 60,
      },
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});
