"use client";

import type { AccountState } from "@/types";
import StatusBadge from "./StatusBadge";

function formatDisplayError(message: string): string {
  if (/[\u4e00-\u9fff]/.test(message)) return message;
  if (/key|signature|wallet/i.test(message)) return "密钥、签名或钱包配置异常";
  if (/network|fetch|connection|timeout/i.test(message)) return "网络连接异常，请稍后重试";
  return "运行异常，请查看后台日志";
}

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
    <div className="terminal-panel">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{account.name}</h3>
            <p className="terminal-data terminal-muted">
              {account.address
                ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
                : "—"}
            </p>
          </div>
          <StatusBadge status={account.status} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-px bg-[var(--terminal-border)] terminal-data">
          <div>
            <div className="bg-[var(--terminal-panel-soft)] p-2">
              <div className="terminal-label">余额</div>
              <div>${account.balance.toFixed(2)}</div>
            </div>
          </div>
          <div>
            <div className="bg-[var(--terminal-panel-soft)] p-2">
              <div className="terminal-label">挂单</div>
              <div>{account.activeOrders.length}</div>
            </div>
          </div>
          <div>
            <div className="bg-[var(--terminal-panel-soft)] p-2">
              <div className="terminal-label">市场</div>
              <div>{account.marketsCount}</div>
            </div>
          </div>
        </div>

        {account.error && (
          <div className="text-xs text-error mt-2">{formatDisplayError(account.error)}</div>
        )}

        <div className="mt-3">
          {isRunning ? (
            <button
              className="terminal-action w-full"
              onClick={onStop}
            >
              停止
            </button>
          ) : (
            <button
              className="terminal-action primary w-full"
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
