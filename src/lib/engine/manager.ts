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
import type { TradeUpdate } from "../clob/ws-feed";
import { ClobExecutor } from "../clob/executor";
import { fetchMarketsByTokenIds } from "../gamma/api";
import { store } from "../store/memory-store";
import { AccountEngine } from "./engine";
import { getWalletAddress } from "../clob/wallet";

const ACCOUNT_NAME_RE = /^[a-zA-Z0-9_\-]{1,64}$/;
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const VALID_SIGNATURE_TYPES = new Set([0, 1, 2, 3]);

function normalizeAccountName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("账户名称不能为空");
  if (!ACCOUNT_NAME_RE.test(normalized)) {
    throw new Error("账户名称仅支持字母、数字、下划线和连字符，长度 1-64 位");
  }
  return normalized;
}

function normalizeProxyWallet(proxyWallet?: string): string | undefined {
  const normalized = proxyWallet?.trim();
  return normalized || undefined;
}

function normalizeSignatureSettings(
  signatureType: unknown,
  proxyWallet?: string,
): { signatureType: number; proxyWallet?: string } {
  if (signatureType != null && typeof signatureType !== "number") {
    throw new Error("签名类型不正确，仅支持 0、1、2、3");
  }

  const normalizedSignatureType = Math.floor(signatureType ?? 0);

  if (!VALID_SIGNATURE_TYPES.has(normalizedSignatureType)) {
    throw new Error("签名类型不正确，仅支持 0、1、2、3");
  }

  if (normalizedSignatureType === 0) {
    return { signatureType: normalizedSignatureType };
  }

  const normalizedProxyWallet = normalizeProxyWallet(proxyWallet);
  if (!normalizedProxyWallet) {
    throw new Error("非 EOA 签名类型必须填写资金钱包地址");
  }
  if (!ETH_ADDRESS_RE.test(normalizedProxyWallet)) {
    throw new Error("资金钱包地址格式不正确，需要 0x + 40 位十六进制字符");
  }

  return {
    signatureType: normalizedSignatureType,
    proxyWallet: normalizedProxyWallet,
  };
}

class EngineManager {
  private engines: Map<string, AccountEngine> = new Map();
  private accountConfigs: AccountConfig[] = [];
  private wsFeed: ClobWsFeed;
  private wsClients: Set<WebSocket> = new Set();
  private initialized = false;

  /** Track all active tokenIds across all accounts */
  private allActiveTokenIds: Set<string> = new Set();

  constructor() {
    this.wsFeed = new ClobWsFeed(
      (tokenId, book) => {
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
      },
      (trade) => this.handleTradeUpdate(trade),
      () => this.broadcastSystemStatus(),
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("[Manager] Initializing...");

    // Load accounts from DB
    this.accountConfigs = dbGetAllAccountConfigs();

    // Initialize account states
    for (const acc of this.accountConfigs) {
      store.updateAccount(acc.name, {
        status: "idle",
        address: getWalletAddress(acc.privateKey),
      });

      // Create engine
      this.createEngine(acc);

      // Fetch balance in background. The balance read refreshes CLOB's cache first.
      const executor = new ClobExecutor(acc);
      executor.initApiKeys().then(async () => {
        const balance = await executor.getCollateralBalance();
        console.log(`[Manager] ${acc.name} balance: $${balance}`);
        store.updateAccount(acc.name, { balance });
        this.broadcast({ type: "account_state", name: acc.name, state: store.accounts.get(acc.name)! });
      }).catch((e: unknown) => {
        console.error(`[Manager] Failed to fetch balance for ${acc.name}:`, this.errorMessage(e));
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

    void this.autoStartEnabledAccounts();
  }

  private async autoStartEnabledAccounts(): Promise<void> {
    const enabledNames = dbGetEnabledAccountNames();
    if (enabledNames.length > 0) {
      console.log(`[Manager] Auto-starting ${enabledNames.length} previously enabled accounts in background: ${enabledNames.join(", ")}`);
      for (const name of enabledNames) {
        try {
          await this.startAccount(name);
          console.log(`[Manager] Auto-started: ${name}`);
        } catch (e: unknown) {
          console.error(`[Manager] Failed to auto-start ${name}:`, this.errorMessage(e));
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

  private hasAccountName(normalizedName: string): boolean {
    return this.accountConfigs.some((acc) => acc.name.trim() === normalizedName);
  }

  private resolveAccountName(name: string): string {
    const normalizedName = name.trim();
    if (this.engines.has(normalizedName)) return normalizedName;
    if (this.engines.has(name)) return name;
    for (const existingName of this.engines.keys()) {
      if (existingName.trim() === normalizedName) return existingName;
    }
    return normalizedName;
  }

  // --- Token Discovery & Subscription Sync ---

  /**
   * Called by engines after each tick with the set of tokenIds that have active orders.
   * Aggregates across all engines and syncs WS subscriptions accordingly.
   */
  private async handleTokensDiscovered(accountName: string, tokenIds: Set<string>): Promise<void> {
    // Aggregate all active tokenIds across all running engines
    const allTokenIds = this.collectActiveTokenIds();
    // Include the just-reported tokens
    // Pending reset placements are not always visible in activeOrders yet.
    if (this.engines.get(accountName)?.isRunning()) {
      for (const id of tokenIds) allTokenIds.add(id);
    }

    await this.syncSubscriptions(allTokenIds);
  }

  private collectActiveTokenIds(): Set<string> {
    const tokenIds = new Set<string>();
    for (const [name, engine] of this.engines) {
      if (!engine.isRunning()) continue;
      const state = store.accounts.get(name);
      if (state) {
        for (const order of state.activeOrders) {
          tokenIds.add(order.tokenId);
        }
      }
    }

    return tokenIds;
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
      } catch (e: unknown) {
        console.error("[Manager] Failed to fetch market info:", this.errorMessage(e));
      }
    }

    // Unsubscribe gone tokens
    if (goneTokenIds.length > 0) {
      console.log(`[Manager] Unsubscribing ${goneTokenIds.length} gone tokens`);
      this.wsFeed.unsubscribe(goneTokenIds);
      for (const id of goneTokenIds) {
        store.deleteOrderBook(id);
      }
      this.broadcast({ type: "orderbooks_removed", tokenIds: goneTokenIds });

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
    const normalizedName = normalizeAccountName(name);
    const normalizedSettings = normalizeSignatureSettings(signatureType, proxyWallet);
    if (this.hasAccountName(normalizedName)) throw new Error(`账户已存在：${normalizedName}`);

    // Validate private key
    const address = getWalletAddress(privateKey);

    // Write to DB
    dbAddAccount(
      normalizedName,
      privateKey,
      normalizedSettings.signatureType,
      normalizedSettings.proxyWallet,
    );

    // Update in-memory config
    const acc: AccountConfig = {
      name: normalizedName,
      privateKey,
      signatureType: normalizedSettings.signatureType,
      proxyWallet: normalizedSettings.proxyWallet,
    };
    this.accountConfigs.push(acc);

    // Create engine
    this.createEngine(acc);

    // Update store
    store.updateAccount(normalizedName, { status: "idle", address });

    // Fetch balance in background (don't block account creation)
    const executor = new ClobExecutor(acc);
    executor.initApiKeys().then(async () => {
      const balance = await executor.getCollateralBalance();
      console.log(`[Manager] ${normalizedName} balance: $${balance}`);
      store.updateAccount(normalizedName, { balance });
      this.broadcast({
        type: "account_state",
        name: normalizedName,
        state: store.accounts.get(normalizedName)!,
      });
    }).catch((e: unknown) => {
      console.error(`[Manager] Failed to fetch balance for ${normalizedName}:`, this.errorMessage(e));
    });

    // Broadcast
    this.broadcast({ type: "account_state", name: normalizedName, state: store.accounts.get(normalizedName)! });
    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
    this.broadcastSystemStatus();
  }

  async updateAccountConfig(
    name: string,
    privateKey: string | null,
    signatureType: number,
    proxyWallet?: string,
  ): Promise<void> {
    const normalizedName = normalizeAccountName(name);
    const normalizedSettings = normalizeSignatureSettings(signatureType, proxyWallet);
    const existingName = this.resolveAccountName(name);
    const engine = this.engines.get(existingName);
    if (!engine) throw new Error(`未找到账户：${normalizedName}`);

    const currentConfig = dbGetAccountConfig(existingName);
    if (!currentConfig) throw new Error(`未找到账户：${normalizedName}`);

    const nextPrivateKey = privateKey ?? currentConfig.privateKey;
    const address = getWalletAddress(nextPrivateKey);

    dbUpdateAccount(
      existingName,
      privateKey,
      normalizedSettings.signatureType,
      normalizedSettings.proxyWallet,
    );

    const newConfig = dbGetAccountConfig(existingName);
    if (!newConfig) throw new Error(`账户更新后无法从数据库读取：${normalizedName}`);

    if (engine.isRunning()) {
      await engine.stop();
    }

    const idx = this.accountConfigs.findIndex((a) => a.name === existingName);
    if (idx >= 0) this.accountConfigs[idx] = newConfig;

    this.createEngine(newConfig);

    store.updateAccount(existingName, { status: "idle", address });
    await this.syncSubscriptions(this.collectActiveTokenIds());

    this.broadcast({ type: "account_state", name: existingName, state: store.accounts.get(existingName)! });
    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
  }

  async removeAccount(name: string): Promise<void> {
    const normalizedName = this.resolveAccountName(name);
    const engine = this.engines.get(normalizedName);
    if (!engine) throw new Error(`未找到账户：${normalizedName}`);

    dbDeleteAccount(normalizedName);

    if (engine.isRunning()) {
      await engine.stop();
    }

    this.engines.delete(normalizedName);
    this.accountConfigs = this.accountConfigs.filter((a) => a.name !== normalizedName);
    store.accounts.delete(normalizedName);
    await this.syncSubscriptions(this.collectActiveTokenIds());

    this.broadcast({ type: "account_removed", name: normalizedName });
    this.broadcast({ type: "account_configs", configs: dbGetAllAccountMetas() });
    this.broadcastSystemStatus();
  }

  // --- Engine Control ---

  async startAccount(name: string): Promise<boolean> {
    const normalizedName = this.resolveAccountName(name);
    const engine = this.engines.get(normalizedName);
    if (!engine) return false;
    const started = await engine.start();
    if (!started) {
      dbSetAccountEnabled(normalizedName, false);
      this.broadcastSystemStatus();
      return false;
    }
    dbSetAccountEnabled(normalizedName, true);
    this.broadcastSystemStatus();
    return true;
  }

  async stopAccount(name: string): Promise<boolean> {
    const normalizedName = this.resolveAccountName(name);
    const engine = this.engines.get(normalizedName);
    if (!engine) return false;
    await engine.stop();
    dbSetAccountEnabled(normalizedName, false);
    await this.syncSubscriptions(this.collectActiveTokenIds());
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
    const normalizedName = this.resolveAccountName(accountName);
    const engine = this.engines.get(normalizedName);
    if (!engine) return false;
    const ok = await engine.cancelOrderById(orderId);
    if (ok) {
      // Update account state: remove cancelled order from active list
      const state = store.accounts.get(normalizedName);
      if (state) {
        const activeOrders = state.activeOrders.filter((o) => o.orderId !== orderId);
        store.updateAccount(normalizedName, {
          activeOrders,
          marketsCount: new Set(activeOrders.map((o) => o.tokenId)).size,
        });
        this.broadcast({
          type: "account_state",
          name: normalizedName,
          state: store.accounts.get(normalizedName)!,
        });
      }
      await this.syncSubscriptions(this.collectActiveTokenIds());
    }
    return ok;
  }

  async cancelAllOrders(accountName: string): Promise<boolean> {
    const normalizedName = this.resolveAccountName(accountName);
    const engine = this.engines.get(normalizedName);
    if (!engine) return false;
    const ok = await engine.cancelAllOrders();
    if (!ok) return false;
    store.updateAccount(normalizedName, { activeOrders: [], marketsCount: 0 });
    this.broadcast({ type: "account_state", name: normalizedName, state: store.accounts.get(normalizedName)! });
    await this.syncSubscriptions(this.collectActiveTokenIds());
    return true;
  }

  getAccountStates(): AccountState[] {
    return store.getAccountStates();
  }

  getAccountState(name: string): AccountState | undefined {
    return store.accounts.get(this.resolveAccountName(name));
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

  private handleTradeUpdate(trade: TradeUpdate): void {
    for (const engine of this.engines.values()) {
      if (engine.isRunning()) {
        engine.onTrade(trade);
      }
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

// Singleton — shared via globalThis so Next.js API routes and custom server use the same instance
const g = globalThis as typeof globalThis & { __engineManager?: EngineManager };
export const engineManager = (g.__engineManager ??= new EngineManager());
