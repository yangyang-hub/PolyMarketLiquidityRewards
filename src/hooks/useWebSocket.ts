"use client";

import { useEffect, useRef, useState } from "react";
import type { WsMessage } from "@/types";

const PING_INTERVAL = 30_000; // 30s keepalive ping

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pingTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const backoff = useRef(1000);

  // Use ref so the message handler is always current without
  // needing to include it in the useEffect dependency array.
  // This prevents the WebSocket from reconnecting on re-renders.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let alive = true;

    function connect() {
      if (!alive) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/ws`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        backoff.current = 1000;

        // Start keepalive ping to prevent idle timeout
        if (pingTimer.current) clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("PING");
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        // Ignore PONG responses
        if (event.data === "PONG") return;
        try {
          const msg: WsMessage = JSON.parse(event.data);
          onMessageRef.current(msg);
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (pingTimer.current) {
          clearInterval(pingTimer.current);
          pingTimer.current = undefined;
        }
        if (alive) {
          reconnectTimer.current = setTimeout(connect, backoff.current);
          backoff.current = Math.min(backoff.current * 2, 30000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      alive = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
    };
  }, []); // Empty deps — stable connection, never reconnects due to re-renders

  return { connected };
}
