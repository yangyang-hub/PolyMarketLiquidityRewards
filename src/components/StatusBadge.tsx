"use client";

export default function StatusBadge({
  status,
}: {
  status: string;
}) {
  const colorMap: Record<string, string> = {
    idle: "border-[var(--terminal-border-strong)] bg-transparent text-[var(--terminal-dim)]",
    running: "border-[rgba(102,223,117,0.4)] bg-[rgba(102,223,117,0.12)] text-[var(--terminal-positive)]",
    stopping: "border-[rgba(255,179,178,0.4)] bg-[rgba(255,179,178,0.12)] text-[var(--terminal-warning)]",
    error: "border-[rgba(255,82,94,0.4)] bg-[rgba(255,82,94,0.12)] text-[var(--terminal-negative)]",
    open: "border-[rgba(173,199,255,0.4)] bg-[rgba(173,199,255,0.12)] text-[var(--terminal-primary-text)]",
    filled: "border-[rgba(102,223,117,0.4)] bg-[rgba(102,223,117,0.12)] text-[var(--terminal-positive)]",
    cancelled: "border-[var(--terminal-border-strong)] bg-transparent text-[var(--terminal-dim)]",
  };

  const labelMap: Record<string, string> = {
    idle: "空闲",
    running: "运行中",
    stopping: "停止中",
    error: "错误",
    open: "挂单中",
    filled: "已成交",
    cancelled: "已撤单",
  };

  return (
    <span className={`inline-flex h-5 items-center border px-2 terminal-label ${colorMap[status] || colorMap.idle}`}>
      {labelMap[status] || "未知"}
    </span>
  );
}
