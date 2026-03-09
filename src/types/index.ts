// Frontend-friendly types (no Decimal.js dependency, uses plain numbers)

export type AccountStatus = "idle" | "running" | "stopping" | "error";

export interface ActiveOrder {
  orderId: string;
  tokenId: string;
  marketSlug: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  status: "open" | "filled" | "cancelled";
  scoring: boolean;
  timestamp: number;
}

export interface AccountState {
  name: string;
  status: AccountStatus;
  balance: number;
  address: string;
  activeOrders: ActiveOrder[];
  marketsCount: number;
  lastUpdate: number;
  error?: string;
}

export interface AccountConfigDto {
  name: string;
  signatureType: number;
  proxyWallet?: string;
}

export interface PriceLevelDto {
  price: number;
  size: number;
}

export interface OrderBookDto {
  tokenId: string;
  bids: PriceLevelDto[];
  asks: PriceLevelDto[];
  timestamp: number;
}

export interface StrategyConfig {
  cancelDepthLevel: number;
}

export interface MarketToken {
  token_id: string;
  outcome: string;
  winner: boolean;
}

export interface DiscoveredMarketDto {
  conditionId: string;
  slug: string;
  question: string;
  tokens: MarketToken[];
}

export type OrderEventType = "placed" | "cancelled" | "filled" | "moved";

export interface OrderEvent {
  type: OrderEventType;
  accountName: string;
  orderId: string;
  tokenId: string;
  marketSlug: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  timestamp: number;
}

export type WsMessage =
  | {
      type: "orderbook_update";
      tokenId: string;
      bids: PriceLevelDto[];
      asks: PriceLevelDto[];
      timestamp: number;
    }
  | {
      type: "account_state";
      name: string;
      state: AccountState;
    }
  | {
      type: "order_event";
      event: OrderEvent;
    }
  | {
      type: "system_status";
      wsConnected: boolean;
      totalAccounts: number;
      totalMarkets: number;
    }
  | {
      type: "discovered_markets";
      markets: DiscoveredMarketDto[];
    }
  | {
      type: "config_update";
      config: StrategyConfig;
    }
  | {
      type: "account_configs";
      configs: AccountConfigDto[];
    };
