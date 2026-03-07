import Decimal from "decimal.js";
import type { OrderBook, TokenQuote, StrategyConfig } from "../types";

// --- Size computation ---

/**
 * Compute order size for a given side.
 * - Buy cost  = price * size  (USDC)
 * - Sell cost = (1 - price) * size  (USDC, complement collateral)
 *
 * size = clamp(balance / unitCost, rewardsMinSize, maxPositionPerMarket)
 * Returns 0 if balance cannot cover rewardsMinSize.
 */
function computeSideSize(
  price: Decimal,
  isBuy: boolean,
  balance: Decimal,
  rewardsMinSize: Decimal,
  config: StrategyConfig,
): Decimal {
  const unitCost = isBuy ? price : new Decimal(1).minus(price);
  if (unitCost.isZero() || unitCost.isNeg()) return new Decimal(0);

  const affordable = balance.dividedBy(unitCost).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const minSize = Decimal.max(new Decimal(config.minOrderSize), rewardsMinSize);
  const maxSize = new Decimal(config.maxPositionPerMarket);

  // If balance can't cover minimum, skip
  if (affordable.lessThan(minSize)) return new Decimal(0);

  // Clamp: at least minSize, at most maxPositionPerMarket, at most affordable
  return Decimal.min(Decimal.max(affordable, minSize), maxSize);
}

// --- Depth-based quotes ---

export function computeDepthQuotes(
  book: OrderBook,
  depthLevel: number,
  rewardsMaxSpread: Decimal,
  _position: Decimal,
  config: StrategyConfig,
  rewardsMinSize: Decimal,
  balance: Decimal,
): TokenQuote | null {
  if (depthLevel < 1) return null;

  // Check sufficient depth
  if (book.bids.length < depthLevel || book.asks.length < depthLevel) {
    return null;
  }

  const bidPrice = book.bids[depthLevel - 1].price;
  const askPrice = book.asks[depthLevel - 1].price;

  // Validate: not crossed
  if (bidPrice.greaterThanOrEqualTo(askPrice)) return null;

  // Validate: price bounds
  const minPrice = new Decimal("0.01");
  const maxPrice = new Decimal("0.99");
  if (bidPrice.lessThan(minPrice) || askPrice.greaterThan(maxPrice)) return null;

  // Validate: within rewards_max_spread
  if (book.bids.length > 0 && book.asks.length > 0) {
    const mid = book.bids[0].price.plus(book.asks[0].price).dividedBy(2);
    if (mid.minus(bidPrice).greaterThan(rewardsMaxSpread)) return null;
    if (askPrice.minus(mid).greaterThan(rewardsMaxSpread)) return null;
  }

  // Size per side
  const bidSize = computeSideSize(bidPrice, true, balance, rewardsMinSize, config);
  const askSize = computeSideSize(askPrice, false, balance, rewardsMinSize, config);

  if (bidSize.isZero() && askSize.isZero()) return null;

  return { bidPrice, askPrice, bidSize, askSize };
}

// --- Cancel decision ---

export function shouldCancelDepthOrder(
  book: OrderBook,
  orderPrice: Decimal,
  isBuy: boolean,
  cancelDepthLevel: number,
): boolean {
  if (cancelDepthLevel === 0) return false;

  if (isBuy) {
    const above = book.bids.filter((level) =>
      level.price.greaterThan(orderPrice)
    ).length;
    const position = above + 1;
    return position <= cancelDepthLevel;
  } else {
    const below = book.asks.filter((level) =>
      level.price.lessThan(orderPrice)
    ).length;
    const position = below + 1;
    return position <= cancelDepthLevel;
  }
}
