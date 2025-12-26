import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { query, queryOne } from "../db.js";
import logger from "../logger.js";
import type { User, ApiKey, JwtPayload } from "../types.js";

const BCRYPT_ROUNDS = 12;
const JWT_SECRET =
  process.env.JWT_SECRET || "development-secret-change-in-production";
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || "24h";
const API_KEY_PREFIX = "sk_live_";

if (
  process.env.NODE_ENV === "production" &&
  JWT_SECRET === "development-secret-change-in-production"
) {
  throw new Error("JWT_SECRET must be set in production");
}

interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

interface DbApiKey {
  id: string;
  user_id: string;
  key_prefix: string;
  key_hash: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

class AuthService {
  // Create a new user
  async createUser(email: string, password: string): Promise<User> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const rows = await query<DbUser>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, password_hash, created_at, updated_at`,
      [email.toLowerCase(), passwordHash],
    );

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create user");
    }

    logger.info({ userId: row.id, email: row.email }, "User created");

    return this.mapUser(row);
  }

  // Authenticate user with email/password
  async authenticate(email: string, password: string): Promise<User | null> {
    const row = await queryOne<DbUser>(
      "SELECT id, email, password_hash, created_at, updated_at FROM users WHERE email = $1",
      [email.toLowerCase()],
    );

    if (!row) {
      // Constant-time comparison to prevent timing attacks
      await bcrypt.hash(password, BCRYPT_ROUNDS);
      return null;
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return null;
    }

    return this.mapUser(row);
  }

  // Get user by ID
  async getUserById(userId: string): Promise<User | null> {
    const row = await queryOne<DbUser>(
      "SELECT id, email, password_hash, created_at, updated_at FROM users WHERE id = $1",
      [userId],
    );

    return row ? this.mapUser(row) : null;
  }

  // Generate JWT token
  generateToken(user: User): string {
    const payload: Omit<JwtPayload, "iat" | "exp"> = {
      sub: user.id,
      email: user.email,
    };

    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });
  }

  // Verify JWT token
  verifyToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
      return null;
    }
  }

  // Create a new API key
  async createApiKey(
    userId: string,
    name: string,
  ): Promise<{ apiKey: ApiKey; rawKey: string }> {
    // Generate a secure random key
    const rawKey = API_KEY_PREFIX + randomBytes(24).toString("base64url");
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);
    const keyPrefix = rawKey.substring(0, 12); // Store prefix for identification

    const rows = await query<DbApiKey>(
      `INSERT INTO api_keys (user_id, key_prefix, key_hash, name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, key_prefix, key_hash, name, created_at, last_used_at, revoked_at`,
      [userId, keyPrefix, keyHash, name],
    );

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create API key");
    }

    logger.info({ userId, apiKeyId: row.id, keyPrefix }, "API key created");

    return {
      apiKey: this.mapApiKey(row),
      rawKey,
    };
  }

  // Validate API key and return user ID
  async validateApiKey(
    rawKey: string,
  ): Promise<{ userId: string; apiKeyId: string } | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const keyPrefix = rawKey.substring(0, 12);

    // Find API keys with matching prefix (not revoked)
    const rows = await query<DbApiKey>(
      "SELECT id, user_id, key_hash FROM api_keys WHERE key_prefix = $1 AND revoked_at IS NULL",
      [keyPrefix],
    );

    // Check each matching key
    for (const row of rows) {
      const valid = await bcrypt.compare(rawKey, row.key_hash);
      if (valid) {
        // Update last used timestamp
        await query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [
          row.id,
        ]);
        return { userId: row.user_id, apiKeyId: row.id };
      }
    }

    return null;
  }

  // List API keys for user
  async listApiKeys(userId: string): Promise<ApiKey[]> {
    const rows = await query<DbApiKey>(
      `SELECT id, user_id, key_prefix, key_hash, name, created_at, last_used_at, revoked_at
       FROM api_keys
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [userId],
    );

    return rows.map((row) => this.mapApiKey(row));
  }

  // Revoke an API key
  async revokeApiKey(userId: string, apiKeyId: string): Promise<boolean> {
    const result = await query(
      "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id",
      [apiKeyId, userId],
    );

    if (result.length > 0) {
      logger.info({ userId, apiKeyId }, "API key revoked");
      return true;
    }

    return false;
  }

  private mapUser(row: DbUser): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapApiKey(row: DbApiKey): ApiKey {
    return {
      id: row.id,
      userId: row.user_id,
      keyPrefix: row.key_prefix,
      keyHash: row.key_hash,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    };
  }
}

export const authService = new AuthService();
export default authService;
