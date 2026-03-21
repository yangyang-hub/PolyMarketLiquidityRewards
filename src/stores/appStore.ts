import { create } from "zustand";
import type {
  AccountState,
  AccountConfigDto,
  OrderBookDto,
  StrategyConfig,
  DiscoveredMarketDto,
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

function activeOrdersEqual(
  prev: AccountState["activeOrders"],
  next: AccountState["activeOrders"],
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      a.orderId !== b.orderId ||
      a.tokenId !== b.tokenId ||
      a.marketSlug !== b.marketSlug ||
      a.side !== b.side ||
      a.price !== b.price ||
      a.priceStr !== b.priceStr ||
      a.size !== b.size ||
      a.status !== b.status ||
      a.scoring !== b.scoring ||
      a.timestamp !== b.timestamp
    ) {
      return false;
    }
  }
  return true;
}

interface AppState {
  wsConnected: boolean;
  accounts: AccountState[];
  accountConfigs: AccountConfigDto[];
  discoveredMarkets: DiscoveredMarketDto[];
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
  setDiscoveredMarkets: (markets: DiscoveredMarketDto[]) => void;
  setOrderbooks: (books: Record<string, OrderBookDto>) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  wsConnected: false,
  accounts: [],
  accountConfigs: [],
  discoveredMarkets: [],
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
            if (
              prev.balance === msg.state.balance &&
              prev.status === msg.state.status &&
              activeOrdersEqual(prev.activeOrders, msg.state.activeOrders) &&
              prev.marketsCount === msg.state.marketsCount &&
              prev.error === msg.state.error &&
              prev.address === msg.state.address
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

        case "discovered_markets":
          return {
            discoveredMarkets: msg.markets,
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
  setDiscoveredMarkets: (markets) => set({ discoveredMarkets: markets }),
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
