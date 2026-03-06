"use client";

import type { OrderBookDto } from "@/types";

export default function OrderBookView({
  book,
  highlightPrices,
}: {
  book: OrderBookDto | null;
  highlightPrices?: Set<number>;
}) {
  if (!book || (book.bids.length === 0 && book.asks.length === 0)) {
    return (
      <div className="text-center text-sm opacity-60 py-8">
        暂无盘口数据
      </div>
    );
  }

  const maxSize = Math.max(
    ...book.bids.map((b) => b.size),
    ...book.asks.map((a) => a.size),
    1,
  );

  const askRows = book.asks.slice(0, 10).reverse();
  const bidRows = book.bids.slice(0, 10);

  return (
    <div className="font-mono text-xs">
      {/* Header */}
      <div className="grid grid-cols-3 gap-1 px-2 py-1 text-opacity-60 border-b border-base-300">
        <span>价格</span>
        <span className="text-right">数量</span>
        <span className="text-right">金额</span>
      </div>

      {/* Asks (reversed so lowest is at bottom) */}
      {askRows.map((level, i) => {
        const isHighlighted = highlightPrices?.has(level.price);
        const barWidth = (level.size / maxSize) * 100;
        return (
          <div
            key={`ask-${i}`}
            className={`grid grid-cols-3 gap-1 px-2 py-0.5 relative ${isHighlighted ? "bg-warning/20" : ""}`}
          >
            <div
              className="absolute inset-y-0 right-0 bg-error/10"
              style={{ width: `${barWidth}%` }}
            />
            <span className="text-error relative z-10">
              {level.price.toFixed(3)}
            </span>
            <span className="text-right relative z-10">
              {level.size.toFixed(2)}
            </span>
            <span className="text-right opacity-60 relative z-10">
              ${(level.price * level.size).toFixed(2)}
            </span>
          </div>
        );
      })}

      {/* Spread */}
      {book.bids.length > 0 && book.asks.length > 0 && (
        <div className="px-2 py-1 text-center bg-base-200 text-xs opacity-60 border-y border-base-300">
          价差: {(book.asks[0].price - book.bids[0].price).toFixed(3)}
        </div>
      )}

      {/* Bids */}
      {bidRows.map((level, i) => {
        const isHighlighted = highlightPrices?.has(level.price);
        const barWidth = (level.size / maxSize) * 100;
        return (
          <div
            key={`bid-${i}`}
            className={`grid grid-cols-3 gap-1 px-2 py-0.5 relative ${isHighlighted ? "bg-warning/20" : ""}`}
          >
            <div
              className="absolute inset-y-0 right-0 bg-success/10"
              style={{ width: `${barWidth}%` }}
            />
            <span className="text-success relative z-10">
              {level.price.toFixed(3)}
            </span>
            <span className="text-right relative z-10">
              {level.size.toFixed(2)}
            </span>
            <span className="text-right opacity-60 relative z-10">
              ${(level.price * level.size).toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
