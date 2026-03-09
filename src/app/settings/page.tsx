"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import DepthSelector from "@/components/DepthSelector";
import type { StrategyConfig } from "@/types";

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
      <div>
        <h2 className="text-2xl font-bold">撤单设置</h2>
        <p className="text-sm opacity-50 mt-1">配置自动撤单的盘口档位参数</p>
      </div>

      {/* Cancel Depth */}
      <div className="max-w-md">
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-5 space-y-5">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
              <h3 className="font-semibold">撤单档位</h3>
            </div>
            <DepthSelector
              label="撤单档位"
              description="当挂单处于盘口前 N 档以内时，自动撤单。设为 0 禁用自动撤单。"
              value={local.cancelDepthLevel}
              onChange={(v) => setLocal({ ...local, cancelDepthLevel: v })}
            />
          </div>
        </div>
      </div>

      {/* Bottom save bar */}
      {hasChanges && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between bg-base-100 border border-base-300 rounded-xl shadow-lg px-5 py-3 max-w-md">
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
