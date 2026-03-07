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

export function midpoint(book: OrderBook): Decimal | null {
  if (book.bids.length === 0 || book.asks.length === 0) return null;
  return book.bids[0].price.plus(book.asks[0].price).dividedBy(2);
}

export function spread(book: OrderBook): Decimal | null {
  if (book.bids.length === 0 || book.asks.length === 0) return null;
  return book.asks[0].price.minus(book.bids[0].price);
}

// --- Strategy Config ---

export interface StrategyConfig {
  orderDepthLevel: number;
  cancelDepthLevel: number;
  minOrderSize: number;
  maxPositionPerMarket: number;
  maxTotalExposure: number;
  spreadFraction: number;
  minDailyRate: number;
  maxMarkets: number;
  quoteRefreshSecs: number;
  quoteYes: boolean;
  quoteNo: boolean;
}

// Overridable strategy fields (field-level partial)
export interface StrategyOverride {
  orderDepthLevel?: number;
  cancelDepthLevel?: number;
  minOrderSize?: number;
  maxPositionPerMarket?: number;
  spreadFraction?: number;
  quoteYes?: boolean;
  quoteNo?: boolean;
}

// Manually managed market (persisted in DB)
export interface ManagedMarket {
  conditionId: string;
  slug: string;
  question: string;
  tokens: MarketToken[];
  negRisk: boolean;
  active: boolean;
  rewardsMaxSpread: number;
  rewardsMinSize: number;
  dailyRate: number;
  liquidity: number;
  addedAt: number;
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

export interface ClobRewardData {
  conditionId: string;
  rewardsMaxSpread: Decimal;
  rewardsMinSize: Decimal;
  totalDailyRate: Decimal;
}

export interface TokenQuote {
  bidPrice: Decimal;
  askPrice: Decimal;
  size: Decimal;
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
      type: "managed_markets";
      markets: ManagedMarket[];
    }
  | {
      type: "market_added";
      market: ManagedMarket;
    }
  | {
      type: "market_removed";
      conditionId: string;
    }
  | {
      type: "overrides_update";
      accountOverrides: Record<string, StrategyOverride>;
      marketOverrides: Record<string, StrategyOverride>;
    }
  | {
      type: "config_update";
      config: StrategyConfig;
    }
  | {
      type: "account_configs";
      configs: AccountMeta[];
    };
