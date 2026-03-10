import type {
  StrategyConfig,
  DiscoveredMarket,
  AccountState,
  OrderBook,
  OrderEvent,
} from "../types";
import {
  dbLoadStrategyConfig,
  dbSaveStrategyConfig,
} from "../db/database";

const MAX_EVENT_LOG = 200;

class MemoryStore {
  config: StrategyConfig;
  accounts: Map<string, AccountState> = new Map();
  orderbooks: Map<string, OrderBook> = new Map(); // tokenId -> OrderBook
  discoveredMarkets: Map<string, DiscoveredMarket> = new Map();
  eventLog: OrderEvent[] = [];

  constructor() {
    this.config = dbLoadStrategyConfig();
  }

  updateConfig(partial: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...partial };
    dbSaveStrategyConfig(this.config);
  }

  updateAccount(name: string, state: Partial<AccountState>): void {
    const existing = this.accounts.get(name);
    if (existing) {
      Object.assign(existing, state, { lastUpdate: Date.now() });
    } else {
      this.accounts.set(name, {
        name,
        status: "idle",
        balance: 0,
        address: "",
        activeOrders: [],
        marketsCount: 0,
        lastUpdate: Date.now(),
        ...state,
      });
    }
  }

  updateOrderBook(tokenId: string, book: OrderBook): void {
    this.orderbooks.set(tokenId, book);
  }

  deleteOrderBook(tokenId: string): void {
    this.orderbooks.delete(tokenId);
  }

  addEvent(event: OrderEvent): void {
    this.eventLog.unshift(event);
    if (this.eventLog.length > MAX_EVENT_LOG) {
      this.eventLog.length = MAX_EVENT_LOG;
    }
  }

  getAccountStates(): AccountState[] {
    return Array.from(this.accounts.values());
  }

  getDiscoveredMarketsList(): DiscoveredMarket[] {
    return Array.from(this.discoveredMarkets.values());
  }
}

const g = globalThis as typeof globalThis & { __memoryStore?: MemoryStore };
export const store = (g.__memoryStore ??= new MemoryStore());
