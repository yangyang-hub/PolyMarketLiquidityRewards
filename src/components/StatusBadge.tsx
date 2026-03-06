"use client";

export default function StatusBadge({
  status,
}: {
  status: string;
}) {
  const colorMap: Record<string, string> = {
    idle: "badge-ghost",
    running: "badge-success",
    stopping: "badge-warning",
    error: "badge-error",
    open: "badge-info",
    filled: "badge-success",
    cancelled: "badge-ghost",
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
    <span className={`badge badge-sm ${colorMap[status] || "badge-ghost"}`}>
      {labelMap[status] || status}
    </span>
  );
}
