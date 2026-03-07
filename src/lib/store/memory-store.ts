import type {
  StrategyConfig,
  StrategyOverride,
  ManagedMarket,
  AccountState,
  OrderBook,
  OrderEvent,
} from "../types";
import {
  dbLoadStrategyConfig,
  dbSaveStrategyConfig,
  dbGetAllMarkets,
  dbGetAllAccountOverrides,
  dbGetAllMarketOverrides,
  dbAddMarket,
  dbRemoveMarket,
  dbSetAccountOverride,
  dbSetMarketOverride,
} from "../db/database";

const MAX_EVENT_LOG = 200;

class MemoryStore {
  config: StrategyConfig;
  accounts: Map<string, AccountState> = new Map();
  orderbooks: Map<string, OrderBook> = new Map(); // tokenId -> OrderBook
  managedMarkets: ManagedMarket[] = [];
  accountOverrides: Record<string, StrategyOverride> = {};
  marketOverrides: Record<string, StrategyOverride> = {};
  eventLog: OrderEvent[] = [];

  constructor() {
    this.config = dbLoadStrategyConfig();
    this.managedMarkets = dbGetAllMarkets();
    this.accountOverrides = dbGetAllAccountOverrides();
    this.marketOverrides = dbGetAllMarketOverrides();
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

  addEvent(event: OrderEvent): void {
    this.eventLog.unshift(event);
    if (this.eventLog.length > MAX_EVENT_LOG) {
      this.eventLog.length = MAX_EVENT_LOG;
    }
  }

  // --- Managed Markets ---

  addMarket(market: ManagedMarket): void {
    dbAddMarket(market);
    this.managedMarkets.push(market);
  }

  removeMarket(conditionId: string): void {
    dbRemoveMarket(conditionId);
    this.managedMarkets = this.managedMarkets.filter(
      (m) => m.conditionId !== conditionId,
    );
  }

  // --- Overrides ---

  setAccountOverride(accountName: string, override: StrategyOverride): void {
    dbSetAccountOverride(accountName, override);
    this.accountOverrides[accountName] = override;
  }

  setMarketOverride(conditionId: string, override: StrategyOverride): void {
    dbSetMarketOverride(conditionId, override);
    this.marketOverrides[conditionId] = override;
  }

  getAccountStates(): AccountState[] {
    return Array.from(this.accounts.values());
  }
}

const g = globalThis as typeof globalThis & { __memoryStore?: MemoryStore };
export const store = (g.__memoryStore ??= new MemoryStore());
