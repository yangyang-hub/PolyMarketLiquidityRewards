"use client";

import { useState, useEffect } from "react";
import type { StrategyOverride, StrategyConfig } from "@/types";

interface OverrideEditorProps {
  value: StrategyOverride;
  globalConfig: StrategyConfig | null;
  onSave: (override: StrategyOverride) => void;
  saving?: boolean;
}

interface FieldDef {
  key: keyof StrategyOverride;
  label: string;
  type: "number" | "boolean";
  step?: number;
  min?: number;
  max?: number;
}

const FIELDS: FieldDef[] = [
  { key: "orderDepthLevel", label: "挂单档位", type: "number", min: 0, step: 1 },
  { key: "cancelDepthLevel", label: "撤单档位", type: "number", min: 0, step: 1 },
  { key: "minOrderSize", label: "最小挂单金额", type: "number", min: 0, step: 1 },
  { key: "maxPositionPerMarket", label: "每市场最大仓位", type: "number", min: 0, step: 10 },
  { key: "quoteYes", label: "YES 方向", type: "boolean" },
  { key: "quoteNo", label: "NO 方向", type: "boolean" },
];

export default function OverrideEditor({
  value,
  globalConfig,
  onSave,
  saving,
}: OverrideEditorProps) {
  const [local, setLocal] = useState<StrategyOverride>({ ...value });

  useEffect(() => {
    setLocal({ ...value });
  }, [value]);

  const isEnabled = (key: keyof StrategyOverride) => local[key] !== undefined;

  const toggleField = (key: keyof StrategyOverride) => {
    setLocal((prev) => {
      const next = { ...prev };
      if (next[key] !== undefined) {
        delete next[key];
      } else {
        // Set to global default when enabling
        const globalVal = globalConfig ? (globalConfig as any)[key] : undefined;
        (next as any)[key] = globalVal ?? (FIELDS.find((f) => f.key === key)?.type === "boolean" ? true : 0);
      }
      return next;
    });
  };

  const updateValue = (key: keyof StrategyOverride, val: any) => {
    setLocal((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    // Clean undefined values
    const cleaned: StrategyOverride = {};
    for (const field of FIELDS) {
      if (local[field.key] !== undefined) {
        (cleaned as any)[field.key] = local[field.key];
      }
    }
    onSave(cleaned);
  };

  const hasChanges = JSON.stringify(local) !== JSON.stringify(value);

  return (
    <div className="space-y-2">
      {FIELDS.map((field) => {
        const enabled = isEnabled(field.key);
        const globalVal = globalConfig ? (globalConfig as any)[field.key] : "—";

        return (
          <div
            key={field.key}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
              enabled
                ? "border-primary/30 bg-primary/5"
                : "border-base-300 bg-base-200/30"
            }`}
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary"
              checked={enabled}
              onChange={() => toggleField(field.key)}
            />

            <span className={`text-sm min-w-[7rem] ${enabled ? "font-medium" : "opacity-50"}`}>
              {field.label}
            </span>

            <div className="flex-1">
              {field.type === "boolean" ? (
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={enabled ? !!local[field.key] : !!globalVal}
                  disabled={!enabled}
                  onChange={(e) => updateValue(field.key, e.target.checked)}
                />
              ) : (
                <input
                  type="number"
                  className="input input-bordered input-xs w-24 font-mono"
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  value={enabled ? (local[field.key] as number) : ""}
                  placeholder={String(globalVal)}
                  disabled={!enabled}
                  onChange={(e) => updateValue(field.key, parseFloat(e.target.value) || 0)}
                />
              )}
            </div>

            <span className="text-[10px] opacity-40 min-w-[3rem] text-right">
              {enabled ? "已覆盖" : `默认 ${globalVal}`}
            </span>
          </div>
        );
      })}

      {hasChanges && (
        <div className="flex justify-end gap-2 pt-2">
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setLocal({ ...value })}
          >
            重置
          </button>
          <button
            className="btn btn-primary btn-xs"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <span className="loading loading-spinner loading-xs" /> : "保存覆盖"}
          </button>
        </div>
      )}
    </div>
  );
}
