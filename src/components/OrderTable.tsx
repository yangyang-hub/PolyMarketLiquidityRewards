"use client";

import { useState } from "react";
import type { ActiveOrder } from "@/types";
import StatusBadge from "./StatusBadge";

export default function OrderTable({
  orders,
  onCancelOrder,
  onCancelAll,
}: {
  orders: ActiveOrder[];
  onCancelOrder?: (orderId: string) => Promise<void>;
  onCancelAll?: () => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [cancellingAll, setCancellingAll] = useState(false);

  const handleCancel = async (orderId: string) => {
    if (!onCancelOrder) return;
    setCancelling((s) => new Set(s).add(orderId));
    try {
      await onCancelOrder(orderId);
    } finally {
      setCancelling((s) => {
        const next = new Set(s);
        next.delete(orderId);
        return next;
      });
    }
  };

  const handleCancelAll = async () => {
    if (!onCancelAll) return;
    setCancellingAll(true);
    try {
      await onCancelAll();
    } finally {
      setCancellingAll(false);
    }
  };

  if (orders.length === 0) {
    return <div className="py-4 text-center terminal-data terminal-muted">暂无活跃订单</div>;
  }

  return (
    <div className="terminal-panel overflow-hidden">
      {onCancelAll && orders.length > 0 && (
        <div className="terminal-panel-header justify-end">
          <button
            className="terminal-action danger h-6 min-h-6 px-3"
            onClick={handleCancelAll}
            disabled={cancellingAll}
          >
            {cancellingAll ? "撤单中" : "全部撤单"}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full terminal-data">
          <thead>
            <tr className="border-b border-[var(--terminal-border)] terminal-label">
              <th className="px-3 py-2 text-left">市场</th>
              <th className="px-3 py-2 text-left">方向</th>
              <th className="px-3 py-2 text-right">价格</th>
              <th className="px-3 py-2 text-right">数量</th>
              <th className="px-3 py-2 text-left">计分</th>
              <th className="px-3 py-2 text-left">状态</th>
              {onCancelOrder && <th className="px-3 py-2 text-right">操作</th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.orderId} className="border-b border-[var(--terminal-border)] hover:bg-[var(--terminal-panel-high)]">
                <td className="max-w-48 truncate px-3 py-2 terminal-muted" title={order.tokenId}>
                  市场 {order.tokenId.slice(0, 10)}
                </td>
                <td className={`px-3 py-2 ${order.side === "buy" ? "terminal-positive" : "terminal-negative"}`}>
                  {order.side === "buy" ? "买入" : "卖出"}
                </td>
                <td className="px-3 py-2 text-right">{order.price.toFixed(3)}</td>
                <td className="px-3 py-2 text-right">{order.size.toFixed(2)}</td>
                <td className="px-3 py-2">
                  <span className={order.scoring ? "terminal-positive" : "terminal-dim"}>
                    {order.scoring ? "是" : "否"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={order.status} />
                </td>
                {onCancelOrder && (
                  <td className="px-3 py-2 text-right">
                    <button
                      className="terminal-action ghost h-6 min-h-6 px-2 text-[var(--terminal-negative)]"
                      onClick={() => handleCancel(order.orderId)}
                      disabled={cancelling.has(order.orderId) || cancellingAll}
                      title="取消此订单"
                    >
                      {cancelling.has(order.orderId) ? "..." : "撤单"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
