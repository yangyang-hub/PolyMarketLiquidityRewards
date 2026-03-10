import WebSocket from "ws";
import Decimal from "decimal.js";
import type {
  AccountConfig,
  AccountState,
  DiscoveredMarket,
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
  dbSetAccountEnabled,
  dbGetEnabledAccountNames,
} from "../db/database";
import { ClobWsFeed } from "../clob/ws-feed";
import { ClobExecutor } from "../clob/executor";
import { fetchMarketsByTokenIds } from "../gamma/api";
import { store } from "../store/memory-store";
import { AccountEngine } from "./engine";
import { ethers } from "ethers";

const ACCOUNT_NAME_RE = /^[a-zA-Z0-9_\-]{1,64}$/;

class EngineManager {
  private engines: Map<string, AccountEngine> = new Map();
  private accountConfigs: AccountConfig[] = [];
  private wsFeed: ClobWsFeed;
  private wsClients: Set<WebSocket> = new Set();
  private initialized = false;

  /** Track all active tokenIds across all accounts */
  private allActiveTokenIds: Set<string> = new Set();

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
      // Notify all running engines of the book update
      for (const engine of this.engines.values()) {
        if (engine.isRunning()) {
          engine.onBookUpdate(tokenId);
        }
      }
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
      this.createEngine(acc);

      // Fetch balance in background and refresh allowance cache
      const executor = new ClobExecutor(acc);
      executor.initApiKeys().then(async () => {
        const balance = await executor.getCollateralBalance();
        console.log(`[Manager] ${acc.name} balance: $${balance}`);
        store.updateAccount(acc.name, { balance });
        this.broadcast({ type: "account_state", name: acc.name, state: store.accounts.get(acc.name)! });
        // Trigger CLOB server to refresh its cached allowance
        await executor.refreshAllowanceCache();
      }).catch((e: any) => {
        console.error(`[Manager] Failed to fetch balance for ${acc.name}:`, e.message);
      });
    }

    // Start WS feed
    this.wsFeed.start();

    // Periodic diagnostics log (every 60 seconds)
    setInterval(() => {
      console.log(
        `[Manager] Status: CLOB WS ${this.wsFeed.connected ? "connected" : "disconnected"}, ` +
        `updates=${this.wsFeed.updateCount}, ` +
        `browsers=${this.wsClients.size}, ` +
        `tokens=${this.allActiveTokenIds.size}, ` +
        `discovered=${store.discoveredMarkets.size}`,
      );
    }, 60_000);

    this.initialized = true;
    console.log(`[Manager] Initialized with ${this.accountConfigs.length} accounts`);
    this.broadcastSystemStatus();

    // Auto-start accounts that were enabled before restart
    const enabledNames = dbGetEnabledAccountNames();
    if (enabledNames.length > 0) {
      console.log(`[Manager] Auto-starting ${enabledNames.length} previously enabled accounts: ${enabledNames.join(", ")}`);
      for (const name of enabledNames) {
        try {
          await this.startAccount(name);
          console.log(`[Manager] Auto-started: ${name}`);
        } catch (e: any) {
          console.error(`[Manager] Failed to auto-start ${name}:`, e.message);
          dbSetAccountEnabled(name, false);
        }
      }
    }
  }

  private createEngine(acc: AccountConfig): AccountEngine {
    const engine = new AccountEngine(
      acc,
      (event) => this.broadcast({ type: "order_event", event }),
      (name, state) => this.broadcast({ type: "account_state", name, state }),
      (accountName, tokenIds) => this.handleTokensDiscovered(accountName, tokenIds),
    );
    this.engines.set(acc.name, engine);
    return engine;
  }

  // --- Token Discovery & Subscription Sync ---

  /**
   * Called by engines after each tick with the set of tokenIds that have active orders.
   * Aggregates across all engines and syncs WS subscriptions accordingly.
   */
  private async handleTokensDiscovered(_accountName: string, tokenIds: Set<string>): Promise<void> {
    // Aggregate all active tokenIds across all running engines
    const allTokenIds = new Set<string>();
    // Include the just-reported tokens
    for (const id of tokenIds) allTokenIds.add(id);
    // Include tokens from other running engines' latest known orders
    for (const [name, engine] of this.engines) {
      if (!engine.isRunning()) continue;
      const state = store.accounts.get(name);
      if (state) {
        for (const order of state.activeOrders) {
          allTokenIds.add(order.tokenId);
        }
      }
    }

    await this.syncSubscriptions(allTokenIds);
  }

  /**
   * Sync WS subscriptions and market discovery based on active tokenIds.
   * - New tokens → subscribe + fetch market info from Gamma
   * - Gone tokens → unsubscribe + clean orderbook cache
   */
  async syncSubscriptions(activeTokenIds: Set<string>): Promise<void> {
    const prevTokenIds = this.allActiveTokenIds;

    // Find new and gone tokens
    const newTokenIds: string[] = [];
    for (const id of activeTokenIds) {
      if (!prevTokenIds.has(id)) newTokenIds.push(id);
    }
    const goneTokenIds: string[] = [];
    for (const id of prevTokenIds) {
      if (!activeTokenIds.has(id)) goneTokenIds.push(id);
    }

    this.allActiveTokenIds = new Set(activeTokenIds);

    // Subscribe to new tokens
    if (newTokenIds.length > 0) {
      console.log(`[Manager] Subscribing to ${newTokenIds.length} new tokens`);
      this.wsFeed.subscribe(newTokenIds);
    }

    // Fetch market info from Gamma for tokens without discovered market
    // (includes new tokens + previously failed lookups)
    const unknownTokenIds = [...activeTokenIds].filter((id) => {
      for (const market of store.discoveredMarkets.values()) {
        if (market.tokens.some((t) => t.token_id === id)) return false;
      }
      return true;
    });

    if (unknownTokenIds.length > 0) {
      try {
        const marketMap = await fetchMarketsByTokenIds(unknownTokenIds);
        for (const [, info] of marketMap) {
          if (!store.discoveredMarkets.has(info.condition_id)) {
            const discovered: DiscoveredMarket = {
              conditionId: info.condition_id,
              slug: info.slug,
              question: info.question,
              tokens: info.tokens,
            };
            store.discoveredMarkets.set(info.condition_id, discovered);
            console.log(`[Manager] Discovered market: ${info.question.slice(0, 60)}`);
          }
        }
        // Broadcast updated market list
        this.broadcast({
          type: "discovered_markets",
          markets: store.getDiscoveredMarketsList(),
        });

        // Backfill empty slugs in cached orders
        for (const [name] of this.engines) {
          const state = store.accounts.get(name);
          if (!state || state.activeOrders.length === 0) continue;
          let updated = false;
          const patched = state.activeOrders.map((order) => {
            if (order.marketSlug) return order;
            for (const market of store.discoveredMarkets.values()) {
              const match = market.tokens.find((t) => t.token_id === order.tokenId);
              if (match) {
                updated = true;
                return { ...order, marketSlug: market.slug };
              }
            }
            return order;
          });
          if (updated) {
            store.updateAccount(name, { activeOrders: patched });
            this.broadcast({ type: "account_state", name, state: store.accounts.get(name)! });
          }
        }
      } catch (e: any) {
        console.error("[Manager] Failed to fetch market info:", e.message);
      }
    }

    // Unsubscribe gone tokens
    if (goneTokenIds.length > 0) {
      console.log(`[Manager] Unsubscribing ${goneTokenIds.length} gone tokens`);
      this.wsFeed.unsubscribe(goneTokenIds);
      for (const id of goneTokenIds) {
        store.deleteOrderBook(id);
      }

      // Clean up discovered markets that no longer have any active tokens
      for (const [conditionId, market] of store.discoveredMarkets) {
        const hasActiveToken = market.tokens.some((t) => activeTokenIds.has(t.token_id));
        if (!hasActiveToken) {
          store.discoveredMarkets.delete(conditionId);
          console.log(`[Manager] Removed discovered market: ${market.question.slice(0, 60)}`);
        }
      }

      this.broadcast({
        type: "discovered_markets",
        markets: store.getDiscoveredMarketsList(),
      });
    }

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
    this.createEngine(acc);

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

    this.createEngine(newConfig);

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

  // --- Engine Control ---

  async startAccount(name: string): Promise<boolean> {
    const engine = this.engines.get(name);
    if (!engine) return false;
    await engine.start();
    dbSetAccountEnabled(name, true);
    this.broadcastSystemStatus();
    return true;
  }

  async stopAccount(name: string): Promise<boolean> {
    const engine = this.engines.get(name);
    if (!engine) return false;
    await engine.stop();
    dbSetAccountEnabled(name, false);
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

  async cancelOrder(accountName: string, orderId: string): Promise<boolean> {
    const engine = this.engines.get(accountName);
    if (!engine) return false;
    const ok = await engine.cancelOrderById(orderId);
    if (ok) {
      // Update account state: remove cancelled order from active list
      const state = store.accounts.get(accountName);
      if (state) {
        store.updateAccount(accountName, {
          activeOrders: state.activeOrders.filter((o) => o.orderId !== orderId),
        });
        this.broadcast({ type: "account_state", name: accountName, state: store.accounts.get(accountName)! });
      }
    }
    return ok;
  }

  async cancelAllOrders(accountName: string): Promise<boolean> {
    const engine = this.engines.get(accountName);
    if (!engine) return false;
    await engine.cancelAllOrders();
    store.updateAccount(accountName, { activeOrders: [] });
    this.broadcast({ type: "account_state", name: accountName, state: store.accounts.get(accountName)! });
    return true;
  }

  getAccountStates(): AccountState[] {
    return store.getAccountStates();
  }

  getDiscoveredMarkets(): DiscoveredMarket[] {
    return store.getDiscoveredMarketsList();
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
      totalMarkets: store.discoveredMarkets.size,
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
      totalMarkets: store.discoveredMarkets.size,
    });

    // All account states
    for (const state of store.getAccountStates()) {
      send({ type: "account_state", name: state.name, state });
    }

    // Account configs (without private keys)
    send({ type: "account_configs", configs: dbGetAllAccountMetas() });

    // Discovered markets
    send({ type: "discovered_markets", markets: store.getDiscoveredMarketsList() });

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

// Singleton — shared via globalThis so Next.js API routes and custom server use the same instance
const g = globalThis as typeof globalThis & { __engineManager?: EngineManager };
export const engineManager = (g.__engineManager ??= new EngineManager());
