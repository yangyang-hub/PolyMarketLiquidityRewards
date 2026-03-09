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

  // Only monitor buy orders
  if (!isBuy) return false;

  const above = book.bids.filter((level) =>
    level.price.greaterThan(orderPrice)
  ).length;
  const position = above + 1;
  const shouldCancel = position <= cancelDepthLevel;

  if (shouldCancel) {
    console.log(
      `[DepthStrategy] token=${book.tokenId.slice(0, 12)}... price=${orderPrice} position=买${position} cancelDepth=${cancelDepthLevel} → CANCEL`,
    );
  }

  return shouldCancel;
}
