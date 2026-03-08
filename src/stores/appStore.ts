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

interface AppState {
  wsConnected: boolean;
  accounts: AccountState[];
  accountConfigs: AccountConfigDto[];
  managedMarkets: ManagedMarketDto[];
  accountOverrides: Record<string, StrategyOverride>;
  marketOverrides: Record<string, StrategyOverride>;
  selectedMarketTokenId: string | null;
  orderbooks: Record<string, OrderBookDto>;
  orderbookSeq: number; // increments on each orderbook_update for live indicator
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
  orderbookSeq: 0,
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
        case "orderbook_update":
          return {
            orderbooks: {
              ...state.orderbooks,
              [msg.tokenId]: {
                tokenId: msg.tokenId,
                bids: [...msg.bids].sort((a, b) => b.price - a.price),
                asks: [...msg.asks].sort((a, b) => a.price - b.price),
                timestamp: msg.timestamp,
              },
            },
            orderbookSeq: state.orderbookSeq + 1,
          };

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

        case "system_status":
          return {
            systemStatus: {
              wsConnected: msg.wsConnected,
              totalAccounts: msg.totalAccounts,
              totalMarkets: msg.totalMarkets,
            },
          };

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
