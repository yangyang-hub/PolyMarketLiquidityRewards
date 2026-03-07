import WebSocket from "ws";
import Decimal from "decimal.js";
import type {
  AccountConfig,
  AccountState,
  ManagedMarket,
  OrderBook,
  StrategyConfig,
  StrategyOverride,
  WsMessage,
} from "../types";
import {
  dbGetAllAccountConfigs,
  dbGetAllAccountMetas,
  dbAddAccount,
  dbUpdateAccount,
  dbDeleteAccount,
  dbGetAccountConfig,
  dbUpdateMarketRewards,
} from "../db/database";
import { ClobWsFeed } from "../clob/ws-feed";
import { ClobExecutor } from "../clob/executor";
import { fetchMarketByConditionId, fetchMarketBySlug } from "../gamma/api";
import { store } from "../store/memory-store";
import { AccountEngine } from "./engine";
import { ethers } from "ethers";

const ACCOUNT_NAME_RE = /^[a-zA-Z0-9_\-]{1,64}$/;

class EngineManager {
  private engines: Map<string, AccountEngine> = new Map();
  private accountConfigs: AccountConfig[] = [];
  private wsFeed: ClobWsFeed;
  private wsClients: Set<WebSocket> = new Set();
  private rewardRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private balanceRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor() {
    this.wsFeed = new ClobWsFeed((tokenId, book) => {
      store.updateOrderBook(tokenId, book);
      this.broadcast({
        type: "orderbook_update",
        tokenId,
        bids: book.bids.map((b) => ({ price: b.price.toNumber(), size: b.size.toNumber() })),
        asks: book.asks.map((a) => ({ price: a.price.toNumber(), size: a.size.toNumber() })),
        timestamp: book.timestamp,
      });
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("[Manager] Initializing...");

    // Load accounts from DB
    this.accountConfigs = dbGetAllAccountConfigs();

    // Initialize account states
    for (const acc of this.accountConfigs) {
      const wallet = new ethers.Wallet(acc.privateKey);
      store.updateAccount(acc.name, {
        status: "idle",
        address: wallet.address,
      });

      // Create engine
      const engine = new AccountEngine(
        acc,
        (event) => this.broadcast({ type: "order_event", event }),
        (name, state) => this.broadcast({ type: "account_state", name, state }),
      );
      this.engines.set(acc.name, engine);

      // Fetch balance in background
      const executor = new ClobExecutor(acc);
      executor.initApiKeys().then(async () => {
        const balance = await executor.getCollateralBalance();
        console.log(`[Manager] ${acc.name} balance: $${balance}`);
        store.updateAccount(acc.name, { balance });
        this.broadcast({ type: "account_state", name: acc.name, state: store.accounts.get(acc.name)! });
      }).catch((e: any) => {
        console.error(`[Manager] Failed to fetch balance for ${acc.name}:`, e.message);
      });
    }

    // Start WS feed
    this.wsFeed.start();

    // Subscribe to existing managed markets' tokens
    const tokenIds: string[] = [];
    for (const m of store.managedMarkets) {
      for (const t of m.tokens) {
        tokenIds.push(t.token_id);
      }
    }
    if (tokenIds.length > 0) {
      this.wsFeed.subscribe(tokenIds);
      // Fetch initial orderbooks
      await this.fetchOrderbooks(tokenIds);
    }

    // Periodic reward refresh (every 30 minutes)
    this.rewardRefreshTimer = setInterval(
      () => this.refreshMarketRewards(),
      30 * 60 * 1000,
    );

    // Periodic balance refresh for all accounts (every 60 seconds)
    this.balanceRefreshTimer = setInterval(
      () => this.refreshAllBalances(),
      60 * 1000,
    );

    this.initialized = true;
    console.log(`[Manager] Initialized with ${this.accountConfigs.length} accounts, ${store.managedMarkets.length} markets`);
    this.broadcastSystemStatus();
  }

  // --- Account Management ---

  async addAccount(
    name: string,
    privateKey: string,
    signatureType: number,
    proxyWallet?: string,
  ): Promise<void> {
    if (!name.trim()) throw new Error("Account name is required");
    if (!ACCOUNT_NAME_RE.test(name.trim())) {
      throw new Error("Account name must be alphanumeric/underscore/dash, 1-64 chars");
    }
    if (this.engines.has(name)) throw new Error(`Account "${name}" already exists`);

    // Validate private key
    const wallet = new ethers.Wallet(privateKey);

    // Write to DB
    dbAddAccount(name, privateKey, signatureType, proxyWallet);

    // Update in-memory config
    const acc: AccountConfig = { name, privateKey, signatureType, proxyWallet };
    this.accountConfigs.push(acc);

    // Create engine
    const engine = new AccountEngine(
      acc,
      (event) => this.broadcast({ type: "order_event", event }),
      (n, state) => this.broadcast({ type: "account_state", name: n, state }),
    );
    this.engines.set(name, engine);

    // Update store
    store.updateAccount(name, { status: "idle", address: wallet.address });

    // Fetch balance in background (don't block account creation)
    const executor = new ClobExecutor(acc);
    executor.initApiKeys().then(async () => {
      const balance = await executor.getCollateralBalance();
      console.log(`[Manager] ${name} balance: $${balance}`);
      store.updateAccount(name, { balance });
      this.broadcast({ type: "account_state", name, state: store.accounts.get(name)! });
    }).catch((e: any) => {
      console.error(`[Manager] Failed to fetch balance for ${name}:`, e.message);
    });

    // Broadcast
    this.broadcast({ type: "account_state", name, state: store.accounts.get(name)! });
    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
    this.broadcastSystemStatus();
  }

  async updateAccountConfig(
    name: string,
    privateKey: string | null,
    signatureType: number,
    proxyWallet?: string,
  ): Promise<void> {
    const engine = this.engines.get(name);
    if (!engine) throw new Error(`Account "${name}" not found`);

    dbUpdateAccount(name, privateKey, signatureType, proxyWallet);

    const newConfig = dbGetAccountConfig(name);
    if (!newConfig) throw new Error(`Account "${name}" not found in DB after update`);

    if (engine.isRunning()) {
      await engine.stop();
    }

    const idx = this.accountConfigs.findIndex((a) => a.name === name);
    if (idx >= 0) this.accountConfigs[idx] = newConfig;

    const newEngine = new AccountEngine(
      newConfig,
      (event) => this.broadcast({ type: "order_event", event }),
      (n, state) => this.broadcast({ type: "account_state", name: n, state }),
    );
    this.engines.set(name, newEngine);

    const wallet = new ethers.Wallet(newConfig.privateKey);
    store.updateAccount(name, { status: "idle", address: wallet.address });

    this.broadcast({ type: "account_state", name, state: store.accounts.get(name)! });
    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
  }

  async removeAccount(name: string): Promise<void> {
    const engine = this.engines.get(name);
    if (!engine) throw new Error(`Account "${name}" not found`);

    dbDeleteAccount(name);

    if (engine.isRunning()) {
      await engine.stop();
    }

    this.engines.delete(name);
    this.accountConfigs = this.accountConfigs.filter((a) => a.name !== name);
    store.accounts.delete(name);

    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
    this.broadcastSystemStatus();
  }

  // --- Market Management ---

  async addMarket(input: string): Promise<ManagedMarket> {
    const isSlug = input.includes("-") && !/^0x[0-9a-fA-F]+$/.test(input);

    let marketInfo;
    if (isSlug) {
      marketInfo = await fetchMarketBySlug(input);
    } else {
      marketInfo = await fetchMarketByConditionId(input);
    }
    if (!marketInfo) throw new Error(`Market not found: ${input}`);

    // Check if already managed
    if (store.managedMarkets.some((m) => m.conditionId === marketInfo!.condition_id)) {
      throw new Error(`Market already managed: ${marketInfo.condition_id}`);
    }

    // Fetch CLOB rewards for this market
    let rewardsMaxSpread = 0;
    let rewardsMinSize = 0;
    let dailyRate = 0;

    const firstAcc = this.accountConfigs[0];
    if (firstAcc) {
      try {
        const executor = new ClobExecutor(firstAcc);
        await executor.initApiKeys();
        const rawRewards = await executor.getCurrentRewards();
        const match = rawRewards.find((r: any) => r.condition_id === marketInfo!.condition_id);
        if (match) {
          rewardsMaxSpread = match.rewards_max_spread || 0;
          rewardsMinSize = match.rewards_min_size || 0;
          dailyRate = (match.rewards_config || []).reduce(
            (sum: number, c: any) => sum + (c.rate_per_day || 0),
            0,
          );
        }
      } catch (e: any) {
        console.error("[Manager] Failed to get CLOB rewards for market:", e.message);
      }
    }

    const managed: ManagedMarket = {
      conditionId: marketInfo.condition_id,
      slug: marketInfo.slug,
      question: marketInfo.question,
      tokens: marketInfo.tokens,
      negRisk: marketInfo.neg_risk,
      active: marketInfo.active,
      rewardsMaxSpread,
      rewardsMinSize,
      dailyRate,
      liquidity: marketInfo.liquidity,
      addedAt: Math.floor(Date.now() / 1000),
    };

    store.addMarket(managed);

    // Subscribe to WS feed for token IDs
    const tokenIds = managed.tokens.map((t) => t.token_id);
    this.wsFeed.subscribe(tokenIds);
    await this.fetchOrderbooks(tokenIds);

    this.broadcast({ type: "market_added", market: managed });
    this.broadcastSystemStatus();

    return managed;
  }

  removeMarket(conditionId: string): void {
    const market = store.managedMarkets.find((m) => m.conditionId === conditionId);
    if (!market) throw new Error(`Market not found: ${conditionId}`);

    // Unsubscribe from WS feed and clean orderbook cache
    const tokenIds = market.tokens.map((t) => t.token_id);
    this.wsFeed.unsubscribe(tokenIds);
    for (const id of tokenIds) {
      store.orderbooks.delete(id);
    }

    store.removeMarket(conditionId);
    this.broadcast({ type: "market_removed", conditionId });
    this.broadcastSystemStatus();
  }

  // --- Override Management ---

  setAccountOverride(accountName: string, override: StrategyOverride): void {
    store.setAccountOverride(accountName, override);
    this.broadcast({
      type: "overrides_update",
      accountOverrides: store.accountOverrides,
      marketOverrides: store.marketOverrides,
    });
  }

  setMarketOverride(conditionId: string, override: StrategyOverride): void {
    store.setMarketOverride(conditionId, override);
    this.broadcast({
      type: "overrides_update",
      accountOverrides: store.accountOverrides,
      marketOverrides: store.marketOverrides,
    });
  }

  // --- Reward Refresh ---

  async refreshMarketRewards(): Promise<void> {
    const firstAcc = this.accountConfigs[0];
    if (!firstAcc || store.managedMarkets.length === 0) return;

    try {
      console.log("[Manager] Refreshing market rewards...");
      const executor = new ClobExecutor(firstAcc);
      await executor.initApiKeys();
      const rawRewards = await executor.getCurrentRewards();

      const rewardsMap = new Map<string, any>();
      for (const r of rawRewards) {
        rewardsMap.set(r.condition_id, r);
      }

      for (const market of store.managedMarkets) {
        const match = rewardsMap.get(market.conditionId);
        if (match) {
          const maxSpread = match.rewards_max_spread || 0;
          const minSize = match.rewards_min_size || 0;
          const rate = (match.rewards_config || []).reduce(
            (sum: number, c: any) => sum + (c.rate_per_day || 0),
            0,
          );
          dbUpdateMarketRewards(market.conditionId, maxSpread, minSize, rate, market.liquidity);
          market.rewardsMaxSpread = maxSpread;
          market.rewardsMinSize = minSize;
          market.dailyRate = rate;
        }
      }

      this.broadcast({ type: "managed_markets", markets: store.managedMarkets });
      console.log("[Manager] Market rewards refreshed");
    } catch (e: any) {
      console.error("[Manager] Reward refresh failed:", e.message);
    }
  }

  // --- Balance Refresh ---

  private async refreshAllBalances(): Promise<void> {
    for (const acc of this.accountConfigs) {
      try {
        const executor = new ClobExecutor(acc);
        await executor.initApiKeys();
        const balance = await executor.getCollateralBalance();
        const prev = store.accounts.get(acc.name);
        if (prev && prev.balance !== balance) {
          store.updateAccount(acc.name, { balance });
          this.broadcast({ type: "account_state", name: acc.name, state: store.accounts.get(acc.name)! });
        }
      } catch {
        // skip this account
      }
    }
  }

  // --- Engine Control ---

  async startAccount(name: string): Promise<boolean> {
    const engine = this.engines.get(name);
    if (!engine) return false;
    await engine.start();
    this.broadcastSystemStatus();
    return true;
  }

  async stopAccount(name: string): Promise<boolean> {
    const engine = this.engines.get(name);
    if (!engine) return false;
    await engine.stop();
    this.broadcastSystemStatus();
    return true;
  }

  async startAll(): Promise<void> {
    for (const [name] of this.engines) {
      await this.startAccount(name);
    }
  }

  async stopAll(): Promise<void> {
    for (const [name] of this.engines) {
      await this.stopAccount(name);
    }
  }

  getAccountStates(): AccountState[] {
    return store.getAccountStates();
  }

  getManagedMarkets(): ManagedMarket[] {
    return store.managedMarkets;
  }

  getConfig(): StrategyConfig {
    return store.config;
  }

  updateConfig(partial: Partial<StrategyConfig>): void {
    store.updateConfig(partial);
    this.broadcast({ type: "config_update", config: store.config });
  }

  // --- WebSocket client management ---

  addClient(ws: WebSocket): void {
    this.wsClients.add(ws);
    console.log(`[Manager] Browser connected (${this.wsClients.size} total)`);
    this.sendSnapshot(ws);
  }

  removeClient(ws: WebSocket): void {
    this.wsClients.delete(ws);
    console.log(`[Manager] Browser disconnected (${this.wsClients.size} total)`);
  }

  broadcast(message: WsMessage): void {
    const data = JSON.stringify(message, (_key, value) => {
      if (value instanceof Decimal) return value.toNumber();
      return value;
    });

    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private broadcastSystemStatus(): void {
    this.broadcast({
      type: "system_status",
      wsConnected: this.wsFeed.connected,
      totalAccounts: this.engines.size,
      totalMarkets: store.managedMarkets.length,
    });
  }

  private sendSnapshot(ws: WebSocket): void {
    const send = (msg: WsMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg, (_key, value) => {
          if (value instanceof Decimal) return value.toNumber();
          return value;
        }));
      }
    };

    // System status
    send({
      type: "system_status",
      wsConnected: this.wsFeed.connected,
      totalAccounts: this.engines.size,
      totalMarkets: store.managedMarkets.length,
    });

    // All account states
    for (const state of store.getAccountStates()) {
      send({ type: "account_state", name: state.name, state });
    }

    // Account configs (without private keys)
    send({ type: "account_configs", configs: dbGetAllAccountMetas() });

    // Managed markets
    send({ type: "managed_markets", markets: store.managedMarkets });

    // Overrides
    send({
      type: "overrides_update",
      accountOverrides: store.accountOverrides,
      marketOverrides: store.marketOverrides,
    });

    // Config
    send({ type: "config_update", config: store.config });

    // Recent orderbooks
    for (const [tokenId, book] of store.orderbooks) {
      send({
        type: "orderbook_update",
        tokenId,
        bids: book.bids.map((b) => ({ price: b.price.toNumber(), size: b.size.toNumber() })),
        asks: book.asks.map((a) => ({ price: a.price.toNumber(), size: a.size.toNumber() })),
        timestamp: book.timestamp,
      });
    }
  }

  private async fetchOrderbooks(tokenIds: string[]): Promise<void> {
    const firstAcc = this.accountConfigs[0];
    if (!firstAcc) return;

    try {
      // getOrderBook is a public API — no initApiKeys needed
      const executor = new ClobExecutor(firstAcc);
      for (const tokenId of tokenIds) {
        try {
          const raw = await executor.getOrderBook(tokenId);
          if (raw) {
            const book: OrderBook = {
              tokenId,
              bids: (raw.bids || []).map((b: any) => ({
                price: new Decimal(b.price),
                size: new Decimal(b.size),
              })),
              asks: (raw.asks || []).map((a: any) => ({
                price: new Decimal(a.price),
                size: new Decimal(a.size),
              })),
              timestamp: Date.now(),
            };
            book.bids.sort((a, b) => b.price.minus(a.price).toNumber());
            book.asks.sort((a, b) => a.price.minus(b.price).toNumber());
            store.updateOrderBook(tokenId, book);

            // Broadcast to connected browsers immediately
            this.broadcast({
              type: "orderbook_update",
              tokenId,
              bids: book.bids.map((b) => ({ price: b.price.toNumber(), size: b.size.toNumber() })),
              asks: book.asks.map((a) => ({ price: a.price.toNumber(), size: a.size.toNumber() })),
              timestamp: book.timestamp,
            });
            console.log(`[Manager] Fetched orderbook for ${tokenId.slice(0, 8)}... (${book.bids.length} bids, ${book.asks.length} asks)`);
          }
        } catch (e: any) {
          console.error(`[Manager] Failed to fetch orderbook for ${tokenId.slice(0, 8)}...:`, e.message);
        }
      }
    } catch (e: any) {
      console.error("[Manager] Failed to fetch orderbooks:", e.message);
    }
  }
}

// Singleton — shared via globalThis so Next.js API routes and custom server use the same instance
const g = globalThis as typeof globalThis & { __engineManager?: EngineManager };
export const engineManager = (g.__engineManager ??= new EngineManager());
