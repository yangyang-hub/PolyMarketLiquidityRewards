"use client";

import { useState, useEffect, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import OverrideEditor from "@/components/OverrideEditor";
import OrderBookView from "@/components/OrderBookView";
import type { ManagedMarketDto, StrategyOverride, OrderBookDto } from "@/types";

export default function MarketsPage() {
  const managedMarkets = useAppStore((s) => s.managedMarkets);
  const marketOverrides = useAppStore((s) => s.marketOverrides);
  const config = useAppStore((s) => s.config);
  const selectedTokenId = useAppStore((s) => s.selectedMarketTokenId);
  const setSelectedMarketToken = useAppStore((s) => s.setSelectedMarketToken);
  const orderbooks = useAppStore((s) => s.orderbooks);
  const orderbookSeq = useAppStore((s) => s.orderbookSeq);
  const setOrderbooks = useAppStore((s) => s.setOrderbooks);
  const accounts = useAppStore((s) => s.accounts);
  const { post, put, del } = useApi();

  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);

  // Auto-select first token if nothing is selected
  useEffect(() => {
    if (!selectedTokenId && managedMarkets.length > 0 && managedMarkets[0].tokens.length > 0) {
      setSelectedMarketToken(managedMarkets[0].tokens[0].token_id);
    }
  }, [selectedTokenId, managedMarkets, setSelectedMarketToken]);

  // Fetch orderbooks from REST API on mount as fallback for WS data
  useEffect(() => {
    if (managedMarkets.length === 0) return;
    // Check if we already have orderbook data for any token
    const hasAnyBook = managedMarkets.some((m) =>
      m.tokens.some((t) => orderbooks[t.token_id]),
    );
    if (hasAnyBook) return; // WS already populated data

    fetch("/api/markets/orderbooks")
      .then((res) => res.json())
      .then((data) => {
        if (data?.orderbooks && Object.keys(data.orderbooks).length > 0) {
          setOrderbooks(data.orderbooks);
        }
      })
      .catch((e) => console.error("Orderbook REST fallback failed:", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedMarkets.length]);

  // Pulse animation when new orderbook data arrives
  const [pulse, setPulse] = useState(false);
  const prevSeq = useRef(orderbookSeq);
  useEffect(() => {
    if (orderbookSeq !== prevSeq.current) {
      prevSeq.current = orderbookSeq;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 800);
      return () => clearTimeout(t);
    }
  }, [orderbookSeq]);

  const selectedBook = selectedTokenId ? orderbooks[selectedTokenId] : null;

  // Find the selected token's market and outcome for the OrderBook header
  let selectedTokenLabel = "";
  for (const m of managedMarkets) {
    const token = m.tokens.find((t) => t.token_id === selectedTokenId);
    if (token) {
      selectedTokenLabel = `${m.question.slice(0, 30)}${m.question.length > 30 ? "..." : ""} — ${token.outcome}`;
      break;
    }
  }

  // Collect highlighted prices (our active order prices)
  const highlightPrices = new Set<number>();
  for (const acc of accounts) {
    for (const order of acc.activeOrders) {
      if (order.tokenId === selectedTokenId) {
        highlightPrices.add(order.price);
      }
    }
  }

  const handleAdd = async () => {
    if (!input.trim()) return;
    setAdding(true);
    setAddError("");
    try {
      await post("/api/markets", { input: input.trim() });
      setInput("");
    } catch (e: any) {
      setAddError(e.message || "添加失败");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (conditionId: string) => {
    try {
      await del(`/api/markets/${conditionId}`);
      setDeleteTarget(null);
    } catch (e: any) {
      console.error("Delete failed:", e.message);
    }
  };

  const handleSaveOverride = async (conditionId: string, override: StrategyOverride) => {
    setSavingOverride(true);
    try {
      await put(`/api/markets/${conditionId}`, { overrides: override });
    } catch (e: any) {
      console.error("Save override failed:", e.message);
    } finally {
      setSavingOverride(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">市场管理</h2>
          <p className="text-sm opacity-60">
            共 {managedMarkets.length} 个市场
          </p>
        </div>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => post("/api/markets/refresh")}
        >
          刷新奖励
        </button>
      </div>

      {/* Add Market */}
      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-4">
          <div className="flex gap-2">
            <input
              type="text"
              className="input input-bordered input-sm flex-1 font-mono"
              placeholder="输入 condition_id 或 slug 添加市场"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAdd}
              disabled={adding || !input.trim()}
            >
              {adding ? <span className="loading loading-spinner loading-xs" /> : "添加"}
            </button>
          </div>
          {addError && (
            <div className="text-xs text-error mt-1">{addError}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Market Cards */}
        <div className="xl:col-span-2 space-y-3">
          {managedMarkets.length === 0 ? (
            <div className="card bg-base-100 shadow-sm border border-base-300">
              <div className="card-body items-center text-center py-12">
                <p className="text-sm opacity-50">暂无市场，通过上方输入框添加。</p>
              </div>
            </div>
          ) : (
            managedMarkets.map((m) => (
              <MarketCard
                key={m.conditionId}
                market={m}
                override={marketOverrides[m.conditionId] || {}}
                globalConfig={config}
                orderbooks={orderbooks}
                selectedTokenId={selectedTokenId}
                savingOverride={savingOverride}
                onSelectToken={setSelectedMarketToken}
                onSaveOverride={(o) => handleSaveOverride(m.conditionId, o)}
                onDelete={() => setDeleteTarget(m.conditionId)}
              />
            ))
          )}
        </div>

        {/* Order Book */}
        <div className="card bg-base-100 shadow-sm border border-base-300 h-fit sticky top-4">
          <div className="card-body p-4">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
              盘口深度
              {selectedBook && (
                <span className="text-xs opacity-40 font-normal">
                  {new Date(selectedBook.timestamp).toLocaleTimeString()}
                </span>
              )}
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  pulse ? "bg-success" : "bg-base-300"
                }`}
                title={`WS updates: ${orderbookSeq}`}
              />
            </h3>
            {selectedTokenLabel && (
              <div className="text-xs opacity-50 -mt-1 mb-1 truncate">
                {selectedTokenLabel}
              </div>
            )}
            <OrderBookView
              book={selectedBook || null}
              highlightPrices={highlightPrices}
            />
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg">确认删除</h3>
            <p className="py-4 text-sm">
              确定要移除此市场吗？关联的策略覆盖也将一并删除。
            </p>
            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                className="btn btn-error btn-sm"
                onClick={() => handleDelete(deleteTarget)}
              >
                确认删除
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setDeleteTarget(null)} />
        </div>
      )}
    </div>
  );
}

// --- Market Card Component ---

function MarketCard({
  market,
  override,
  globalConfig,
  orderbooks,
  selectedTokenId,
  savingOverride,
  onSelectToken,
  onSaveOverride,
  onDelete,
}: {
  market: ManagedMarketDto;
  override: StrategyOverride;
  globalConfig: ReturnType<typeof useAppStore.getState>["config"];
  orderbooks: Record<string, OrderBookDto>;
  selectedTokenId: string | null;
  savingOverride: boolean;
  onSelectToken: (tokenId: string) => void;
  onSaveOverride: (o: StrategyOverride) => void;
  onDelete: () => void;
}) {
  const [showOverrides, setShowOverrides] = useState(false);
  const overrideCount = Object.keys(override).length;

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body p-4 space-y-3">
        {/* Title Row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm leading-tight line-clamp-2">
              {market.question}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono opacity-40">{market.slug}</span>
              {market.negRisk && (
                <span className="badge badge-warning badge-xs">negRisk</span>
              )}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-xs btn-square text-error shrink-0"
            onClick={onDelete}
            title="删除市场"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-base-200/60 rounded px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider opacity-40">日收益</div>
            <div className="text-xs font-mono font-semibold">${market.dailyRate.toFixed(2)}</div>
          </div>
          <div className="bg-base-200/60 rounded px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider opacity-40">最大价差</div>
            <div className="text-xs font-mono font-semibold">{market.rewardsMaxSpread.toFixed(3)}</div>
          </div>
          <div className="bg-base-200/60 rounded px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider opacity-40">最小量</div>
            <div className="text-xs font-mono font-semibold">{market.rewardsMinSize.toFixed(1)}</div>
          </div>
          <div className="bg-base-200/60 rounded px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider opacity-40">流动性</div>
            <div className="text-xs font-mono font-semibold">${(market.liquidity || 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Token Orderbook Info */}
        <div className="space-y-1.5">
          {market.tokens.map((t) => {
            const book = orderbooks[t.token_id];
            const bestBid = book?.bids?.[0];
            const bestAsk = book?.asks?.[0];
            const spread = bestBid && bestAsk ? (bestAsk.price - bestBid.price) : null;
            const isSelected = t.token_id === selectedTokenId;

            return (
              <div
                key={t.token_id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                  isSelected ? "border-primary/40 bg-primary/5" : "border-base-300 hover:border-base-content/20"
                }`}
                onClick={() => onSelectToken(t.token_id)}
              >
                <span className={`badge badge-sm ${isSelected ? "badge-primary" : "badge-ghost"}`}>
                  {t.outcome}
                </span>
                {book ? (
                  <div className="flex items-center gap-4 flex-1 text-xs font-mono">
                    <span className="text-success">
                      B {bestBid ? bestBid.price.toFixed(2) : "—"}
                    </span>
                    <span className="text-error">
                      A {bestAsk ? bestAsk.price.toFixed(2) : "—"}
                    </span>
                    <span className="opacity-50">
                      差 {spread !== null ? spread.toFixed(3) : "—"}
                    </span>
                    <span className="opacity-30 ml-auto">
                      {new Date(book.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs opacity-30">等待盘口数据...</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Override Toggle */}
        <button
          className="btn btn-ghost btn-xs gap-1 -ml-1"
          onClick={() => setShowOverrides(!showOverrides)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3 w-3 transition-transform ${showOverrides ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          策略覆盖
          {overrideCount > 0 && (
            <span className="badge badge-primary badge-xs">{overrideCount}</span>
          )}
        </button>

        {showOverrides && (
          <OverrideEditor
            value={override}
            globalConfig={globalConfig}
            onSave={onSaveOverride}
            saving={savingOverride}
          />
        )}
      </div>
    </div>
  );
}
