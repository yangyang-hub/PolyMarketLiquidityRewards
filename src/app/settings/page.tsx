"use client";

import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import DepthSelector from "@/components/DepthSelector";
import type { StrategyConfig } from "@/types";

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="form-control w-full">
      <div className="label py-1">
        <span className="label-text text-xs opacity-70">{label}</span>
      </div>
      <div className="join w-full">
        {prefix && <span className="join-item btn btn-sm btn-ghost pointer-events-none">{prefix}</span>}
        <input
          type="number"
          className="input input-bordered input-sm join-item w-full font-mono"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="join-item btn btn-sm btn-ghost pointer-events-none">{suffix}</span>}
      </div>
    </label>
  );
}

export default function SettingsPage() {
  const config = useAppStore((s) => s.config);

  if (!config) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return <SettingsEditor config={config} />;
}

function SettingsEditor({ config }: { config: StrategyConfig }) {
  const { put } = useApi();
  const [local, setLocal] = useState<StrategyConfig>(() => ({ ...config }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await put("/api/config", local);
    } catch (e: unknown) {
      console.error("Save failed:", e instanceof Error ? e.message : e);
    }
    setSaving(false);
  };

  const handleReset = () => {
    setLocal({ ...config });
  };

  const updateField = <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const hasChanges = JSON.stringify(local) !== JSON.stringify(config);

  return (
    <div className="min-h-full space-y-4 bg-[var(--terminal-bg)] p-4">
      {/* Header */}
      <div>
        <h2 className="text-[22px] font-semibold">撤单设置</h2>
        <p className="terminal-data terminal-muted mt-1">配置自动撤单、盘口量检测和挂单重置参数</p>
      </div>

      <div className="grid max-w-5xl grid-cols-1 gap-px xl:grid-cols-2">
        <div className="terminal-panel">
          <div className="card-body p-5 space-y-5">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
              <h3 className="font-semibold">撤单档位</h3>
            </div>
            <DepthSelector
              label="撤单档位"
              description="当挂单处于盘口前 N 档以内时，自动撤单。设为 0 禁用自动撤单。"
              value={local.cancelDepthLevel}
              onChange={(v) => updateField("cancelDepthLevel", v)}
            />
          </div>
        </div>

        <div className="terminal-panel">
          <div className="card-body p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" /></svg>
              <h3 className="font-semibold">最低盘口量</h3>
            </div>
            <NumberField
              label="订单价格上方买盘金额"
              value={local.minBookNotionalUsd}
              min={0}
              step={100}
              prefix="$"
              onChange={(v) => updateField("minBookNotionalUsd", v)}
            />
          </div>
        </div>

        <div className="terminal-panel">
          <div className="card-body p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>
              <h3 className="font-semibold">买盘量变化</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumberField
                label="检测窗口"
                value={local.volumeDropWindowSec}
                min={1}
                max={120}
                suffix="秒"
                onChange={(v) => updateField("volumeDropWindowSec", v)}
              />
              <NumberField
                label="骤降比例"
                value={local.volumeDropPercent}
                min={0}
                max={100}
                suffix="%"
                onChange={(v) => updateField("volumeDropPercent", v)}
              />
            </div>
          </div>
        </div>

        <div className="terminal-panel">
          <div className="card-body p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8M14 7h7v7" /></svg>
              <h3 className="font-semibold">成交速度</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumberField
                label="检测窗口"
                value={local.buyPressureWindowSec}
                min={1}
                max={120}
                suffix="秒"
                onChange={(v) => updateField("buyPressureWindowSec", v)}
              />
              <NumberField
                label="连续买入金额"
                value={local.buyPressureUsd}
                min={0}
                step={100}
                prefix="$"
                onChange={(v) => updateField("buyPressureUsd", v)}
              />
            </div>
          </div>
        </div>

        <div className="terminal-panel">
          <div className="card-body p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m4 6V7m4 10V3M5 17v-2" /></svg>
              <h3 className="font-semibold">撤单跟随</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <NumberField
                label="检测窗口"
                value={local.cancelFollowWindowSec}
                min={1}
                max={120}
                suffix="秒"
                onChange={(v) => updateField("cancelFollowWindowSec", v)}
              />
              <NumberField
                label="撤量比例"
                value={local.cancelFollowDropPercent}
                min={0}
                max={100}
                suffix="%"
                onChange={(v) => updateField("cancelFollowDropPercent", v)}
              />
              <NumberField
                label="买盘档数"
                value={local.cancelFollowDepthLevels}
                min={1}
                max={100}
                suffix="档"
                onChange={(v) => updateField("cancelFollowDepthLevels", v)}
              />
            </div>
          </div>
        </div>

        <div className="terminal-panel">
          <div className="card-body p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.343 4.343L4 6m0 9a8 8 0 0013.657 4.657L20 18" /></svg>
                <h3 className="font-semibold">挂单重置</h3>
              </div>
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={local.orderResetEnabled}
                onChange={(e) => updateField("orderResetEnabled", e.target.checked)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumberField
                label="最短时间"
                value={local.orderResetMinMinutes}
                min={1}
                max={1440}
                suffix="分钟"
                onChange={(v) => updateField("orderResetMinMinutes", v)}
              />
              <NumberField
                label="最长时间"
                value={local.orderResetMaxMinutes}
                min={1}
                max={1440}
                suffix="分钟"
                onChange={(v) => updateField("orderResetMaxMinutes", v)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom save bar */}
      {hasChanges && (
        <div className="sticky bottom-4 z-10">
          <div className="terminal-panel flex max-w-5xl items-center justify-between px-5 py-3">
            <span className="terminal-data terminal-muted">有未保存的修改</span>
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
