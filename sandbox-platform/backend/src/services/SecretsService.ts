import nacl from "tweetnacl";
import {
  encodeBase64,
  decodeBase64,
  encodeUTF8,
  decodeUTF8,
} from "tweetnacl-util";
import logger from "../logger.js";

// Master key should be 32 bytes (256 bits) for secretbox
const MASTER_KEY_ENV = "SECRETS_MASTER_KEY";

class SecretsService {
  private masterKey: Uint8Array | null = null;

  constructor() {
    this.initMasterKey();
  }

  private initMasterKey(): void {
    const keyBase64 = process.env[MASTER_KEY_ENV];

    if (!keyBase64) {
      // Generate a new key for development
      if (process.env.NODE_ENV !== "production") {
        this.masterKey = nacl.randomBytes(nacl.secretbox.keyLength);
        logger.warn(
          { generatedKey: encodeBase64(this.masterKey) },
          "No SECRETS_MASTER_KEY set, generated temporary key. Set this in production!",
        );
      } else {
        throw new Error("SECRETS_MASTER_KEY must be set in production");
      }
    } else {
      try {
        this.masterKey = decodeBase64(keyBase64);
        if (this.masterKey.length !== nacl.secretbox.keyLength) {
          throw new Error(
            `Master key must be ${nacl.secretbox.keyLength} bytes`,
          );
        }
      } catch (err) {
        throw new Error(
          "Invalid SECRETS_MASTER_KEY format. Must be base64 encoded 32 bytes.",
        );
      }
    }
  }

  // Generate a new master key (for setup)
  static generateMasterKey(): string {
    const key = nacl.randomBytes(nacl.secretbox.keyLength);
    return encodeBase64(key);
  }

  // Encrypt a secret value
  encrypt(plaintext: string): string {
    if (!this.masterKey) {
      throw new Error("Secrets service not initialized");
    }

    // Generate a random nonce
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const messageBytes = decodeUTF8(plaintext);

    // Encrypt using secretbox (XSalsa20-Poly1305)
    const ciphertext = nacl.secretbox(messageBytes, nonce, this.masterKey);

    // Combine nonce + ciphertext for storage
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce);
    combined.set(ciphertext, nonce.length);

    return encodeBase64(combined);
  }

  // Decrypt a secret value
  decrypt(encrypted: string): string {
    if (!this.masterKey) {
      throw new Error("Secrets service not initialized");
    }

    try {
      const combined = decodeBase64(encrypted);

      // Extract nonce and ciphertext
      const nonce = combined.slice(0, nacl.secretbox.nonceLength);
      const ciphertext = combined.slice(nacl.secretbox.nonceLength);

      // Decrypt
      const plaintext = nacl.secretbox.open(ciphertext, nonce, this.masterKey);

      if (!plaintext) {
        throw new Error("Decryption failed - invalid ciphertext or key");
      }

      return encodeUTF8(plaintext);
    } catch (err) {
      logger.error({ err }, "Failed to decrypt secret");
      throw new Error("Failed to decrypt secret");
    }
  }

  // Encrypt multiple secrets
  encryptSecrets(secrets: Record<string, string>): Record<string, string> {
    const encrypted: Record<string, string> = {};
    for (const [key, value] of Object.entries(secrets)) {
      encrypted[key] = this.encrypt(value);
    }
    return encrypted;
  }

  // Decrypt multiple secrets
  decryptSecrets(encrypted: Record<string, string>): Record<string, string> {
    const decrypted: Record<string, string> = {};
    for (const [key, value] of Object.entries(encrypted)) {
      decrypted[key] = this.decrypt(value);
    }
    return decrypted;
  }

  // Check if a value is already encrypted (starts with valid base64)
  isEncrypted(value: string): boolean {
    try {
      const decoded = decodeBase64(value);
      // Minimum length: nonce (24) + tag (16) + at least 1 byte
      return decoded.length > nacl.secretbox.nonceLength + 16;
    } catch {
      return false;
    }
  }
}

export const secretsService = new SecretsService();
export default secretsService;
