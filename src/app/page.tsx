"use client";

import Link from "next/link";
import { useAppStore } from "@/stores/appStore";
import { useApi } from "@/hooks/useApi";
import AccountCard from "@/components/AccountCard";
import EventLog from "@/components/EventLog";

export default function DashboardPage() {
  const accounts = useAppStore((s) => s.accounts);
  const eventLog = useAppStore((s) => s.eventLog);
  const systemStatus = useAppStore((s) => s.systemStatus);
  const { post } = useApi();

  const handleStartAll = () => post("/api/batch/start-all");
  const handleStopAll = () => post("/api/batch/stop-all");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">仪表盘</h2>
          <p className="text-sm opacity-60">
            {systemStatus.totalAccounts} 个账户 | {systemStatus.totalMarkets} 个市场
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm" onClick={handleStartAll}>
            全部启动
          </button>
          <button
            className="btn btn-outline btn-warning btn-sm"
            onClick={handleStopAll}
          >
            全部停止
          </button>
        </div>
      </div>

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="card bg-base-100 shadow-sm border border-base-300 p-8 text-center">
          <p className="opacity-60">
            暂无账户，请前往{" "}
            <Link href="/accounts" className="link link-primary">账户页面</Link>{" "}
            添加
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => (
            <AccountCard
              key={account.name}
              account={account}
              onStart={() => post(`/api/accounts/${account.name}/start`)}
              onStop={() => post(`/api/accounts/${account.name}/stop`)}
            />
          ))}
        </div>
      )}

      {/* Event Log */}
      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-4">
          <h3 className="font-semibold text-sm mb-2">最近事件</h3>
          <EventLog events={eventLog} />
        </div>
      </div>
    </div>
  );
}
