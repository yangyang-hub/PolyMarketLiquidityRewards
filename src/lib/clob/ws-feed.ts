import WebSocket from "ws";
import Decimal from "decimal.js";
import type { OrderBook, PriceLevel } from "../types";
import { getClobWsHost } from "../config";

type OrderBookCallback = (tokenId: string, book: OrderBook) => void;

const HEARTBEAT_INTERVAL = 10_000; // 10s ping
const STALE_TIMEOUT = 30_000; // 30s without any message → reconnect

export class ClobWsFeed {
  private ws: WebSocket | null = null;
  private subscribedTokens: Set<string> = new Set();
  private onUpdate: OrderBookCallback;
  private running = false;
  private backoff = 1000;
  private maxBackoff = 60000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  public connected = false;

  constructor(onUpdate: OrderBookCallback) {
    this.onUpdate = onUpdate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.connected = false;
    this.clearTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(tokenIds: string[]): void {
    for (const id of tokenIds) {
      this.subscribedTokens.add(id);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && tokenIds.length > 0) {
      this.sendSubscribe(tokenIds);
    }
  }

  unsubscribe(tokenIds: string[]): void {
    for (const id of tokenIds) {
      this.subscribedTokens.delete(id);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && tokenIds.length > 0) {
      this.sendUnsubscribe(tokenIds);
    }
  }

  private connect(): void {
    if (!this.running) return;

    const url = getClobWsHost() + "/ws/market";
    console.log(`[WsFeed] Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);
    } catch (e: any) {
      console.error(`[WsFeed] Connection error:`, e.message);
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      console.log("[WsFeed] Connected");
      this.backoff = 1000;
      this.connected = true;

      // Initial subscription for all tracked tokens
      if (this.subscribedTokens.size > 0) {
        this.sendInitialSubscription();
      }

      this.startHeartbeat();
      this.resetStaleTimer();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.resetStaleTimer();

      const raw = data.toString();
      // Ignore PONG responses
      if (raw === "PONG") return;

      try {
        const msg = JSON.parse(raw);
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    this.ws.on("error", (err) => {
      console.error("[WsFeed] Error:", err.message);
    });

    this.ws.on("close", () => {
      console.log("[WsFeed] Disconnected");
      this.connected = false;
      this.ws = null;
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
  }

  private handleMessage(msg: any): void {
    const events = Array.isArray(msg) ? msg : [msg];

    for (const event of events) {
      // Only process book events with orderbook data
      if (event.event_type && event.event_type !== "book") continue;

      const tokenId = event.asset_id;
      if (!tokenId || !this.subscribedTokens.has(tokenId)) continue;
      if (!event.bids && !event.asks) continue;

      const bids: PriceLevel[] = (event.bids || [])
        .map((b: any) => ({
          price: new Decimal(Array.isArray(b) ? b[0] : b.price),
          size: new Decimal(Array.isArray(b) ? b[1] : b.size),
        }))
        .filter((b: PriceLevel) => b.size.greaterThan(0))
        .sort((a: PriceLevel, b: PriceLevel) => b.price.minus(a.price).toNumber());

      const asks: PriceLevel[] = (event.asks || [])
        .map((a: any) => ({
          price: new Decimal(Array.isArray(a) ? a[0] : a.price),
          size: new Decimal(Array.isArray(a) ? a[1] : a.size),
        }))
        .filter((a: PriceLevel) => a.size.greaterThan(0))
        .sort((a: PriceLevel, b: PriceLevel) => a.price.minus(b.price).toNumber());

      const book: OrderBook = {
        tokenId,
        bids,
        asks,
        timestamp: Number(event.timestamp) || Date.now(),
      };

      this.onUpdate(tokenId, book);
    }
  }

  /** Initial subscription: send all tokens at once */
  private sendInitialSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const ids = [...this.subscribedTokens];
    console.log(`[WsFeed] Subscribing to ${ids.length} tokens`);
    this.ws.send(JSON.stringify({
      type: "market",
      assets_ids: ids,
    }));
  }

  /** Dynamic subscribe (add tokens to existing connection) */
  private sendSubscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    console.log(`[WsFeed] Subscribe +${tokenIds.length} tokens`);
    this.ws.send(JSON.stringify({
      assets_ids: tokenIds,
      operation: "subscribe",
    }));
  }

  /** Dynamic unsubscribe */
  private sendUnsubscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    console.log(`[WsFeed] Unsubscribe -${tokenIds.length} tokens`);
    this.ws.send(JSON.stringify({
      assets_ids: tokenIds,
      operation: "unsubscribe",
    }));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send("PING");
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;

    console.log(`[WsFeed] Reconnecting in ${this.backoff}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoff);

    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
  }

  private resetStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (!this.running) return;

    this.staleTimer = setTimeout(() => {
      console.warn("[WsFeed] Stale: no data for 30s, forcing reconnect");
      this.connected = false;
      this.stopHeartbeat();
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.scheduleReconnect();
    }, STALE_TIMEOUT);
  }
}
