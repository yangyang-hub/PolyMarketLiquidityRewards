"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import DepthSelector from "@/components/DepthSelector";
import type { StrategyConfig } from "@/types";

function NumberField({
  label,
  hint,
  unit,
  value,
  step,
  min,
  max,
  onChange,
  overridable,
}: {
  label: string;
  hint?: string;
  unit?: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  overridable?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-sm flex items-center gap-1.5">
          {label}
          {overridable && (
            <span className="badge badge-outline badge-xs opacity-50">可覆盖</span>
          )}
        </span>
        {unit && <span className="text-xs opacity-40">{unit}</span>}
      </div>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        className="input input-bordered input-sm w-full font-mono"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      {hint && <div className="text-xs opacity-40">{hint}</div>}
    </div>
  );
}

export default function SettingsPage() {
  const config = useAppStore((s) => s.config);
  const { put } = useApi();
  const [local, setLocal] = useState<StrategyConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config && !local) {
      setLocal({ ...config });
    }
  }, [config, local]);

  if (!local) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  const update = <K extends keyof StrategyConfig>(
    key: K,
    value: StrategyConfig[K],
  ) => {
    setLocal({ ...local, [key]: value });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await put("/api/config", local);
    } catch (e: any) {
      console.error("Save failed:", e.message);
    }
    setSaving(false);
  };

  const handleReset = () => {
    if (config) setLocal({ ...config });
  };

  const hasChanges = config && JSON.stringify(local) !== JSON.stringify(config);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">策略设置</h2>
          <p className="text-sm opacity-50 mt-1">配置做市策略的挂单档位、资金和刷新参数</p>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Left: Depth + Quote direction */}
        <div className="space-y-5">
          {/* Depth */}
          <div className="card bg-base-100 shadow-sm border border-base-300">
            <div className="card-body p-5 space-y-5">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                <h3 className="font-semibold">档位设置</h3>
                <span className="badge badge-outline badge-xs opacity-50">可覆盖</span>
              </div>
              <DepthSelector
                label="挂单档位"
                description="在盘口第几档价格挂单，0 为中点报价模式"
                value={local.orderDepthLevel}
                onChange={(v) => update("orderDepthLevel", v)}
              />
              <div className="divider my-0" />
              <DepthSelector
                label="撤单档位"
                description="当挂单被推到第几档以内时，自动撤单并在目标档位重挂"
                value={local.cancelDepthLevel}
                onChange={(v) => update("cancelDepthLevel", v)}
              />
            </div>
          </div>

          {/* Quote direction */}
          <div className="card bg-base-100 shadow-sm border border-base-300">
            <div className="card-body p-5 space-y-4">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                <h3 className="font-semibold">报价方向</h3>
                <span className="badge badge-outline badge-xs opacity-50">可覆盖</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                    local.quoteYes
                      ? "border-success/40 bg-success/5"
                      : "border-base-300 opacity-60"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">YES 方向</div>
                    <div className="text-xs opacity-50">在买盘挂买单</div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-success toggle-sm"
                    checked={local.quoteYes}
                    onChange={(e) => update("quoteYes", e.target.checked)}
                  />
                </label>
                <label
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                    local.quoteNo
                      ? "border-error/40 bg-error/5"
                      : "border-base-300 opacity-60"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">NO 方向</div>
                    <div className="text-xs opacity-50">在卖盘挂卖单</div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-error toggle-sm"
                    checked={local.quoteNo}
                    onChange={(e) => update("quoteNo", e.target.checked)}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Sizing + Market filter */}
        <div className="space-y-5">
          {/* Order Sizing */}
          <div className="card bg-base-100 shadow-sm border border-base-300">
            <div className="card-body p-5 space-y-4">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <h3 className="font-semibold">资金参数</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <NumberField
                  label="最小挂单金额"
                  unit="USDC"
                  hint="单笔订单最低金额"
                  value={local.minOrderSize}
                  onChange={(v) => update("minOrderSize", v)}
                  overridable
                />
                <NumberField
                  label="每市场最大仓位"
                  unit="USDC"
                  hint="单个市场单侧最大持仓"
                  value={local.maxPositionPerMarket}
                  onChange={(v) => update("maxPositionPerMarket", v)}
                  overridable
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom save bar */}
      {hasChanges && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between bg-base-100 border border-base-300 rounded-xl shadow-lg px-5 py-3">
            <span className="text-sm opacity-60">有未保存的修改</span>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={handleReset}>
                重置
              </button>
              <button
                className={`btn btn-primary btn-sm ${saving ? "loading" : ""}`}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
