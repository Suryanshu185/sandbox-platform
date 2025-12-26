import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { authService } from "../services/AuthService.js";
import type { AuthContext } from "../types.js";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// JWT or API Key authentication middleware
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const traceId = (req.headers["x-trace-id"] as string) || uuidv4();
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authorization header required" },
    });
    return;
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid authorization format. Use: Bearer <token>",
      },
    });
    return;
  }

  // Check if it's an API key (starts with sk_)
  if (token.startsWith("sk_")) {
    const result = await authService.validateApiKey(token);
    if (!result) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid API key" },
      });
      return;
    }

    req.auth = {
      userId: result.userId,
      apiKeyId: result.apiKeyId,
      traceId,
    };
  } else {
    // JWT token
    const payload = authService.verifyToken(token);
    if (!payload) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
      });
      return;
    }

    req.auth = {
      userId: payload.sub,
      email: payload.email,
      traceId,
    };
  }

  next();
}

// Optional authentication (for routes that work with or without auth)
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const traceId = (req.headers["x-trace-id"] as string) || uuidv4();
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    req.auth = { userId: "", traceId };
    next();
    return;
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme === "Bearer" && token) {
    if (token.startsWith("sk_")) {
      const result = await authService.validateApiKey(token);
      if (result) {
        req.auth = {
          userId: result.userId,
          apiKeyId: result.apiKeyId,
          traceId,
        };
      }
    } else {
      const payload = authService.verifyToken(token);
      if (payload) {
        req.auth = {
          userId: payload.sub,
          email: payload.email,
          traceId,
        };
      }
    }
  }

  if (!req.auth) {
    req.auth = { userId: "", traceId };
  }

  next();
}
