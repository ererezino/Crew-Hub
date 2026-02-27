import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTE_LENGTH = 12;
const VERSION = "v1";

function ensureServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Sensitive crypto helpers are server-only.");
  }
}

function decodeBase64Key(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, "base64");

    if (decoded.length === 32) {
      return decoded;
    }

    return null;
  } catch {
    return null;
  }
}

function decodeHexKey(value: string): Buffer | null {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "hex");
  return decoded.length === 32 ? decoded : null;
}

function decodeUtf8Key(value: string): Buffer | null {
  const utf8 = Buffer.from(value, "utf8");
  return utf8.length === 32 ? utf8 : null;
}

function resolveEncryptionKey(): Buffer {
  ensureServerRuntime();

  const rawKey = process.env.PAYMENT_ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error("Missing PAYMENT_ENCRYPTION_KEY environment variable.");
  }

  const normalizedKey = rawKey.trim();

  const decodedKey =
    decodeHexKey(normalizedKey) ??
    decodeBase64Key(normalizedKey) ??
    decodeUtf8Key(normalizedKey);

  if (!decodedKey) {
    throw new Error(
      "PAYMENT_ENCRYPTION_KEY must be 32 bytes (hex/base64/utf8) for AES-256-GCM."
    );
  }

  return decodedKey;
}

export function encryptSensitiveValue(plaintextValue: string): string {
  ensureServerRuntime();

  const encryptionKey = resolveEncryptionKey();
  const initializationVector = randomBytes(IV_BYTE_LENGTH);

  const cipher = createCipheriv(ALGORITHM, encryptionKey, initializationVector);

  const encryptedBuffer = Buffer.concat([
    cipher.update(plaintextValue, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    initializationVector.toString("base64url"),
    authTag.toString("base64url"),
    encryptedBuffer.toString("base64url")
  ].join(".");
}

export function decryptSensitiveValue(encryptedPayload: string): string {
  ensureServerRuntime();

  const [version, ivBase64Url, authTagBase64Url, ciphertextBase64Url] =
    encryptedPayload.split(".");

  if (!version || !ivBase64Url || !authTagBase64Url || !ciphertextBase64Url) {
    throw new Error("Encrypted payload is malformed.");
  }

  if (version !== VERSION) {
    throw new Error(`Unsupported encrypted payload version: ${version}`);
  }

  const encryptionKey = resolveEncryptionKey();
  const initializationVector = Buffer.from(ivBase64Url, "base64url");
  const authTag = Buffer.from(authTagBase64Url, "base64url");
  const ciphertext = Buffer.from(ciphertextBase64Url, "base64url");

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, initializationVector);
  decipher.setAuthTag(authTag);

  const decryptedBuffer = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decryptedBuffer.toString("utf8");
}

export function encryptSensitiveJson(value: unknown): string {
  return encryptSensitiveValue(JSON.stringify(value));
}

export function decryptSensitiveJson<T>(encryptedPayload: string): T {
  const decryptedValue = decryptSensitiveValue(encryptedPayload);
  return JSON.parse(decryptedValue) as T;
}
