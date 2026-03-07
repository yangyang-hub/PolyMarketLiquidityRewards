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
        case "orderbook_update":
          return {
            orderbooks: {
              ...state.orderbooks,
              [msg.tokenId]: {
                tokenId: msg.tokenId,
                bids: msg.bids,
                asks: msg.asks,
                timestamp: msg.timestamp,
              },
            },
          };

        case "account_state":
          return {
            accounts: state.accounts.some((a) => a.name === msg.name)
              ? state.accounts.map((a) =>
                  a.name === msg.name ? msg.state : a,
                )
              : [...state.accounts, msg.state],
          };

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
  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
