import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { AccountConfig, StrategyConfig, ManagedMarket, StrategyOverride } from "../types";
import type { AccountMeta } from "../types";
import { encryptPrivateKey, decryptPrivateKey } from "./crypto";
import { defaultConfig } from "../config";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

const g = globalThis as typeof globalThis & { __appDb?: Database.Database };

function getDb(): Database.Database {
  if (g.__appDb) return g.__appDb;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      name TEXT PRIMARY KEY,
      encrypted_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      signature_type INTEGER NOT NULL DEFAULT 0,
      proxy_wallet TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS markets (
      condition_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      question TEXT NOT NULL,
      tokens_json TEXT NOT NULL,
      neg_risk INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      rewards_max_spread REAL NOT NULL DEFAULT 0,
      rewards_min_size REAL NOT NULL DEFAULT 0,
      daily_rate REAL NOT NULL DEFAULT 0,
      liquidity REAL NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS account_overrides (
      account_name TEXT PRIMARY KEY REFERENCES accounts(name) ON DELETE CASCADE,
      overrides_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS market_overrides (
      condition_id TEXT PRIMARY KEY REFERENCES markets(condition_id) ON DELETE CASCADE,
      overrides_json TEXT NOT NULL DEFAULT '{}'
    );

    DROP TABLE IF EXISTS enabled_markets;
  `);

  // Migration: add enabled column if missing (for existing databases)
  const cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "enabled")) {
    db.exec("ALTER TABLE accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0");
  }

  g.__appDb = db;
  return db;
}

// --- Accounts ---

export function dbAddAccount(
  name: string,
  privateKey: string,
  signatureType: number,
  proxyWallet?: string,
): void {
  const { encrypted, iv, authTag } = encryptPrivateKey(privateKey);
  const db = getDb();
  db.prepare(
    `INSERT INTO accounts (name, encrypted_key, iv, auth_tag, signature_type, proxy_wallet)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(name, encrypted, iv, authTag, signatureType, proxyWallet ?? null);
}

export function dbUpdateAccount(
  name: string,
  privateKey: string | null,
  signatureType: number,
  proxyWallet?: string,
): void {
  const db = getDb();
  let result;
  if (privateKey) {
    const { encrypted, iv, authTag } = encryptPrivateKey(privateKey);
    result = db.prepare(
      `UPDATE accounts SET encrypted_key = ?, iv = ?, auth_tag = ?, signature_type = ?, proxy_wallet = ?, updated_at = datetime('now')
       WHERE name = ?`,
    ).run(encrypted, iv, authTag, signatureType, proxyWallet ?? null, name);
  } else {
    result = db.prepare(
      `UPDATE accounts SET signature_type = ?, proxy_wallet = ?, updated_at = datetime('now')
       WHERE name = ?`,
    ).run(signatureType, proxyWallet ?? null, name);
  }
  if (result.changes === 0) {
    throw new Error(`Account "${name}" not found in database`);
  }
}

export function dbDeleteAccount(name: string): void {
  getDb().prepare("DELETE FROM accounts WHERE name = ?").run(name);
}

export function dbGetAllAccountConfigs(): AccountConfig[] {
  const rows = getDb()
    .prepare("SELECT * FROM accounts ORDER BY created_at")
    .all() as any[];
  return rows.map((row) => ({
    name: row.name,
    privateKey: decryptPrivateKey(row.encrypted_key, row.iv, row.auth_tag),
    signatureType: row.signature_type,
    proxyWallet: row.proxy_wallet ?? undefined,
  }));
}

export function dbGetAccountConfig(name: string): AccountConfig | undefined {
  const row = getDb()
    .prepare("SELECT * FROM accounts WHERE name = ?")
    .get(name) as any;
  if (!row) return undefined;
  return {
    name: row.name,
    privateKey: decryptPrivateKey(row.encrypted_key, row.iv, row.auth_tag),
    signatureType: row.signature_type,
    proxyWallet: row.proxy_wallet ?? undefined,
  };
}

export function dbGetAllAccountMetas(): AccountMeta[] {
  const rows = getDb()
    .prepare("SELECT name, signature_type, proxy_wallet FROM accounts ORDER BY created_at")
    .all() as any[];
  return rows.map((row) => ({
    name: row.name,
    signatureType: row.signature_type,
    proxyWallet: row.proxy_wallet ?? undefined,
  }));
}

export function dbSetAccountEnabled(name: string, enabled: boolean): void {
  getDb()
    .prepare("UPDATE accounts SET enabled = ? WHERE name = ?")
    .run(enabled ? 1 : 0, name);
}

export function dbGetEnabledAccountNames(): string[] {
  const rows = getDb()
    .prepare("SELECT name FROM accounts WHERE enabled = 1 ORDER BY created_at")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

// --- Strategy Config ---

export function dbLoadStrategyConfig(): StrategyConfig {
  const rows = getDb()
    .prepare("SELECT key, value FROM config")
    .all() as { key: string; value: string }[];

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const cfg = { ...defaultConfig };

  for (const key of Object.keys(cfg) as (keyof StrategyConfig)[]) {
    const raw = map.get(key);
    if (raw == null) continue;
    const type = typeof cfg[key];
    if (type === "number") {
      (cfg as any)[key] = Number(raw);
    } else if (type === "boolean") {
      (cfg as any)[key] = raw === "true";
    } else {
      (cfg as any)[key] = raw;
    }
  }
  return cfg;
}

export function dbSaveStrategyConfig(config: StrategyConfig): void {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction(() => {
    for (const [key, val] of Object.entries(config)) {
      upsert.run(key, String(val));
    }
  });
  tx();
}

// --- Managed Markets ---

export function dbAddMarket(market: ManagedMarket): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO markets (condition_id, slug, question, tokens_json, neg_risk, active, rewards_max_spread, rewards_min_size, daily_rate, liquidity, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      market.conditionId,
      market.slug,
      market.question,
      JSON.stringify(market.tokens),
      market.negRisk ? 1 : 0,
      market.active ? 1 : 0,
      market.rewardsMaxSpread,
      market.rewardsMinSize,
      market.dailyRate,
      market.liquidity,
      market.addedAt,
    );
}

export function dbRemoveMarket(conditionId: string): void {
  getDb().prepare("DELETE FROM markets WHERE condition_id = ?").run(conditionId);
}

export function dbGetAllMarkets(): ManagedMarket[] {
  const rows = getDb()
    .prepare("SELECT * FROM markets ORDER BY added_at DESC")
    .all() as any[];
  return rows.map((row) => ({
    conditionId: row.condition_id,
    slug: row.slug,
    question: row.question,
    tokens: JSON.parse(row.tokens_json),
    negRisk: row.neg_risk === 1,
    active: row.active === 1,
    rewardsMaxSpread: row.rewards_max_spread,
    rewardsMinSize: row.rewards_min_size,
    dailyRate: row.daily_rate,
    liquidity: row.liquidity,
    addedAt: row.added_at,
  }));
}

export function dbUpdateMarketRewards(
  conditionId: string,
  rewardsMaxSpread: number,
  rewardsMinSize: number,
  dailyRate: number,
  liquidity: number,
): void {
  getDb()
    .prepare(
      `UPDATE markets SET rewards_max_spread = ?, rewards_min_size = ?, daily_rate = ?, liquidity = ? WHERE condition_id = ?`,
    )
    .run(rewardsMaxSpread, rewardsMinSize, dailyRate, liquidity, conditionId);
}

// --- Account Overrides ---

export function dbSetAccountOverride(accountName: string, override: StrategyOverride): void {
  getDb()
    .prepare(
      `INSERT INTO account_overrides (account_name, overrides_json) VALUES (?, ?)
       ON CONFLICT(account_name) DO UPDATE SET overrides_json = excluded.overrides_json`,
    )
    .run(accountName, JSON.stringify(override));
}

export function dbGetAllAccountOverrides(): Record<string, StrategyOverride> {
  const rows = getDb()
    .prepare("SELECT account_name, overrides_json FROM account_overrides")
    .all() as { account_name: string; overrides_json: string }[];
  const result: Record<string, StrategyOverride> = {};
  for (const row of rows) {
    result[row.account_name] = JSON.parse(row.overrides_json);
  }
  return result;
}

// --- Market Overrides ---

export function dbSetMarketOverride(conditionId: string, override: StrategyOverride): void {
  getDb()
    .prepare(
      `INSERT INTO market_overrides (condition_id, overrides_json) VALUES (?, ?)
       ON CONFLICT(condition_id) DO UPDATE SET overrides_json = excluded.overrides_json`,
    )
    .run(conditionId, JSON.stringify(override));
}

export function dbGetAllMarketOverrides(): Record<string, StrategyOverride> {
  const rows = getDb()
    .prepare("SELECT condition_id, overrides_json FROM market_overrides")
    .all() as { condition_id: string; overrides_json: string }[];
  const result: Record<string, StrategyOverride> = {};
  for (const row of rows) {
    result[row.condition_id] = JSON.parse(row.overrides_json);
  }
  return result;
}
