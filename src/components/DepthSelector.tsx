"use client";

const levelLabels = ["禁用", "1档", "2档", "3档", "4档", "5档"];

export default function DepthSelector({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs opacity-50 mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex gap-1.5">
        {levelLabels.map((lbl, i) => {
          const active = i === value;
          return (
            <button
              key={i}
              onClick={() => onChange(i)}
              className={`
                flex-1 py-1.5 rounded-lg text-xs font-mono transition-all
                ${active
                  ? "bg-primary text-primary-content shadow-sm"
                  : "bg-base-200 hover:bg-base-300 opacity-70 hover:opacity-100"
                }
              `}
            >
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}
