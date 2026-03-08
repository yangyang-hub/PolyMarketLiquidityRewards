import { create } from "zustand";
import type {
  AccountState,
  AccountConfigDto,
  OrderBookDto,
  StrategyConfig,
  StrategyOverride,
  ManagedMarketDto,
  OrderEvent,
  WsMessage,
} from "@/types";

/** Shallow-compare two OrderBookDto bid/ask arrays (price + size) */
function bookEqual(
  prev: OrderBookDto | undefined,
  bids: { price: number; size: number }[],
  asks: { price: number; size: number }[],
): boolean {
  if (!prev) return false;
  if (prev.bids.length !== bids.length || prev.asks.length !== asks.length) return false;
  for (let i = 0; i < bids.length; i++) {
    if (prev.bids[i].price !== bids[i].price || prev.bids[i].size !== bids[i].size) return false;
  }
  for (let i = 0; i < asks.length; i++) {
    if (prev.asks[i].price !== asks[i].price || prev.asks[i].size !== asks[i].size) return false;
  }
  return true;
}

interface AppState {
  wsConnected: boolean;
  accounts: AccountState[];
  accountConfigs: AccountConfigDto[];
  managedMarkets: ManagedMarketDto[];
  accountOverrides: Record<string, StrategyOverride>;
  marketOverrides: Record<string, StrategyOverride>;
  selectedMarketTokenId: string | null;
  orderbooks: Record<string, OrderBookDto>;
  config: StrategyConfig | null;
  eventLog: OrderEvent[];
  systemStatus: {
    wsConnected: boolean;
    totalAccounts: number;
    totalMarkets: number;
  };

  // Actions
  updateFromWs: (msg: WsMessage) => void;
  setSelectedMarketToken: (tokenId: string | null) => void;
  setConfig: (config: StrategyConfig) => void;
  setAccounts: (accounts: AccountState[]) => void;
  setAccountConfigs: (configs: AccountConfigDto[]) => void;
  setManagedMarkets: (markets: ManagedMarketDto[]) => void;
  setOrderbooks: (books: Record<string, OrderBookDto>) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  wsConnected: false,
  accounts: [],
  accountConfigs: [],
  managedMarkets: [],
  accountOverrides: {},
  marketOverrides: {},
  selectedMarketTokenId: null,
  orderbooks: {},
  config: null,
  eventLog: [],
  systemStatus: {
    wsConnected: false,
    totalAccounts: 0,
    totalMarkets: 0,
  },

  updateFromWs: (msg) =>
    set((state) => {
      switch (msg.type) {
        case "orderbook_update": {
          const prev = state.orderbooks[msg.tokenId];
          const sortedBids = [...msg.bids].sort((a, b) => b.price - a.price);
          const sortedAsks = [...msg.asks].sort((a, b) => a.price - b.price);
          // When data is identical, reuse existing arrays (keeps useShallow stable for TokenRow)
          // but still update timestamp so the OrderBookPanel elapsed timer stays fresh
          const dataUnchanged = bookEqual(prev, sortedBids, sortedAsks);
          return {
            orderbooks: {
              ...state.orderbooks,
              [msg.tokenId]: dataUnchanged && prev
                ? { ...prev, timestamp: msg.timestamp }
                : {
                    tokenId: msg.tokenId,
                    bids: sortedBids,
                    asks: sortedAsks,
                    timestamp: msg.timestamp,
                  },
            },
          };
        }

        case "account_state": {
          const idx = state.accounts.findIndex((a) => a.name === msg.name);
          if (idx >= 0) {
            const prev = state.accounts[idx];
            // Skip update if nothing meaningful changed
            if (
              prev.balance === msg.state.balance &&
              prev.status === msg.state.status &&
              prev.activeOrders.length === msg.state.activeOrders.length &&
              prev.marketsCount === msg.state.marketsCount &&
              prev.error === msg.state.error
            ) {
              return {};
            }
            const next = [...state.accounts];
            next[idx] = msg.state;
            return { accounts: next };
          }
          return { accounts: [...state.accounts, msg.state] };
        }

        case "order_event":
          return {
            eventLog: [msg.event, ...state.eventLog].slice(0, 200),
          };

        case "system_status": {
          const prev = state.systemStatus;
          if (
            prev.wsConnected === msg.wsConnected &&
            prev.totalAccounts === msg.totalAccounts &&
            prev.totalMarkets === msg.totalMarkets
          ) {
            return {};
          }
          return {
            systemStatus: {
              wsConnected: msg.wsConnected,
              totalAccounts: msg.totalAccounts,
              totalMarkets: msg.totalMarkets,
            },
          };
        }

        case "managed_markets":
          return {
            managedMarkets: msg.markets,
          };

        case "market_added":
          return {
            managedMarkets: [...state.managedMarkets, msg.market],
          };

        case "market_removed":
          return {
            managedMarkets: state.managedMarkets.filter(
              (m) => m.conditionId !== msg.conditionId,
            ),
          };

        case "overrides_update":
          return {
            accountOverrides: msg.accountOverrides,
            marketOverrides: msg.marketOverrides,
          };

        case "config_update":
          return { config: msg.config };

        case "account_configs":
          return { accountConfigs: msg.configs };

        default:
          return {};
      }
    }),

  setSelectedMarketToken: (tokenId) => set({ selectedMarketTokenId: tokenId }),
  setConfig: (config) => set({ config }),
  setAccounts: (accounts) => set({ accounts }),
  setAccountConfigs: (configs) => set({ accountConfigs: configs }),
  setManagedMarkets: (markets) => set({ managedMarkets: markets }),
  setOrderbooks: (books) => set((state) => {
    const sorted: Record<string, typeof books[string]> = {};
    for (const [tokenId, book] of Object.entries(books)) {
      sorted[tokenId] = {
        ...book,
        bids: [...book.bids].sort((a, b) => b.price - a.price),
        asks: [...book.asks].sort((a, b) => a.price - b.price),
      };
    }
    return { orderbooks: { ...state.orderbooks, ...sorted } };
  }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
