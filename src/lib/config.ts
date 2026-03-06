import type { StrategyConfig } from "./types";

// --- Default Strategy Config ---

export const defaultConfig: StrategyConfig = {
  orderDepthLevel: 3,
  cancelDepthLevel: 2,
  minOrderSize: 5,
  maxPositionPerMarket: 100,
  maxTotalExposure: 500,
  spreadFraction: 0.8,
  minDailyRate: 1,
  maxMarkets: 10,
  quoteRefreshSecs: 60,
  quoteYes: true,
  quoteNo: true,
};

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

// --- CLOB Config ---

export function getClobHost(): string {
  return process.env.CLOB_HOST || "https://clob.polymarket.com";
}

export function getClobWsHost(): string {
  return process.env.CLOB_WS_HOST || "wss://ws-subscriptions-clob.polymarket.com";
}

export function getChainId(): number {
  return envInt("CHAIN_ID", 137);
}

export function getGammaHost(): string {
  return process.env.GAMMA_HOST || "https://gamma-api.polymarket.com";
}

export function getPort(): number {
  return envInt("PORT", 3000);
}
