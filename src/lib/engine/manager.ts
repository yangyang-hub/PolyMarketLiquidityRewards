import WebSocket from "ws";
import Decimal from "decimal.js";
import type {
  AccountConfig,
  AccountState,
  ClobRewardData,
  OrderBook,
  RewardMarketCandidate,
  StrategyConfig,
  WsMessage,
} from "../types";
import {
  dbGetAllAccountConfigs,
  dbGetAllAccountMetas,
  dbAddAccount,
  dbUpdateAccount,
  dbDeleteAccount,
  dbGetAccountConfig,
} from "../db/database";
import { ClobWsFeed } from "../clob/ws-feed";
import { ClobExecutor } from "../clob/executor";
import { fetchAllActiveMarkets } from "../gamma/api";
import { selectRewardMarkets } from "../strategy/market-selector";
import { store } from "../store/memory-store";
import { AccountEngine } from "./engine";
import { ethers } from "ethers";

const ACCOUNT_NAME_RE = /^[a-zA-Z0-9_\-]{1,64}$/;

class EngineManager {
  private engines: Map<string, AccountEngine> = new Map();
  private accountConfigs: AccountConfig[] = [];
  private wsFeed: ClobWsFeed;
  private wsClients: Set<WebSocket> = new Set();
  private marketRefreshTimer: ReturnType<typeof setInterval> | null = null;
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
    }

    // Start WS feed
    this.wsFeed.start();

    // Initial market refresh
    await this.refreshMarkets();

    // Periodic market refresh (every 30 minutes)
    this.marketRefreshTimer = setInterval(
      () => this.refreshMarkets(),
      30 * 60 * 1000,
    );

    this.initialized = true;
    console.log(`[Manager] Initialized with ${this.accountConfigs.length} accounts`);
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

    // Update DB first (throws on missing row or disk error — before we touch the engine)
    dbUpdateAccount(name, privateKey, signatureType, proxyWallet);

    // Reload config from DB
    const newConfig = dbGetAccountConfig(name);
    if (!newConfig) throw new Error(`Account "${name}" not found in DB after update`);

    // Stop engine only after DB write succeeded
    if (engine.isRunning()) {
      await engine.stop();
    }

    // Update in-memory configs
    const idx = this.accountConfigs.findIndex((a) => a.name === name);
    if (idx >= 0) this.accountConfigs[idx] = newConfig;

    // Recreate engine with new config
    const newEngine = new AccountEngine(
      newConfig,
      (event) => this.broadcast({ type: "order_event", event }),
      (n, state) => this.broadcast({ type: "account_state", name: n, state }),
    );
    this.engines.set(name, newEngine);

    // Update store address
    const wallet = new ethers.Wallet(newConfig.privateKey);
    store.updateAccount(name, { status: "idle", address: wallet.address });

    // Broadcast
    this.broadcast({ type: "account_state", name, state: store.accounts.get(name)! });
    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
  }

  async removeAccount(name: string): Promise<void> {
    const engine = this.engines.get(name);
    if (!engine) throw new Error(`Account "${name}" not found`);

    // Delete from DB first (throws on disk error — before we touch in-memory state)
    dbDeleteAccount(name);

    // Stop engine after DB delete succeeded
    if (engine.isRunning()) {
      await engine.stop();
    }

    // Remove from in-memory
    this.engines.delete(name);
    this.accountConfigs = this.accountConfigs.filter((a) => a.name !== name);
    store.accounts.delete(name);

    // Broadcast
    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
    this.broadcastSystemStatus();
  }

  async refreshMarkets(): Promise<void> {
    try {
      console.log("[Manager] Refreshing reward markets...");

      // Get CLOB rewards from one executor (any account)
      let clobRewards: ClobRewardData[] = [];

      // Fetch from first available account or create temp executor
      const firstAcc = this.accountConfigs[0];
      if (firstAcc) {
        const executor = new ClobExecutor(firstAcc);
        try {
          await executor.initApiKeys();
          const rawRewards = await executor.getCurrentRewards();
          clobRewards = rawRewards.map((r: any) => ({
            conditionId: r.condition_id,
            rewardsMaxSpread: new Decimal(r.rewards_max_spread || 0),
            rewardsMinSize: new Decimal(r.rewards_min_size || 0),
            totalDailyRate: new Decimal(
              (r.rewards_config || []).reduce(
                (sum: number, c: any) => sum + (c.rate_per_day || 0),
                0,
              ),
            ),
          }));
        } catch (e: any) {
          console.error("[Manager] Failed to get CLOB rewards:", e.message);
        }
      }

      // Fetch Gamma markets
      const gammaMarkets = await fetchAllActiveMarkets();

      // Select best markets
      const candidates = selectRewardMarkets(gammaMarkets, clobRewards, store.config);
      store.rewardMarkets = candidates;

      // Subscribe to orderbooks for selected market tokens
      const tokenIds: string[] = [];
      for (const c of candidates) {
        for (const t of c.market.tokens) {
          tokenIds.push(t.token_id);
        }
      }
      this.wsFeed.subscribe(tokenIds);

      // Also fetch initial orderbooks via REST
      if (firstAcc) {
        const executor = new ClobExecutor(firstAcc);
        try {
          await executor.initApiKeys();
          for (const tokenId of tokenIds) {
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
            }
          }
        } catch (e: any) {
          console.error("[Manager] Failed to fetch orderbooks:", e.message);
        }
      }

      console.log(`[Manager] Selected ${candidates.length} reward markets`);
      this.broadcast({
        type: "reward_markets",
        markets: candidates as any,
        enabledIds: Array.from(store.enabledMarketIds),
      });
    } catch (e: any) {
      console.error("[Manager] Market refresh failed:", e.message);
    }
  }

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

  getRewardMarkets(): RewardMarketCandidate[] {
    return store.rewardMarkets;
  }

  toggleMarket(conditionId: string): boolean {
    const enabled = !store.isMarketEnabled(conditionId);
    if (enabled) {
      store.enableMarket(conditionId);

      // Subscribe to WS for this market's tokens
      const candidate = store.rewardMarkets.find(
        (c) => c.market.condition_id === conditionId,
      );
      if (candidate) {
        const tokenIds = candidate.market.tokens.map((t) => t.token_id);
        this.wsFeed.subscribe(tokenIds);
      }
    } else {
      store.disableMarket(conditionId);
    }

    this.broadcast({ type: "market_toggle", conditionId, enabled });
    return enabled;
  }

  getEnabledMarketIds(): string[] {
    return Array.from(store.enabledMarketIds);
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

    // Send current state snapshot
    this.sendSnapshot(ws);
  }

  removeClient(ws: WebSocket): void {
    this.wsClients.delete(ws);
    console.log(`[Manager] Browser disconnected (${this.wsClients.size} total)`);
  }

  broadcast(message: WsMessage): void {
    const data = JSON.stringify(message, (_key, value) => {
      // Serialize Decimal objects to numbers
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
      totalMarkets: store.rewardMarkets.length,
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
      totalMarkets: store.rewardMarkets.length,
    });

    // All account states
    for (const state of store.getAccountStates()) {
      send({ type: "account_state", name: state.name, state });
    }

    // Account configs (without private keys)
    send({ type: "account_configs", configs: dbGetAllAccountMetas() });

    // Reward markets (with enabled status)
    send({ type: "reward_markets", markets: store.rewardMarkets as any, enabledIds: Array.from(store.enabledMarketIds) });

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
}

// Singleton
export const engineManager = new EngineManager();
