import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcrypt";

// Mock the database
vi.mock("../db.js", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

import { authService } from "../services/AuthService.js";
import { query, queryOne } from "../db.js";

describe("AuthService", () => {
  const mockUser = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    email: "test@example.com",
    password_hash:
      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.I7xKGdAFrMkWHW", // "password123"
    created_at: new Date(),
    updated_at: new Date(),
  };

  describe("createUser", () => {
    it("should create a new user with hashed password", async () => {
      const mockQueryFn = query as ReturnType<typeof vi.fn>;
      mockQueryFn.mockResolvedValueOnce([mockUser]);

      const result = await authService.createUser(
        "test@example.com",
        "password123",
      );

      expect(result.email).toBe("test@example.com");
      expect(result.id).toBe(mockUser.id);
      expect(mockQueryFn).toHaveBeenCalled();

      // Verify password was hashed (not stored as plaintext)
      const callArgs = mockQueryFn.mock.calls[0];
      expect(callArgs?.[1]?.[1]).not.toBe("password123");
    });
  });

  describe("authenticate", () => {
    it("should return user for valid credentials", async () => {
      const mockQueryOneFn = queryOne as ReturnType<typeof vi.fn>;

      // Create a valid hash for testing
      const validHash = await bcrypt.hash("password123", 12);
      mockQueryOneFn.mockResolvedValueOnce({
        ...mockUser,
        password_hash: validHash,
      });

      const result = await authService.authenticate(
        "test@example.com",
        "password123",
      );

      expect(result).not.toBeNull();
      expect(result?.email).toBe("test@example.com");
    });

    it("should return null for invalid password", async () => {
      const mockQueryOneFn = queryOne as ReturnType<typeof vi.fn>;

      const validHash = await bcrypt.hash("password123", 12);
      mockQueryOneFn.mockResolvedValueOnce({
        ...mockUser,
        password_hash: validHash,
      });

      const result = await authService.authenticate(
        "test@example.com",
        "wrongpassword",
      );

      expect(result).toBeNull();
    });

    it("should return null for non-existent user", async () => {
      const mockQueryOneFn = queryOne as ReturnType<typeof vi.fn>;
      mockQueryOneFn.mockResolvedValueOnce(null);

      const result = await authService.authenticate(
        "nonexistent@example.com",
        "password123",
      );

      expect(result).toBeNull();
    });
  });

  describe("generateToken / verifyToken", () => {
    it("should generate and verify JWT token", () => {
      const user = {
        id: mockUser.id,
        email: mockUser.email,
        passwordHash: mockUser.password_hash,
        createdAt: mockUser.created_at,
        updatedAt: mockUser.updated_at,
      };

      const token = authService.generateToken(user);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      const payload = authService.verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(user.id);
      expect(payload?.email).toBe(user.email);
    });

    it("should return null for invalid token", () => {
      const result = authService.verifyToken("invalid-token");
      expect(result).toBeNull();
    });
  });

  describe("API Keys", () => {
    it("should create API key with hashed value", async () => {
      const mockQueryFn = query as ReturnType<typeof vi.fn>;
      const mockApiKey = {
        id: "456e4567-e89b-12d3-a456-426614174000",
        user_id: mockUser.id,
        key_prefix: "sk_live_abc",
        key_hash: "hashed_value",
        name: "Test Key",
        created_at: new Date(),
        last_used_at: null,
        revoked_at: null,
      };
      mockQueryFn.mockResolvedValueOnce([mockApiKey]);

      const result = await authService.createApiKey(mockUser.id, "Test Key");

      expect(result.apiKey.id).toBe(mockApiKey.id);
      expect(result.rawKey).toContain("sk_live_");
      expect(result.rawKey.length).toBeGreaterThan(20);
    });

    it("should validate API key correctly", async () => {
      const mockQueryFn = query as ReturnType<typeof vi.fn>;

      // First, create a key to get a valid hash
      const rawKey = "sk_live_testkey123456789012345678";
      const keyHash = await bcrypt.hash(rawKey, 12);

      mockQueryFn.mockResolvedValueOnce([
        {
          id: "456e4567-e89b-12d3-a456-426614174000",
          user_id: mockUser.id,
          key_hash: keyHash,
        },
      ]);
      mockQueryFn.mockResolvedValueOnce([]); // Update last_used_at

      const result = await authService.validateApiKey(rawKey);

      expect(result).not.toBeNull();
      expect(result?.userId).toBe(mockUser.id);
    });

    it("should reject invalid API key", async () => {
      const mockQueryFn = query as ReturnType<typeof vi.fn>;
      mockQueryFn.mockResolvedValueOnce([]);

      const result = await authService.validateApiKey("sk_live_invalid");

      expect(result).toBeNull();
    });
  });
});
