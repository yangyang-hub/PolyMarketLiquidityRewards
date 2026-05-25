import Decimal from "decimal.js";
import { AssetType, ClobClient, OrderType, Side } from "@polymarket/clob-client-v2";
import type { ApiKeyCreds, OpenOrder, MarketReward, OrdersScoring } from "@polymarket/clob-client-v2";
import type { AccountConfig } from "../types";
import { createClobClient } from "./client";

// --- GCD ---

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

// --- Cost Precision ---

function costPrecisionStep(price: Decimal): [number, number, number] {
  const scale = price.decimalPlaces();
  const denom = Math.pow(10, scale);
  const numer = price.times(denom).round().toNumber();
  if (numer === 0) return [1, 0, denom];
  const g = gcd(numer, denom);
  const sStep = denom / g;
  return [sStep, numer, denom];
}

export function adjustSizeForCostPrecision(price: Decimal, size: Decimal): Decimal {
  const cost = price.times(size);
  if (cost.equals(cost.toDecimalPlaces(2, Decimal.ROUND_DOWN))) {
    return size;
  }

  const [sStep, numer] = costPrecisionStep(price);
  if (numer === 0) return size;

  const sVal = size.times(100).floor().toNumber();
  if (sStep === 0 || sVal < sStep) return new Decimal(0);

  const sRounded = Math.floor(sVal / sStep) * sStep;
  return new Decimal(sRounded).dividedBy(100);
}

export function minCostAdjustedSize(price: Decimal): Decimal {
  if (price.isZero()) return new Decimal(0);
  const [sStep] = costPrecisionStep(price);

  const minS = new Decimal(100).dividedBy(price).ceil().toNumber();
  const s = sStep === 0 ? minS : Math.ceil(minS / sStep) * sStep;

  if (s > 5000) return new Decimal(0);

  return new Decimal(s).dividedBy(100);
}

// --- Executor ---

export class ClobExecutor {
  private client: ClobClient;
  private account: AccountConfig;
  private signatureType: number;
  private funderAddress?: string;
  public accountName: string;

  constructor(account: AccountConfig) {
    this.account = account;
    this.client = createClobClient(account);
    this.accountName = account.name;
    this.signatureType = account.signatureType;
    this.funderAddress = account.proxyWallet;
    console.log(`[${this.accountName}] ClobExecutor created: signatureType=${this.signatureType}, funderAddress=${this.funderAddress || 'none'}`);
  }

  private rebuildClient(creds: ApiKeyCreds): void {
    this.client = createClobClient(this.account, creds);
  }

  async initApiKeys(): Promise<void> {
    let createError: unknown;

    try {
      const creds = await this.client.createApiKey();
      console.log(`[${this.accountName}] API key created`);
      this.rebuildClient(creds);
      return;
    } catch (e: unknown) {
      createError = e;
      console.warn(`[${this.accountName}] createApiKey failed: ${errorMessage(e)}, trying deriveApiKey...`);
    }

    try {
      const creds = await this.client.deriveApiKey();
      console.log(`[${this.accountName}] API key derived`);
      this.rebuildClient(creds);
    } catch (deriveError: unknown) {
      throw clobApiKeyInitError(createError, deriveError);
    }
  }

  async buyLimitPostOnly(tokenId: string, price: Decimal, rawSize: Decimal): Promise<string | null> {
    let size = rawSize.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    size = adjustSizeForCostPrecision(price, size);

    if (size.isZero()) {
      const bumped = minCostAdjustedSize(price);
      const bumpedCost = price.times(bumped);
      if (bumpedCost.greaterThan(rawSize.times(price).times(5))) {
        console.log(`[${this.accountName}] buy: bump too expensive, skipping`);
        return null;
      }
      size = bumped;
    }

    const cost = price.times(size);
    if (cost.lessThan(1)) {
      console.log(`[${this.accountName}] buy: cost $${cost} < $1.00, skipping`);
      return null;
    }

    console.log(`[${this.accountName}] BUY ${size} @ ${price} (cost=$${cost.toDecimalPlaces(2)})`);
    try {
      const resp = await this.client.createAndPostOrder({
        tokenID: tokenId,
        price: price.toNumber(),
        side: Side.BUY,
        size: size.toNumber(),
        expiration: 0,
      }, undefined, OrderType.GTC, true);
      return resp?.orderID || resp?.id || null;
    } catch (e: unknown) {
      console.error(`[${this.accountName}] BUY failed:`, errorMessage(e));
      throw e;
    }
  }

  async sellLimitPostOnly(tokenId: string, price: Decimal, rawSize: Decimal): Promise<string | null> {
    let size = rawSize.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    size = adjustSizeForCostPrecision(price, size);

    if (size.isZero()) {
      const bumped = minCostAdjustedSize(price);
      const bumpedCost = price.times(bumped);
      if (bumpedCost.greaterThan(rawSize.times(price).times(5))) {
        console.log(`[${this.accountName}] sell: bump too expensive, skipping`);
        return null;
      }
      size = bumped;
    }

    const cost = price.times(size);
    if (cost.lessThan(1)) {
      console.log(`[${this.accountName}] sell: cost $${cost} < $1.00, skipping`);
      return null;
    }

    console.log(`[${this.accountName}] SELL ${size} @ ${price} (cost=$${cost.toDecimalPlaces(2)})`);
    try {
      const resp = await this.client.createAndPostOrder({
        tokenID: tokenId,
        price: price.toNumber(),
        side: Side.SELL,
        size: size.toNumber(),
        expiration: 0,
      }, undefined, OrderType.GTC, true);
      return resp?.orderID || resp?.id || null;
    } catch (e: unknown) {
      console.error(`[${this.accountName}] SELL failed:`, errorMessage(e));
      throw e;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.cancelOrder({ orderID: orderId });
      return true;
    } catch (e: unknown) {
      console.error(`[${this.accountName}] cancel ${orderId} failed:`, errorMessage(e));
      return false;
    }
  }

  async cancelAll(): Promise<boolean> {
    try {
      await this.client.cancelAll();
      return true;
    } catch (e: unknown) {
      console.error(`[${this.accountName}] cancelAll failed:`, errorMessage(e));
      return false;
    }
  }

  async getOpenOrders(assetId?: string): Promise<OpenOrder[]> {
    try {
      const params = assetId ? { asset_id: assetId } : undefined;
      return (await this.client.getOpenOrders(params)) || [];
    } catch (e: unknown) {
      console.error(`[${this.accountName}] getOpenOrders failed:`, errorMessage(e));
      throw e;
    }
  }

  async getOrderBook(tokenId: string): Promise<unknown> {
    try {
      return await this.client.getOrderBook(tokenId);
    } catch {
      return null;
    }
  }

  async areOrdersScoring(orderIds: string[]): Promise<OrdersScoring> {
    if (orderIds.length === 0) return {};
    try {
      return (await this.client.areOrdersScoring({ orderIds })) || {};
    } catch (e: unknown) {
      console.error(`[${this.accountName}] areOrdersScoring failed:`, errorMessage(e));
      return {};
    }
  }

  async getCurrentRewards(): Promise<MarketReward[]> {
    try {
      return (await this.client.getCurrentRewards()) || [];
    } catch {
      return [];
    }
  }

  async getCollateralBalance(): Promise<number> {
    try {
      const resp = await this.client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      const rawBalance = parseFloat(resp?.balance || "0");
      const balance = rawBalance / 1e6;
      console.log(`[${this.accountName}] balance=$${balance}`);
      return balance;
    } catch (e: unknown) {
      console.error(`[${this.accountName}] getBalance failed:`, errorMessage(e));
      throw e;
    }
  }

  /** Ask CLOB server to refresh its cached allowance for this wallet */
  async refreshAllowanceCache(): Promise<void> {
    try {
      await this.client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      console.log(`[${this.accountName}] Allowance cache refreshed`);
    } catch (e: unknown) {
      console.warn(`[${this.accountName}] refreshAllowanceCache failed:`, errorMessage(e));
    }
  }

  getClient(): ClobClient {
    return this.client;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isNetworkErrorMessage(message: string): boolean {
  return /\b(ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN)\b|timeout|network|socket hang up/i.test(message);
}

function clobApiKeyInitError(createError: unknown, deriveError: unknown): Error {
  const createMessage = errorMessage(createError);
  const deriveMessage = errorMessage(deriveError);
  const baseMessage = `无法创建或派生 CLOB API Key。create=${createMessage}; derive=${deriveMessage}`;

  if (!isNetworkErrorMessage(`${createMessage}; ${deriveMessage}`)) {
    return new Error(baseMessage);
  }

  return new Error(
    `${baseMessage}。这通常表示当前运行环境无法连接 Polymarket CLOB REST（https://clob.polymarket.com），不是钱包格式错误。请检查 VPN/代理/DNS；桌面版会尝试继承系统 HTTP/HTTPS 代理，也可以手动设置 HTTPS_PROXY/HTTP_PROXY 后重启应用。`,
  );
}
