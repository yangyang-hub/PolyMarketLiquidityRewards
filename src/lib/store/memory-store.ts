import type {
  StrategyConfig,
  AccountState,
  OrderBook,
  RewardMarketCandidate,
  OrderEvent,
} from "../types";
import {
  dbLoadStrategyConfig,
  dbGetEnabledMarketIds,
  dbEnableMarket,
  dbDisableMarket,
  dbSaveStrategyConfig,
} from "../db/database";

const MAX_EVENT_LOG = 200;

class MemoryStore {
  config: StrategyConfig;
  accounts: Map<string, AccountState> = new Map();
  orderbooks: Map<string, OrderBook> = new Map(); // tokenId → OrderBook
  rewardMarkets: RewardMarketCandidate[] = [];
  eventLog: OrderEvent[] = [];
  enabledMarketIds: Set<string> = new Set(); // conditionId

  constructor() {
    this.config = dbLoadStrategyConfig();
    this.enabledMarketIds = new Set(dbGetEnabledMarketIds());
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

  enableMarket(conditionId: string): void {
    this.enabledMarketIds.add(conditionId);
    dbEnableMarket(conditionId);
  }

  disableMarket(conditionId: string): void {
    this.enabledMarketIds.delete(conditionId);
    dbDisableMarket(conditionId);
  }

  isMarketEnabled(conditionId: string): boolean {
    return this.enabledMarketIds.has(conditionId);
  }

  getAccountStates(): AccountState[] {
    return Array.from(this.accounts.values());
  }
}

export const store = new MemoryStore();
