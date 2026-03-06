import crypto from "crypto";
import fs from "fs";
import path from "path";

const KEY_FILE = path.join(process.cwd(), "data", ".encryption-key");
const ALGORITHM = "aes-256-gcm";

let cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const dir = path.dirname(KEY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(KEY_FILE)) {
    cachedKey = Buffer.from(fs.readFileSync(KEY_FILE, "utf-8").trim(), "hex");
    if (cachedKey.length !== 32) {
      throw new Error(
        `Encryption key file is corrupted (expected 32 bytes, got ${cachedKey.length}). ` +
        `Delete ${KEY_FILE} to regenerate (will invalidate existing encrypted data).`,
      );
    }
  } else {
    cachedKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(KEY_FILE, cachedKey.toString("hex"), { mode: 0o600, flag: "wx" });
    } catch (e: any) {
      if (e.code === "EEXIST") {
        // Another process created the file between our existsSync and writeFileSync
        cachedKey = Buffer.from(fs.readFileSync(KEY_FILE, "utf-8").trim(), "hex");
      } else {
        throw e;
      }
    }
  }

  return cachedKey;
}

export function encryptPrivateKey(plaintext: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return { encrypted, iv: iv.toString("hex"), authTag };
}

export function decryptPrivateKey(
  encrypted: string,
  iv: string,
  authTag: string,
): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}
