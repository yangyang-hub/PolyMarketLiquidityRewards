import Decimal from "decimal.js";
import type { OrderBook, TokenQuote, StrategyConfig } from "../types";

// --- Tick rounding helpers ---

function floorToTick(price: Decimal, tick: Decimal): Decimal {
  return price.dividedBy(tick).floor().times(tick);
}

function ceilToTick(price: Decimal, tick: Decimal): Decimal {
  return price.dividedBy(tick).ceil().times(tick);
}

// --- Midpoint-based quotes (order_depth_level=0) ---

export function computeQuotes(
  midpointPrice: Decimal,
  rewardsMaxSpread: Decimal,
  position: Decimal,
  config: StrategyConfig,
  rewardsMinSize: Decimal,
  tickSize: Decimal,
): TokenQuote | null {
  const halfSpread = rewardsMaxSpread
    .times(config.spreadFraction)
    .dividedBy(2);

  // Inventory skew
  const maxPos = new Decimal(config.maxPositionPerMarket);
  let inventoryRatio = new Decimal(0);
  if (maxPos.greaterThan(0)) {
    inventoryRatio = Decimal.min(
      Decimal.max(position.dividedBy(maxPos), new Decimal(-1)),
      new Decimal(1),
    );
  }

  const skewFactor = new Decimal(0.5); // default skew factor
  const skew = inventoryRatio.times(skewFactor).times(halfSpread);

  const bidHalf = halfSpread.plus(skew);
  const askHalf = halfSpread.minus(skew);

  let bidPrice = floorToTick(midpointPrice.minus(bidHalf), tickSize);
  let askPrice = ceilToTick(midpointPrice.plus(askHalf), tickSize);

  // Clamp to [0.01, 0.99]
  const minPrice = new Decimal("0.01");
  const maxPrice = new Decimal("0.99");
  bidPrice = Decimal.max(bidPrice, minPrice);
  askPrice = Decimal.min(askPrice, maxPrice);

  // Validate: not crossed
  if (bidPrice.greaterThanOrEqualTo(askPrice)) return null;

  // Validate: within rewards_max_spread of midpoint
  if (midpointPrice.minus(bidPrice).greaterThan(rewardsMaxSpread)) return null;
  if (askPrice.minus(midpointPrice).greaterThan(rewardsMaxSpread)) return null;

  // Size
  const minSize = Decimal.max(new Decimal(config.minOrderSize), rewardsMinSize);
  const size = Decimal.max(new Decimal(config.maxPositionPerMarket), minSize);

  return { bidPrice, askPrice, size };
}

// --- Depth-based quotes (order_depth_level > 0) ---

export function computeDepthQuotes(
  book: OrderBook,
  depthLevel: number,
  rewardsMaxSpread: Decimal,
  _position: Decimal,
  config: StrategyConfig,
  rewardsMinSize: Decimal,
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
  // Use best bid/ask midpoint for spread check
  if (book.bids.length > 0 && book.asks.length > 0) {
    const mid = book.bids[0].price.plus(book.asks[0].price).dividedBy(2);
    if (mid.minus(bidPrice).greaterThan(rewardsMaxSpread)) return null;
    if (askPrice.minus(mid).greaterThan(rewardsMaxSpread)) return null;
  }

  // Size
  const minSize = Decimal.max(new Decimal(config.minOrderSize), rewardsMinSize);
  const size = Decimal.max(new Decimal(config.maxPositionPerMarket), minSize);

  return { bidPrice, askPrice, size };
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
    // Count bids with price strictly above our order
    const above = book.bids.filter((level) =>
      level.price.greaterThan(orderPrice)
    ).length;
    const position = above + 1;
    return position <= cancelDepthLevel;
  } else {
    // Count asks with price strictly below our order
    const below = book.asks.filter((level) =>
      level.price.lessThan(orderPrice)
    ).length;
    const position = below + 1;
    return position <= cancelDepthLevel;
  }
}
