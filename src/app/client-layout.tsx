"use client";

import { useCallback, useEffect } from "react";
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

  // Sync WS connection state via useEffect (not during render)
  useEffect(() => {
    setWsConnected(connected);
  }, [connected, setWsConnected]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
