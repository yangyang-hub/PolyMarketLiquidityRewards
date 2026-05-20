import Decimal from "decimal.js";
import type { OrderBook } from "../types";

const ZERO = new Decimal(0);

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
    const topBids = book.bids.slice(0, 5).map((l) => `${l.price}×${l.size}`).join(", ");
    console.log(
      `[DepthStrategy] CANCEL token=${book.tokenId.slice(0, 12)}... orderPrice=${orderPrice} position=买${position}/${book.bids.length}档 cancelDepth=${cancelDepthLevel} bids=[${topBids}]`,
    );
  }

  return shouldCancel;
}

export function bidNotionalAbovePrice(book: OrderBook, orderPrice: Decimal): Decimal {
  return sumNotional(
    book.bids.filter((level) => level.price.greaterThan(orderPrice)),
  );
}

export function protectedBidNotional(book: OrderBook, orderPrice: Decimal): Decimal {
  return sumNotional(
    book.bids.filter((level) => level.price.greaterThanOrEqualTo(orderPrice)),
  );
}

export function topBidNotional(book: OrderBook, levels: number): Decimal {
  if (levels <= 0) return ZERO;
  return sumNotional(book.bids.slice(0, levels));
}

export function shouldCancelMinBookNotional(
  book: OrderBook,
  orderPrice: Decimal,
  isBuy: boolean,
  minNotionalUsd: number,
): boolean {
  if (!isBuy || minNotionalUsd <= 0) return false;

  const notional = bidNotionalAbovePrice(book, orderPrice);
  const shouldCancel = notional.lessThan(minNotionalUsd);

  if (shouldCancel) {
    console.log(
      `[DepthStrategy] CANCEL token=${book.tokenId.slice(0, 12)}... orderPrice=${orderPrice} aboveBidNotional=$${notional.toDecimalPlaces(2)} min=$${minNotionalUsd}`,
    );
  }

  return shouldCancel;
}

function sumNotional(levels: { price: Decimal; size: Decimal }[]): Decimal {
  let total = ZERO;
  for (const level of levels) {
    total = total.plus(level.price.times(level.size));
  }
  return total;
}
