import Decimal from "decimal.js";
import type { OrderBook } from "../types";

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
