import WebSocket from "ws";
import Decimal from "decimal.js";
import type { OrderBook, PriceLevel } from "../types";
import { getClobWsHost } from "../config";

type OrderBookCallback = (tokenId: string, book: OrderBook) => void;

export class ClobWsFeed {
  private ws: WebSocket | null = null;
  private subscribedTokens: Set<string> = new Set();
  private onUpdate: OrderBookCallback;
  private running = false;
  private backoff = 1000;
  private maxBackoff = 60000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessage = 0;
  private staleTimeoutMs = 60000;

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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(tokenIds: string[]): void {
    for (const id of tokenIds) {
      this.subscribedTokens.add(id);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(tokenIds);
    }
  }

  unsubscribe(tokenIds: string[]): void {
    for (const id of tokenIds) {
      this.subscribedTokens.delete(id);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
      this.backoff = 1000; // Reset backoff on success
      this.connected = true;

      // Subscribe to all tracked tokens
      if (this.subscribedTokens.size > 0) {
        this.sendSubscribe([...this.subscribedTokens]);
      }

      this.resetStaleTimer();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.lastMessage = Date.now();
      this.resetStaleTimer();

      try {
        const msg = JSON.parse(data.toString());
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
      this.scheduleReconnect();
    });
  }

  private handleMessage(msg: any): void {
    // CLOB WS sends book snapshots and updates
    // Format: { market: string, asset_id: string, bids: [[price, size], ...], asks: [[price, size], ...], timestamp: ... }
    // Or array format from event-based updates
    const events = Array.isArray(msg) ? msg : [msg];

    for (const event of events) {
      const tokenId = event.asset_id;
      if (!tokenId || !this.subscribedTokens.has(tokenId)) continue;

      const bids: PriceLevel[] = (event.bids || [])
        .map((b: any) => ({
          price: new Decimal(Array.isArray(b) ? b[0] : b.price),
          size: new Decimal(Array.isArray(b) ? b[1] : b.size),
        }))
        .sort((a: PriceLevel, b: PriceLevel) => b.price.minus(a.price).toNumber());

      const asks: PriceLevel[] = (event.asks || [])
        .map((a: any) => ({
          price: new Decimal(Array.isArray(a) ? a[0] : a.price),
          size: new Decimal(Array.isArray(a) ? a[1] : a.size),
        }))
        .sort((a: PriceLevel, b: PriceLevel) => a.price.minus(b.price).toNumber());

      const book: OrderBook = {
        tokenId,
        bids,
        asks,
        timestamp: event.timestamp || Date.now(),
      };

      this.onUpdate(tokenId, book);
    }
  }

  private sendSubscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const id of tokenIds) {
      this.ws.send(JSON.stringify({
        type: "market",
        assets_id: id,
      }));
    }
  }

  private sendUnsubscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const id of tokenIds) {
      this.ws.send(JSON.stringify({
        type: "market",
        assets_id: id,
        action: "unsubscribe",
      }));
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
      console.warn("[WsFeed] Stale: no data for 60s, forcing reconnect");
      this.connected = false;
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.scheduleReconnect();
    }, this.staleTimeoutMs);
  }
}
