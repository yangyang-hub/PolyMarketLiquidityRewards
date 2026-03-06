"use client";

import type { AccountState } from "@/types";
import StatusBadge from "./StatusBadge";

export default function AccountCard({
  account,
  onStart,
  onStop,
}: {
  account: AccountState;
  onStart: () => void;
  onStop: () => void;
}) {
  const isRunning = account.status === "running";

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{account.name}</h3>
            <p className="text-xs opacity-60 font-mono">
              {account.address
                ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
                : "—"}
            </p>
          </div>
          <StatusBadge status={account.status} />
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
          <div>
            <div className="text-xs opacity-60">余额</div>
            <div className="font-mono">${account.balance.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs opacity-60">挂单</div>
            <div className="font-mono">{account.activeOrders.length}</div>
          </div>
          <div>
            <div className="text-xs opacity-60">市场</div>
            <div className="font-mono">{account.marketsCount}</div>
          </div>
        </div>

        {account.error && (
          <div className="text-xs text-error mt-2">{account.error}</div>
        )}

        <div className="card-actions mt-3">
          {isRunning ? (
            <button
              className="btn btn-sm btn-outline btn-warning flex-1"
              onClick={onStop}
            >
              停止
            </button>
          ) : (
            <button
              className="btn btn-sm btn-primary flex-1"
              onClick={onStart}
              disabled={account.status === "stopping"}
            >
              启动
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
