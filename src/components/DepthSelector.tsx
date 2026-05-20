"use client";

const levelLabels = ["关闭", "1档", "2档", "3档", "4档", "5档"];

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
    <div className="space-y-3">
      <div>
        <div className="terminal-label">{label}</div>
        {description && (
          <div className="terminal-data terminal-muted mt-1">{description}</div>
        )}
      </div>
      <div className="grid grid-cols-6 gap-px overflow-hidden border border-[var(--terminal-border)] bg-[var(--terminal-border)]">
        {levelLabels.map((lbl, i) => {
          const active = i === value;
          return (
            <button
              key={i}
              onClick={() => onChange(i)}
              className={`h-9 terminal-data transition-colors ${
                active
                  ? "bg-[var(--terminal-primary)] text-white"
                  : "bg-[var(--terminal-bg)] text-[var(--terminal-muted)] hover:bg-[var(--terminal-panel-high)] hover:text-[var(--terminal-text)]"
              }`}
            >
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}
