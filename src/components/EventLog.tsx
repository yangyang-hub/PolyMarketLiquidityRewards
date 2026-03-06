"use client";

import type { OrderEvent } from "@/types";

export default function EventLog({ events }: { events: OrderEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center text-sm opacity-60 py-4">
        暂无事件
      </div>
    );
  }

  const typeColors: Record<string, string> = {
    placed: "text-info",
    cancelled: "text-warning",
    filled: "text-success",
    moved: "text-accent",
  };

  const typeLabels: Record<string, string> = {
    placed: "挂单",
    cancelled: "撤单",
    filled: "成交",
    moved: "移动",
  };

  return (
    <div className="overflow-y-auto max-h-64 text-xs font-mono space-y-0.5">
      {events.slice(0, 50).map((event, i) => (
        <div
          key={`${event.orderId}-${event.timestamp}-${i}`}
          className="flex gap-2 px-2 py-0.5 hover:bg-base-200"
        >
          <span className="opacity-40 w-16 shrink-0">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
          <span className={`w-16 shrink-0 ${typeColors[event.type] || ""}`}>
            {typeLabels[event.type] || event.type}
          </span>
          <span className="opacity-60 w-16 shrink-0">{event.accountName}</span>
          <span
            className={event.side === "buy" ? "text-success" : "text-error"}
          >
            {event.side === "buy" ? "买入" : "卖出"}
          </span>
          <span>${event.price.toFixed(3)}</span>
          <span>x{event.size.toFixed(2)}</span>
          <span className="opacity-40 truncate">{event.marketSlug}</span>
        </div>
      ))}
    </div>
  );
}
