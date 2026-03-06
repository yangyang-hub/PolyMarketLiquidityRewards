"use client";

import type { RewardMarketDto } from "@/types";

export default function MarketTable({
  markets,
  selectedTokenId,
  onSelect,
  onToggle,
}: {
  markets: RewardMarketDto[];
  selectedTokenId: string | null;
  onSelect: (tokenId: string) => void;
  onToggle?: (conditionId: string) => void;
}) {
  if (markets.length === 0) {
    return (
      <div className="text-center text-sm opacity-60 py-4">
        暂无奖励市场，点击刷新加载。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-xs">
        <thead>
          <tr>
            <th>启用</th>
            <th>市场</th>
            <th>日收益率</th>
            <th>密度</th>
            <th>最大价差</th>
            <th>最小挂单量</th>
            <th>流动性</th>
            <th>代币</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m) => {
            const firstTokenId = m.tokens?.[0]?.token_id;
            const isSelected = firstTokenId === selectedTokenId;
            return (
              <tr
                key={m.conditionId}
                className={`cursor-pointer hover ${isSelected ? "bg-primary/10" : ""} ${!m.enabled ? "opacity-50" : ""}`}
                onClick={() => firstTokenId && onSelect(firstTokenId)}
              >
                <td>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-primary"
                    checked={!!m.enabled}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggle?.(m.conditionId);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="max-w-48 truncate" title={m.question}>
                  {m.question}
                </td>
                <td className="font-mono">${m.dailyRate?.toFixed(2) || "—"}</td>
                <td className="font-mono">{m.density?.toFixed(4) || "—"}</td>
                <td className="font-mono">{m.maxSpread?.toFixed(2) || "—"}</td>
                <td className="font-mono">{m.minSize?.toFixed(2) || "—"}</td>
                <td className="font-mono">${(m.liquidity || 0).toLocaleString()}</td>
                <td>
                  <div className="flex gap-1">
                    {m.tokens?.map((t) => (
                      <button
                        key={t.token_id}
                        className={`badge badge-xs cursor-pointer ${
                          t.token_id === selectedTokenId
                            ? "badge-primary"
                            : "badge-ghost"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(t.token_id);
                        }}
                      >
                        {t.outcome}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
