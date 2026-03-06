import { create } from "zustand";
import type {
  AccountState,
  AccountConfigDto,
  OrderBookDto,
  StrategyConfig,
  RewardMarketDto,
  OrderEvent,
  WsMessage,
} from "@/types";

interface AppState {
  wsConnected: boolean;
  accounts: AccountState[];
  accountConfigs: AccountConfigDto[];
  rewardMarkets: RewardMarketDto[];
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
  setRewardMarkets: (markets: RewardMarketDto[]) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  wsConnected: false,
  accounts: [],
  accountConfigs: [],
  rewardMarkets: [],
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

        case "reward_markets": {
          const enabledIds = new Set(msg.enabledIds || []);
          return {
            rewardMarkets: (msg.markets as any[]).map((m: any) => ({
              ...m,
              enabled: enabledIds.has(m.conditionId),
            })),
          };
        }

        case "market_toggle":
          return {
            rewardMarkets: state.rewardMarkets.map((m) =>
              m.conditionId === msg.conditionId
                ? { ...m, enabled: msg.enabled }
                : m,
            ),
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
  setRewardMarkets: (markets) => set({ rewardMarkets: markets }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
