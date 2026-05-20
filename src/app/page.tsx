"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import EventLog from "@/components/EventLog";
import OrderBookView from "@/components/OrderBookView";

function SummaryTile({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "positive" | "negative" | "primary";
}) {
  const toneClass = {
    neutral: "text-[var(--terminal-text)]",
    positive: "terminal-positive",
    negative: "terminal-negative",
    primary: "text-[var(--terminal-primary-text)]",
  }[tone];

  return (
    <section className="terminal-panel flex min-h-[120px] flex-col p-3">
      <div className="terminal-label mb-2">{label}</div>
      <div className={`text-[28px] font-semibold leading-9 ${toneClass}`}>{value}</div>
      {detail && <div className="terminal-data terminal-muted mt-auto">{detail}</div>}
    </section>
  );
}

export default function DashboardPage() {
  const accounts = useAppStore((s) => s.accounts);
  const eventLog = useAppStore((s) => s.eventLog);
  const orderbooks = useAppStore((s) => s.orderbooks);
  const discoveredMarkets = useAppStore((s) => s.discoveredMarkets);
  const selectedMarketTokenId = useAppStore((s) => s.selectedMarketTokenId);
  const { post } = useApi();

  const activeOrders = accounts.flatMap((account) => account.activeOrders);
  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
  const runningAccounts = accounts.filter((account) => account.status === "running").length;
  const selectedBook =
    (selectedMarketTokenId && orderbooks[selectedMarketTokenId]) ||
    Object.values(orderbooks)[0] ||
    null;
  const selectedMarket = selectedBook
    ? discoveredMarkets.find((market) =>
        market.tokens.some((token) => token.token_id === selectedBook.tokenId),
      )
    : undefined;

  const highlightedPrices = useMemo(() => {
    if (!selectedBook) return undefined;
    return new Set(
      activeOrders
        .filter((order) => order.tokenId === selectedBook.tokenId)
        .map((order) => order.price),
    );
  }, [activeOrders, selectedBook]);

  const riskExposure = activeOrders.length > 20 ? "高" : activeOrders.length > 5 ? "中" : "低";
  const riskTone = riskExposure === "高" ? "negative" : riskExposure === "中" ? "primary" : "positive";

  return (
    <div className="flex h-full flex-col gap-px overflow-hidden bg-[var(--terminal-bg)] p-px">
      <div className="grid min-h-[120px] shrink-0 grid-cols-1 gap-px md:grid-cols-4">
        <SummaryTile
          label="总余额"
          value={`$${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          detail={`${runningAccounts}/${accounts.length} 个账户运行中`}
          tone="neutral"
        />
        <SummaryTile
          label="活跃订单"
          value={String(activeOrders.length)}
          detail="实时挂单数量"
          tone="primary"
        />
        <SummaryTile
          label="已订阅市场"
          value={String(discoveredMarkets.length)}
          detail="订单簿订阅数量"
          tone="neutral"
        />
        <SummaryTile
          label="风险暴露"
          value={riskExposure}
          detail={`${activeOrders.length} 个订单监控中`}
          tone={riskTone}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px xl:grid-cols-[1fr_425px]">
        <section className="terminal-panel min-h-0 overflow-hidden">
          <div className="terminal-panel-header">
            <div className="terminal-label">市场概览</div>
            <div className="flex items-center gap-2">
              {["1小时", "1日", "1周"].map((range) => (
                <button
                  key={range}
                  className={`h-8 border px-3 terminal-data ${
                    range === "1日"
                      ? "border-[var(--terminal-primary-text)] bg-[var(--terminal-primary-soft)] text-[var(--terminal-primary-text)]"
                      : "border-[var(--terminal-border)] text-[var(--terminal-muted)]"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="flex h-[calc(100%-28px)] items-center justify-center border border-dashed border-[var(--terminal-border)] m-3">
            <div className="text-center">
              <div className="terminal-label mb-2">
                {selectedBook ? "已选择订阅市场" : "市场数据加载中"}
              </div>
              <div className="terminal-data terminal-muted">
                {selectedBook
                  ? `${selectedBook.bids.length} 档买盘 / ${selectedBook.asks.length} 档卖盘`
                  : "暂无已订阅订单簿"}
              </div>
              {accounts.length === 0 && (
                <Link href="/accounts" className="terminal-action primary mt-4">
                  添加账户
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="terminal-panel min-h-0 overflow-hidden">
          <div className="terminal-panel-header">
            <div className="terminal-label">
              订单簿 {selectedMarket ? "（已选择市场）" : ""}
            </div>
            <span className="terminal-data terminal-positive">实时</span>
          </div>
          <div className="h-[calc(100%-28px)] overflow-auto">
            <OrderBookView book={selectedBook} highlightPrices={highlightedPrices} />
          </div>
        </section>
      </div>

      <section className="terminal-panel h-[214px] shrink-0 overflow-hidden">
        <div className="terminal-panel-header">
          <div className="terminal-label">事件日志</div>
          <div className="flex gap-2">
            <button className="terminal-action ghost" onClick={() => post("/api/batch/start-all")}>
              全部启动
            </button>
            <button className="terminal-action ghost" onClick={() => post("/api/batch/stop-all")}>
              全部停止
            </button>
          </div>
        </div>
        <div className="h-[calc(100%-28px)] overflow-auto">
          <EventLog events={eventLog} />
        </div>
      </section>
    </div>
  );
}
