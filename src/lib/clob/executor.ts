import Decimal from "decimal.js";
import { ClobClient } from "@polymarket/clob-client";
import type { OpenOrder, MarketReward, OrdersScoring } from "@polymarket/clob-client";
import type { AccountConfig } from "../types";
import { createClobClient } from "./client";
import { ethers } from "ethers";
import { getChainId } from "../config";

// --- Polygon Contract Addresses ---

const POLYGON_CONTRACTS = {
  collateral: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",  // USDC.e
  exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",    // CTF Exchange
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
};

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const ERC1155_ABI = [
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
];

const GNOSIS_SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes memory signatures) payable returns (bool)",
];

const MAX_UINT256 = ethers.constants.MaxUint256;

function getPolygonRpcUrl(): string {
  return process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
}

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
  private privateKey: string;
  public accountName: string;

  constructor(account: AccountConfig) {
    this.client = createClobClient(account);
    this.accountName = account.name;
    this.signatureType = account.signatureType;
    this.funderAddress = account.proxyWallet;
    this.privateKey = account.privateKey;
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

  async ensureAllowance(): Promise<void> {
    try {
      // Check on-chain state (USDC + Conditional Tokens) for diagnostics
      const onChainOk = await this.logOnChainState();

      // If on-chain approvals are missing, fix them first
      if (!onChainOk) {
        console.log(`[${this.accountName}] On-chain approvals missing, calling approveOnChain...`);
        await this.approveOnChain();
      }

      // Update BOTH collateral and conditional allowances on CLOB server
      for (const assetType of ["COLLATERAL", "CONDITIONAL"] as const) {
        try {
          await this.client.updateBalanceAllowance({
            asset_type: assetType as any,
          });
          console.log(`[${this.accountName}] updateBalanceAllowance(${assetType}): OK`);
        } catch (e: any) {
          console.log(`[${this.accountName}] updateBalanceAllowance(${assetType}) failed:`, e.message);
        }
      }

      // Check current CLOB API state
      const resp = await this.client.getBalanceAllowance({
        asset_type: "COLLATERAL" as any,
      });
      console.log(`[${this.accountName}] getBalanceAllowance(COLLATERAL):`, JSON.stringify(resp));

      const rawAllowance = parseFloat(resp?.allowance || "0");
      const rawBalance = parseFloat(resp?.balance || "0");

      if (rawAllowance === 0 && rawBalance > 0) {
        // Allowance still 0 after update — try waiting and retrying
        console.log(`[${this.accountName}] CLOB allowance still 0, retrying after 3s...`);
        await new Promise((r) => setTimeout(r, 3000));

        // Retry update
        try {
          await this.client.updateBalanceAllowance({ asset_type: "COLLATERAL" as any });
        } catch { /* ignore */ }
        try {
          await this.client.updateBalanceAllowance({ asset_type: "CONDITIONAL" as any });
        } catch { /* ignore */ }

        const resp2 = await this.client.getBalanceAllowance({
          asset_type: "COLLATERAL" as any,
        });
        console.log(`[${this.accountName}] getBalanceAllowance(COLLATERAL) retry:`, JSON.stringify(resp2));
      }
    } catch (e: any) {
      console.error(`[${this.accountName}] ensureAllowance failed:`, e.message);
    }
  }

  /** Send on-chain ERC20 approve transactions for USDC to all exchange contracts */
  async approveOnChain(): Promise<void> {
    const provider = new ethers.providers.JsonRpcProvider(getPolygonRpcUrl());
    const wallet = new ethers.Wallet(this.privateKey, provider);

    const exchangeAddresses = [
      POLYGON_CONTRACTS.exchange,
      POLYGON_CONTRACTS.negRiskExchange,
      POLYGON_CONTRACTS.negRiskAdapter,
    ];

    if (this.signatureType === 0) {
      // EOA: approve directly
      const usdc = new ethers.Contract(POLYGON_CONTRACTS.collateral, ERC20_ABI, wallet);
      for (const exchange of exchangeAddresses) {
        const current = await usdc.allowance(wallet.address, exchange);
        if (current.gt(0)) continue;
        console.log(`[${this.accountName}] EOA: approving USDC to ${exchange}...`);
        const tx = await usdc.approve(exchange, MAX_UINT256);
        await tx.wait();
        console.log(`[${this.accountName}] EOA: approved USDC to ${exchange}, tx=${tx.hash}`);
      }
    } else if (this.funderAddress) {
      // Proxy wallet (Gnosis Safe): execute approve through Safe
      const safe = new ethers.Contract(this.funderAddress, GNOSIS_SAFE_ABI, wallet);
      const usdcIface = new ethers.utils.Interface(ERC20_ABI);
      const ctIface = new ethers.utils.Interface(ERC1155_ABI);

      // Approve USDC to exchanges
      for (const exchange of exchangeAddresses) {
        const usdcContract = new ethers.Contract(POLYGON_CONTRACTS.collateral, ERC20_ABI, provider);
        const current = await usdcContract.allowance(this.funderAddress, exchange);
        if (current.gt(0)) {
          console.log(`[${this.accountName}] Safe: USDC already approved to ${exchange}`);
          continue;
        }
        const data = usdcIface.encodeFunctionData("approve", [exchange, MAX_UINT256]);
        await this.execSafeTransaction(safe, POLYGON_CONTRACTS.collateral, data, wallet);
        console.log(`[${this.accountName}] Safe: approved USDC to ${exchange}`);
      }

      // SetApprovalForAll for ConditionalTokens to exchanges
      for (const exchange of exchangeAddresses) {
        const ctContract = new ethers.Contract(POLYGON_CONTRACTS.conditionalTokens, ERC1155_ABI, provider);
        const approved = await ctContract.isApprovedForAll(this.funderAddress, exchange);
        if (approved) {
          console.log(`[${this.accountName}] Safe: CT already approved to ${exchange}`);
          continue;
        }
        const data = ctIface.encodeFunctionData("setApprovalForAll", [exchange, true]);
        await this.execSafeTransaction(safe, POLYGON_CONTRACTS.conditionalTokens, data, wallet);
        console.log(`[${this.accountName}] Safe: CT approved to ${exchange}`);
      }
    }

    // Notify CLOB server about the updated allowance
    try {
      await this.client.updateBalanceAllowance({ asset_type: "COLLATERAL" as any });
    } catch { /* ignore */ }
  }

  private async execSafeTransaction(
    safe: ethers.Contract,
    to: string,
    data: string,
    wallet: ethers.Wallet,
  ): Promise<void> {
    const nonce = await safe.nonce();
    const txHash = await safe.getTransactionHash(
      to,          // to
      0,           // value
      data,        // data
      0,           // operation (Call)
      0,           // safeTxGas
      0,           // baseGas
      0,           // gasPrice
      ethers.constants.AddressZero, // gasToken
      ethers.constants.AddressZero, // refundReceiver
      nonce,       // nonce
    );

    const sig = await wallet.signMessage(ethers.utils.arrayify(txHash));
    // Adjust v from 27/28 to 31/32 for eth_sign (Safe uses v+4 for eth_sign)
    const sigBytes = ethers.utils.arrayify(sig);
    sigBytes[sigBytes.length - 1] += 4;
    const adjustedSig = ethers.utils.hexlify(sigBytes);

    const tx = await safe.execTransaction(
      to, 0, data, 0, 0, 0, 0,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      adjustedSig,
    );
    await tx.wait();
    console.log(`[${this.accountName}] Safe tx confirmed: ${tx.hash}`);
  }

  /** Query on-chain USDC balance, ERC20 allowances, and ERC1155 approvals. Returns true if all OK. */
  private async logOnChainState(): Promise<boolean> {
    try {
      const provider = new ethers.providers.JsonRpcProvider(getPolygonRpcUrl());
      const owner = this.funderAddress || new ethers.Wallet(this.privateKey).address;
      const usdc = new ethers.Contract(POLYGON_CONTRACTS.collateral, [
        ...ERC20_ABI,
        "function balanceOf(address) view returns (uint256)",
      ], provider);
      const ct = new ethers.Contract(POLYGON_CONTRACTS.conditionalTokens, ERC1155_ABI, provider);

      const balance = await usdc.balanceOf(owner);
      const allowExchange = await usdc.allowance(owner, POLYGON_CONTRACTS.exchange);
      const allowNegRisk = await usdc.allowance(owner, POLYGON_CONTRACTS.negRiskExchange);
      const allowAdapter = await usdc.allowance(owner, POLYGON_CONTRACTS.negRiskAdapter);

      // Check ERC1155 (Conditional Tokens) approvals
      const ctExchange = await ct.isApprovedForAll(owner, POLYGON_CONTRACTS.exchange);
      const ctNegRisk = await ct.isApprovedForAll(owner, POLYGON_CONTRACTS.negRiskExchange);
      const ctAdapter = await ct.isApprovedForAll(owner, POLYGON_CONTRACTS.negRiskAdapter);

      console.log(`[${this.accountName}] ON-CHAIN (${owner}):`);
      console.log(`[${this.accountName}]   USDC balance: ${balance.toString()} ($${parseFloat(balance.toString()) / 1e6})`);
      console.log(`[${this.accountName}]   USDC→Exchange: ${allowExchange.gt(0) ? "OK" : "NONE"}`);
      console.log(`[${this.accountName}]   USDC→NegRiskExchange: ${allowNegRisk.gt(0) ? "OK" : "NONE"}`);
      console.log(`[${this.accountName}]   USDC→NegRiskAdapter: ${allowAdapter.gt(0) ? "OK" : "NONE"}`);
      console.log(`[${this.accountName}]   CT→Exchange: ${ctExchange ? "OK" : "NONE"}`);
      console.log(`[${this.accountName}]   CT→NegRiskExchange: ${ctNegRisk ? "OK" : "NONE"}`);
      console.log(`[${this.accountName}]   CT→NegRiskAdapter: ${ctAdapter ? "OK" : "NONE"}`);

      const allOk = allowExchange.gt(0) && allowNegRisk.gt(0) && allowAdapter.gt(0)
        && ctExchange && ctNegRisk && ctAdapter;
      if (!allOk) {
        console.log(`[${this.accountName}] ON-CHAIN: some approvals missing!`);
      }
      return allOk;
    } catch (e: any) {
      console.error(`[${this.accountName}] logOnChainState failed:`, e.message);
      return true; // Assume OK on RPC failure to avoid blocking
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
      console.log(`[${this.accountName}] balance=$${balance}, allowance=$${allowance}`);
      return balance;
    } catch (e: any) {
      console.error(`[${this.accountName}] getBalance failed:`, e.message);
      return 0;
    }
  }

  getClient(): ClobClient {
    return this.client;
  }
}
