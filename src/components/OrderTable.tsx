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
    return (
      <div className="text-center text-sm opacity-60 py-4">
        暂无活跃订单
      </div>
    );
  }

  return (
    <div>
      {onCancelAll && orders.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            className="btn btn-ghost btn-xs text-error"
            onClick={handleCancelAll}
            disabled={cancellingAll}
          >
            {cancellingAll ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "全部取消"
            )}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>市场</th>
              <th>方向</th>
              <th>价格</th>
              <th>数量</th>
              <th>计分</th>
              <th>状态</th>
              {onCancelOrder && <th></th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.orderId}>
                <td className="max-w-32 truncate" title={order.marketSlug}>
                  {order.marketSlug}
                </td>
                <td>
                  <span
                    className={
                      order.side === "buy" ? "text-success" : "text-error"
                    }
                  >
                    {order.side === "buy" ? "买入" : "卖出"}
                  </span>
                </td>
                <td className="font-mono">{order.price.toFixed(3)}</td>
                <td className="font-mono">{order.size.toFixed(2)}</td>
                <td>
                  <span
                    className={`badge badge-xs ${order.scoring ? "badge-success" : "badge-ghost"}`}
                  >
                    {order.scoring ? "是" : "否"}
                  </span>
                </td>
                <td>
                  <StatusBadge status={order.status} />
                </td>
                {onCancelOrder && (
                  <td>
                    <button
                      className="btn btn-ghost btn-xs text-error opacity-60 hover:opacity-100"
                      onClick={() => handleCancel(order.orderId)}
                      disabled={cancelling.has(order.orderId) || cancellingAll}
                      title="取消此订单"
                    >
                      {cancelling.has(order.orderId) ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
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
