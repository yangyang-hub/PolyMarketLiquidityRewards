import Decimal from "decimal.js";

// --- OrderBook ---

export interface PriceLevel {
  price: Decimal;
  size: Decimal;
}

export interface OrderBook {
  tokenId: string;
  bids: PriceLevel[]; // sorted descending (best/highest first)
  asks: PriceLevel[]; // sorted ascending (best/lowest first)
  timestamp: number;
}

// --- Strategy Config ---

export interface StrategyConfig {
  cancelDepthLevel: number;
}

// --- Discovered Market (auto-discovered from wallet orders) ---

export interface DiscoveredMarket {
  conditionId: string;
  slug: string;
  question: string;
  tokens: MarketToken[];
}

// --- Account ---

export interface AccountConfig {
  name: string;
  privateKey: string;
  signatureType: number; // 0=EOA, 1=Proxy, 2=GnosisSafe
  proxyWallet?: string;
}

export interface AccountMeta {
  name: string;
  signatureType: number;
  proxyWallet?: string;
}

export type AccountStatus = "idle" | "running" | "stopping" | "error";

export interface ActiveOrder {
  orderId: string;
  tokenId: string;
  marketSlug: string;
  side: "buy" | "sell";
  price: number;
  priceStr: string; // original string from CLOB API, for precise Decimal comparison
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

// --- Market ---

export interface MarketToken {
  token_id: string;
  outcome: string;
  winner: boolean;
}

export interface MarketInfo {
  condition_id: string;
  question_id: string;
  slug: string;
  question: string;
  active: boolean;
  closed: boolean;
  neg_risk: boolean;
  tokens: MarketToken[];
  rewards?: {
    max_spread: number;
    min_size: number;
  };
  liquidity: number;
}

// --- Events ---

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

// --- WebSocket Messages ---

export type WsMessage =
  | {
      type: "orderbook_update";
      tokenId: string;
      bids: { price: number; size: number }[];
      asks: { price: number; size: number }[];
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
      markets: DiscoveredMarket[];
    }
  | {
      type: "config_update";
      config: StrategyConfig;
    }
  | {
      type: "account_configs";
      configs: AccountMeta[];
    };
