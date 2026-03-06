"use client";

import type { ActiveOrder } from "@/types";
import StatusBadge from "./StatusBadge";

export default function OrderTable({ orders }: { orders: ActiveOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="text-center text-sm opacity-60 py-4">
        暂无活跃订单
      </div>
    );
  }

  return (
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
