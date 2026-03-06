"use client";

import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import MarketTable from "@/components/MarketTable";
import OrderBookView from "@/components/OrderBookView";

export default function MarketsPage() {
  const rewardMarkets = useAppStore((s) => s.rewardMarkets);
  const selectedTokenId = useAppStore((s) => s.selectedMarketTokenId);
  const setSelectedMarketToken = useAppStore((s) => s.setSelectedMarketToken);
  const orderbooks = useAppStore((s) => s.orderbooks);
  const { post } = useApi();

  const selectedBook = selectedTokenId ? orderbooks[selectedTokenId] : null;

  const enabledCount = rewardMarkets.filter((m) => m.enabled).length;

  const handleToggle = async (conditionId: string) => {
    await post(`/api/markets/${conditionId}/toggle`);
  };

  // Collect highlighted prices (our active order prices)
  const accounts = useAppStore((s) => s.accounts);
  const highlightPrices = new Set<number>();
  for (const acc of accounts) {
    for (const order of acc.activeOrders) {
      if (order.tokenId === selectedTokenId) {
        highlightPrices.add(order.price);
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">奖励市场</h2>
          <p className="text-sm opacity-60">
            已启用 {enabledCount} / 共 {rewardMarkets.length} 个市场
          </p>
        </div>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => post("/api/markets/refresh")}
        >
          刷新市场
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Market Table */}
        <div className="xl:col-span-2 card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <MarketTable
              markets={rewardMarkets}
              selectedTokenId={selectedTokenId}
              onSelect={setSelectedMarketToken}
              onToggle={handleToggle}
            />
          </div>
        </div>

        {/* Order Book */}
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm mb-2">
              盘口深度
              {selectedTokenId && (
                <span className="ml-2 font-mono text-xs opacity-60">
                  {selectedTokenId.slice(0, 8)}...
                </span>
              )}
            </h3>
            <OrderBookView
              book={selectedBook || null}
              highlightPrices={highlightPrices}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
