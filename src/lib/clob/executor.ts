import Decimal from "decimal.js";
import { ClobClient } from "@polymarket/clob-client";
import type { OpenOrder, MarketReward, OrdersScoring } from "@polymarket/clob-client";
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
  let s = sStep === 0 ? minS : Math.ceil(minS / sStep) * sStep;

  if (s > 5000) return new Decimal(0);

  return new Decimal(s).dividedBy(100);
}

// --- Executor ---

export class ClobExecutor {
  private client: ClobClient;
  private signatureType: number;
  private funderAddress?: string;
  public accountName: string;

  constructor(account: AccountConfig) {
    this.client = createClobClient(account);
    this.accountName = account.name;
    this.signatureType = account.signatureType;
    this.funderAddress = account.proxyWallet;
    console.log(`[${this.accountName}] ClobExecutor created: signatureType=${this.signatureType}, funderAddress=${this.funderAddress || 'none'}`);
  }

  private rebuildClient(creds: any): void {
    this.client = new ClobClient(
      this.client.host,
      this.client.chainId,
      this.client.signer,
      creds,
      this.signatureType,
      this.funderAddress,
    );
  }

  async initApiKeys(): Promise<void> {
    try {
      const resp = await this.client.getApiKeys();
      if (!resp?.apiKeys || resp.apiKeys.length === 0) {
        const creds = await this.client.createApiKey();
        console.log(`[${this.accountName}] API key created`);
        this.rebuildClient(creds);
      } else {
        const creds = await this.client.deriveApiKey();
        console.log(`[${this.accountName}] API key derived (${resp.apiKeys.length} keys exist)`);
        this.rebuildClient(creds);
      }
    } catch (e: any) {
      console.warn(`[${this.accountName}] initApiKeys primary path failed: ${e.message}, trying createOrDerive...`);
      const creds = await this.client.createOrDeriveApiKey();
      console.log(`[${this.accountName}] API key createOrDerive succeeded`);
      this.rebuildClient(creds);
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
        side: "BUY" as any,
        size: size.toNumber(),
        expiration: 0,
      }, undefined, undefined, undefined, true);
      return resp?.orderID || resp?.id || null;
    } catch (e: any) {
      console.error(`[${this.accountName}] BUY failed:`, e.message);
      return null;
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
        side: "SELL" as any,
        size: size.toNumber(),
        expiration: 0,
      }, undefined, undefined, undefined, true);
      return resp?.orderID || resp?.id || null;
    } catch (e: any) {
      console.error(`[${this.accountName}] SELL failed:`, e.message);
      return null;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.cancelOrder({ orderID: orderId });
      return true;
    } catch (e: any) {
      console.error(`[${this.accountName}] cancel ${orderId} failed:`, e.message);
      return false;
    }
  }

  async cancelAll(): Promise<void> {
    try {
      await this.client.cancelAll();
    } catch (e: any) {
      console.error(`[${this.accountName}] cancelAll failed:`, e.message);
    }
  }

  async getOpenOrders(assetId?: string): Promise<OpenOrder[]> {
    try {
      const params = assetId ? { asset_id: assetId } : undefined;
      return (await this.client.getOpenOrders(params)) || [];
    } catch (e: any) {
      console.error(`[${this.accountName}] getOpenOrders failed:`, e.message);
      return [];
    }
  }

  async getOrderBook(tokenId: string): Promise<any> {
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
    } catch (e: any) {
      console.error(`[${this.accountName}] areOrdersScoring failed:`, e.message);
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
        asset_type: "COLLATERAL" as any,
      });
      const rawBalance = parseFloat(resp?.balance || "0");
      const rawAllowance = parseFloat(resp?.allowance || "0");
      const balance = rawBalance / 1e6;
      const allowance = rawAllowance / 1e6;
      const effective = Math.min(balance, allowance);
      console.log(`[${this.accountName}] balance=$${balance}, allowance=$${allowance}, effective=$${effective}`);
      return effective;
    } catch (e: any) {
      console.error(`[${this.accountName}] getBalance failed:`, e.message);
      return 0;
    }
  }

  getClient(): ClobClient {
    return this.client;
  }
}
