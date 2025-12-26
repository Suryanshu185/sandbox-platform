import { Router, Request, Response, NextFunction } from "express";
import { authService } from "../services/AuthService.js";
import { auditService } from "../services/AuditService.js";
import { authenticate } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { SignupSchema, LoginSchema, CreateApiKeySchema } from "../types.js";

const router = Router();

// POST /auth/signup - Create a new user
router.post(
  "/signup",
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = SignupSchema.parse(req.body);

      const user = await authService.createUser(data.email, data.password);
      const token = authService.generateToken(user);

      await auditService.logUserCreated(user.id, user.email);

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            createdAt: user.createdAt.toISOString(),
          },
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/login - Authenticate user
router.post(
  "/login",
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = LoginSchema.parse(req.body);

      const user = await authService.authenticate(data.email, data.password);

      if (!user) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid email or password" },
        });
        return;
      }

      const token = authService.generateToken(user);

      await auditService.logUserLogin(
        user.id,
        req.ip ?? undefined,
        req.headers["user-agent"],
      );

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            createdAt: user.createdAt.toISOString(),
          },
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /auth/me - Get current user
router.get(
  "/me",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.getUserById(req.auth!.userId);

      if (!user) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "User not found" },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
