"use client";

import type { OrderEvent } from "@/types";
import { formatShanghaiTime } from "@/lib/time";

const typeColors: Record<string, string> = {
  placed: "text-[var(--terminal-primary-text)]",
  cancelled: "terminal-negative",
  filled: "terminal-positive",
  moved: "text-[var(--terminal-warning)]",
};

const typeLabels: Record<string, string> = {
  placed: "信息",
  cancelled: "警告",
  filled: "成交",
  moved: "移动",
};

export default function EventLog({ events }: { events: OrderEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center terminal-data terminal-muted">
        暂无事件
      </div>
    );
  }

  return (
    <div className="terminal-data">
      {events.slice(0, 80).map((event, i) => (
        <div
          key={`${event.orderId}-${event.timestamp}-${i}`}
          className={`grid grid-cols-[116px_72px_92px_64px_82px_90px_minmax(0,1fr)] gap-2 border-b border-[var(--terminal-border)] px-3 py-1.5 hover:bg-[var(--terminal-panel-high)] ${
            event.type === "cancelled" ? "bg-[rgba(255,82,94,0.12)]" : ""
          }`}
        >
          <span className="terminal-muted">
            {formatShanghaiTime(event.timestamp)}
          </span>
          <span className={typeColors[event.type] || "terminal-muted"}>
            {typeLabels[event.type] || event.type.toUpperCase()}
          </span>
          <span className="truncate terminal-muted">{event.accountName}</span>
          <span className={event.side === "buy" ? "terminal-positive" : "terminal-negative"}>
            {event.side === "buy" ? "买入" : "卖出"}
          </span>
          <span>${event.price.toFixed(3)}</span>
          <span>×{event.size.toFixed(2)}</span>
          <span className="truncate terminal-muted">
            {event.reason || `市场 ${event.tokenId.slice(0, 10)}`}
          </span>
        </div>
      ))}
    </div>
  );
}
