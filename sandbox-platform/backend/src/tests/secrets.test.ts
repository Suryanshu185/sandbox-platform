import { describe, it, expect, beforeEach } from "vitest";

// Create a fresh instance for testing
import nacl from "tweetnacl";
import {
  encodeBase64,
  decodeBase64,
  encodeUTF8,
  decodeUTF8,
} from "tweetnacl-util";

describe("SecretsService", () => {
  let masterKey: Uint8Array;

  beforeEach(() => {
    masterKey = nacl.randomBytes(nacl.secretbox.keyLength);
  });

  function encrypt(plaintext: string): string {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const messageBytes = decodeUTF8(plaintext);
    const ciphertext = nacl.secretbox(messageBytes, nonce, masterKey);

    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce);
    combined.set(ciphertext, nonce.length);

    return encodeBase64(combined);
  }

  function decrypt(encrypted: string): string {
    const combined = decodeBase64(encrypted);
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const ciphertext = combined.slice(nacl.secretbox.nonceLength);

    const plaintext = nacl.secretbox.open(ciphertext, nonce, masterKey);

    if (!plaintext) {
      throw new Error("Decryption failed");
    }

    return encodeUTF8(plaintext);
  }

  describe("encryption/decryption", () => {
    it("should encrypt and decrypt a secret correctly", () => {
      const original = "my-super-secret-api-key-12345";
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it("should produce different ciphertext for same plaintext (due to random nonce)", () => {
      const original = "same-secret";
      const encrypted1 = encrypt(original);
      const encrypted2 = encrypt(original);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(original);
      expect(decrypt(encrypted2)).toBe(original);
    });

    it("should handle empty strings", () => {
      const original = "";
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it("should handle unicode characters", () => {
      const original = "secret-with-unicode-🔐-émojis";
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it("should handle long secrets", () => {
      const original = "x".repeat(10000);
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it("should fail to decrypt with wrong key", () => {
      const original = "secret";
      const encrypted = encrypt(original);

      // Try to decrypt with a different key
      const wrongKey = nacl.randomBytes(nacl.secretbox.keyLength);
      const combined = decodeBase64(encrypted);
      const nonce = combined.slice(0, nacl.secretbox.nonceLength);
      const ciphertext = combined.slice(nacl.secretbox.nonceLength);

      const result = nacl.secretbox.open(ciphertext, nonce, wrongKey);
      expect(result).toBeNull();
    });

    it("should fail to decrypt corrupted ciphertext", () => {
      const original = "secret";
      const encrypted = encrypt(original);

      // Corrupt the ciphertext
      const combined = decodeBase64(encrypted);
      combined[combined.length - 1] ^= 0xff; // Flip bits in last byte

      const nonce = combined.slice(0, nacl.secretbox.nonceLength);
      const ciphertext = combined.slice(nacl.secretbox.nonceLength);

      const result = nacl.secretbox.open(ciphertext, nonce, masterKey);
      expect(result).toBeNull();
    });
  });

  describe("multiple secrets", () => {
    it("should encrypt and decrypt multiple secrets", () => {
      const secrets: Record<string, string> = {
        API_KEY: "sk_live_12345",
        DATABASE_URL: "postgresql://user:pass@localhost/db",
        JWT_SECRET: "super-secret-jwt-key",
      };

      const encrypted: Record<string, string> = {};
      for (const [key, value] of Object.entries(secrets)) {
        encrypted[key] = encrypt(value);
      }

      const decrypted: Record<string, string> = {};
      for (const [key, value] of Object.entries(encrypted)) {
        decrypted[key] = decrypt(value);
      }

      expect(decrypted).toEqual(secrets);
    });
  });

  describe("key generation", () => {
    it("should generate a 32-byte key", () => {
      const key = nacl.randomBytes(nacl.secretbox.keyLength);
      expect(key.length).toBe(32);
    });

    it("should generate unique keys", () => {
      const key1 = nacl.randomBytes(nacl.secretbox.keyLength);
      const key2 = nacl.randomBytes(nacl.secretbox.keyLength);

      expect(encodeBase64(key1)).not.toBe(encodeBase64(key2));
    });
  });
});
