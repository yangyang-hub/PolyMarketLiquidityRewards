import crypto from "crypto";
import fs from "fs";
import path from "path";

function getDataDir(): string {
  return process.env.APP_DATA_DIR || path.join(process.cwd(), "data");
}

const KEY_FILE = path.join(getDataDir(), ".encryption-key");
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
        `加密密钥文件已损坏（需要 32 字节，实际 ${cachedKey.length} 字节）。` +
        `删除 ${KEY_FILE} 后可重新生成，但会导致现有加密数据失效。`,
      );
    }
  } else {
    cachedKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(KEY_FILE, cachedKey.toString("hex"), { mode: 0o600, flag: "wx" });
    } catch (e: unknown) {
      if (hasErrorCode(e, "EEXIST")) {
        // Another process created the file between our existsSync and writeFileSync
        cachedKey = Buffer.from(fs.readFileSync(KEY_FILE, "utf-8").trim(), "hex");
      } else {
        throw e;
      }
    }
  }

  return cachedKey;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
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
