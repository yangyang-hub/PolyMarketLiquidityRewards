"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAppStore } from "@/stores/appStore";
import type { WsMessage } from "@/types";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const updateFromWs = useAppStore((s) => s.updateFromWs);
  const setWsConnected = useAppStore((s) => s.setWsConnected);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      updateFromWs(msg);
    },
    [updateFromWs],
  );

  const { connected } = useWebSocket(handleMessage);
  const systemStatus = useAppStore((s) => s.systemStatus);
  const pathname = usePathname();
  const standalone = pathname === "/startup" || pathname === "/risk-disclosure" || pathname === "/exit-confirmation";

  // Sync WS connection state via useEffect (not during render)
  useEffect(() => {
    setWsConnected(connected);
  }, [connected, setWsConnected]);

  return (
    <div className="terminal-shell">
      <header className="terminal-topbar flex items-center justify-between px-5">
        <div className="flex items-center gap-4">
          <div className="text-[16px] font-bold leading-none text-[var(--terminal-text)]">
            流动性风控终端
          </div>
          <div className="hidden items-center gap-4 border-l border-[var(--terminal-border-strong)] pl-4 md:flex">
            <div className="flex items-center gap-1.5">
              <span className={`terminal-status-dot ${connected ? "ok" : "bad"}`} />
              <span className={`terminal-data ${connected ? "terminal-positive" : "terminal-negative"}`}>
                本地服务：{connected ? "运行中" : "已断开"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`terminal-status-dot ${systemStatus.wsConnected ? "ok" : "warn"}`} />
              <span className={`terminal-data ${systemStatus.wsConnected ? "terminal-positive" : "terminal-dim"}`}>
                行情连接：{systemStatus.wsConnected ? "已连接" : "重连中"}
              </span>
            </div>
            <span className="terminal-data terminal-muted">账户：{systemStatus.totalAccounts}</span>
            <span className="terminal-data terminal-muted">市场：{systemStatus.totalMarkets}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 terminal-muted">
          <span className="terminal-data">--</span>
          <span className="terminal-data">□</span>
          <span className="terminal-data">×</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!standalone && <Sidebar />}
        <main className="terminal-workspace">
          <div className="terminal-main">{children}</div>
        </main>
      </div>

      <div className="terminal-statusbar flex items-center justify-between px-5">
        <div className="terminal-data">
          系统：{connected ? "已连接" : "已断开"} | 行情：{systemStatus.wsConnected ? "实时" : "--"} | 账户：{systemStatus.totalAccounts} | 数据目录：/data/db
        </div>
        <div className="flex items-center gap-6 terminal-data">
          <span className={connected ? "terminal-positive" : "terminal-negative"}>
            后端：{connected ? "正常" : "离线"}
          </span>
          <span className={systemStatus.wsConnected ? "terminal-positive" : "terminal-dim"}>
            接口状态：{systemStatus.wsConnected ? "正常" : "等待中"}
          </span>
        </div>
      </div>
    </div>
  );
}
