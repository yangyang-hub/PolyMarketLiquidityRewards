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
      <div className="flex h-full items-center justify-center terminal-data terminal-muted">
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
  const spread = book.bids.length > 0 && book.asks.length > 0
    ? book.asks[0].price - book.bids[0].price
    : 0;

  return (
    <div className="terminal-data">
      <div className="grid grid-cols-3 border-b border-[var(--terminal-border)] px-3 py-2 terminal-label">
        <span>价格</span>
        <span className="text-right">数量</span>
        <span className="text-right">金额</span>
      </div>

      {askRows.map((level, i) => {
        const isHighlighted = highlightPrices?.has(level.price);
        const barWidth = (level.size / maxSize) * 100;
        return (
          <div
            key={`ask-${level.price}-${i}`}
            className={`relative grid grid-cols-3 px-3 py-1.5 hover:bg-[var(--terminal-panel-high)] ${
              isHighlighted ? "bg-[rgba(255,179,178,0.12)]" : ""
            }`}
          >
            <div
              className="absolute inset-y-0 right-0 bg-[rgba(255,82,94,0.09)]"
              style={{ width: `${barWidth}%` }}
            />
            <span className="relative z-10 terminal-negative">{level.price.toFixed(3)}</span>
            <span className="relative z-10 text-right text-[var(--terminal-text)]">
              {level.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="relative z-10 text-right terminal-muted">
              {(level.price * level.size).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        );
      })}

      <div className="border-y border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-3 py-1 text-center terminal-label">
        价差：{spread.toFixed(3)}
      </div>

      {bidRows.map((level, i) => {
        const isHighlighted = highlightPrices?.has(level.price);
        const barWidth = (level.size / maxSize) * 100;
        return (
          <div
            key={`bid-${level.price}-${i}`}
            className={`relative grid grid-cols-3 px-3 py-1.5 hover:bg-[var(--terminal-panel-high)] ${
              isHighlighted ? "bg-[rgba(102,223,117,0.12)]" : ""
            }`}
          >
            <div
              className="absolute inset-y-0 right-0 bg-[rgba(102,223,117,0.08)]"
              style={{ width: `${barWidth}%` }}
            />
            <span className="relative z-10 terminal-positive">{level.price.toFixed(3)}</span>
            <span className="relative z-10 text-right text-[var(--terminal-text)]">
              {level.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="relative z-10 text-right terminal-muted">
              {(level.price * level.size).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
