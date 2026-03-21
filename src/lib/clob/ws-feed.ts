import WebSocket from "ws";
import Decimal from "decimal.js";
import type { OrderBook, PriceLevel } from "../types";
import { getClobWsHost } from "../config";

type OrderBookCallback = (tokenId: string, book: OrderBook) => void;

const HEARTBEAT_INTERVAL = 10_000; // 10s text PING per Polymarket docs
const STALE_TIMEOUT = 90_000; // 90s without any message → reconnect
const SNAPSHOT_TIMEOUT = 15_000; // 15s without initial book snapshot → reconnect

/**
 * Local book state for incremental updates.
 * Maintains bid/ask maps keyed by price string → size Decimal.
 */
interface LocalBook {
  bids: Map<string, Decimal>; // price string → size
  asks: Map<string, Decimal>; // price string → size
  snapshotReady: boolean;
}

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
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private msgCount = 0;

  /** Local book state per token for applying incremental price_change deltas */
  private localBooks: Map<string, LocalBook> = new Map();
  private pendingSnapshotSince: Map<string, number> = new Map();

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
      this.pendingSnapshotSince.set(id, Date.now());
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && tokenIds.length > 0) {
      this.sendSubscriptionOperation("subscribe", tokenIds);
    }
  }

  unsubscribe(tokenIds: string[]): void {
    for (const id of tokenIds) {
      this.subscribedTokens.delete(id);
      this.localBooks.delete(id);
      this.pendingSnapshotSince.delete(id);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && tokenIds.length > 0) {
      this.sendSubscriptionOperation("unsubscribe", tokenIds);
    }
  }

  private connect(): void {
    if (!this.running) return;

    const url = getClobWsHost() + "/ws/market";
    console.log(`[WsFeed] Connecting to ${url}...`);
    this.msgCount = 0;
    this.localBooks.clear();

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

      // Subscribe to all tracked tokens
      if (this.subscribedTokens.size > 0) {
        for (const tokenId of this.subscribedTokens) {
          this.pendingSnapshotSince.set(tokenId, Date.now());
        }
        this.sendInitialMarketSubscription([...this.subscribedTokens]);
      } else {
        console.log("[WsFeed] No tokens to subscribe");
      }

      this.startHeartbeat();
      this.startSnapshotTimer();
      this.resetStaleTimer();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.resetStaleTimer();
      this.msgCount++;

      const raw = data.toString();

      // Log first 5 messages for debugging
      if (this.msgCount <= 5) {
        const preview = raw.length > 300 ? raw.slice(0, 300) + "..." : raw;
        console.log(`[WsFeed] MSG#${this.msgCount}: ${preview}`);
      }

      try {
        const msg = JSON.parse(raw);
        this.handleMessage(msg);
      } catch {
        // Not JSON — ignore (e.g. PONG text)
      }
    });

    this.ws.on("pong", () => {
      // Protocol-level pong received — connection is alive
      this.resetStaleTimer();
    });

    this.ws.on("error", (err) => {
      console.error("[WsFeed] Error:", err.message);
    });

    this.ws.on("close", (code, reason) => {
      console.log(`[WsFeed] Disconnected (code=${code}, reason=${reason?.toString() || ""})`);
      this.connected = false;
      this.ws = null;
      this.stopHeartbeat();
      this.stopSnapshotTimer();
      this.scheduleReconnect();
    });
  }

  /** Count of orderbook updates emitted to callback (for diagnostics) */
  public updateCount = 0;

  private handleMessage(msg: any): void {
    const events = Array.isArray(msg) ? msg : [msg];

    for (const event of events) {
      const eventType = event.event_type;

      // Log event types for the first 20 messages to aid debugging
      if (this.msgCount <= 20) {
        console.log(`[WsFeed] Event #${this.msgCount} type=${eventType || "unknown"}`);
      }

      if (eventType === "book") {
        this.handleBookEvent(event);
      } else if (eventType === "price_change") {
        this.handlePriceChangeEvent(event);
      }
      // Ignore other event types (tick_size_change, last_trade_price, best_bid_ask, etc.)
    }
  }

  /**
   * Handle full orderbook snapshot ("book" event).
   * Replaces the entire local book state for this token.
   */
  private handleBookEvent(event: any): void {
    const tokenId = event.asset_id;
    if (!tokenId || !this.subscribedTokens.has(tokenId)) return;
    if (!event.bids && !event.asks) return;

    // Build local book state from snapshot
    const local: LocalBook = { bids: new Map(), asks: new Map(), snapshotReady: true };

    for (const b of event.bids || []) {
      const size = new Decimal(b.size);
      if (size.greaterThan(0)) {
        local.bids.set(b.price, size);
      }
    }
    for (const a of event.asks || []) {
      const size = new Decimal(a.size);
      if (size.greaterThan(0)) {
        local.asks.set(a.price, size);
      }
    }

    this.localBooks.set(tokenId, local);
    this.pendingSnapshotSince.delete(tokenId);

    const book = this.buildOrderBook(tokenId, local, Number(event.timestamp) || Date.now());

    if (this.msgCount <= 5) {
      console.log(`[WsFeed] Book snapshot for ${tokenId.slice(0, 12)}...: ${book.bids.length} bids, ${book.asks.length} asks`);
    }

    this.onUpdate(tokenId, book);
    this.updateCount++;
  }

  /**
   * Handle incremental price level update ("price_change" event).
   * Format: { market, price_changes: [{ asset_id, price, size, side, ... }], timestamp, event_type }
   * A size of "0" means the price level has been removed.
   */
  private handlePriceChangeEvent(event: any): void {
    if (this.msgCount <= 20) {
      console.log(`[WsFeed] price_change:`, JSON.stringify(event));
    }
    const changes: any[] = event.price_changes;
    if (!Array.isArray(changes) || changes.length === 0) return;
    const timestamp = Number(event.timestamp) || Date.now();

    // Group changes by asset_id
    const changedTokens = new Set<string>();

    for (const change of changes) {
      const tokenId = change.asset_id;
      if (!tokenId || !this.subscribedTokens.has(tokenId)) continue;

      const local = this.localBooks.get(tokenId);
      if (!local || !local.snapshotReady) {
        // Ignore incremental deltas until we have a full snapshot for this token.
        if (this.msgCount <= 100) {
          console.warn(
            `[WsFeed] Ignoring price_change before snapshot for ${tokenId.slice(0, 12)}...`,
          );
        }
        continue;
      }

      const price = change.price;
      const size = new Decimal(change.size);
      const side: string = (change.side || "").toUpperCase();

      const map = side === "BUY" ? local.bids : local.asks;

      if (size.isZero()) {
        // Remove this price level
        map.delete(price);
      } else {
        // Update or add this price level
        map.set(price, size);
      }

      changedTokens.add(tokenId);
    }

    // Emit updated books for all affected tokens
    for (const tokenId of changedTokens) {
      const local = this.localBooks.get(tokenId);
      if (!local || !local.snapshotReady) continue;
      const book = this.buildOrderBook(tokenId, local, timestamp);
      this.onUpdate(tokenId, book);
      this.updateCount++;
    }
  }

  /**
   * Convert local book state (Maps) into a sorted OrderBook.
   */
  private buildOrderBook(tokenId: string, local: LocalBook, timestamp: number): OrderBook {
    const bids: PriceLevel[] = [];
    for (const [priceStr, size] of local.bids) {
      bids.push({ price: new Decimal(priceStr), size });
    }
    bids.sort((a, b) => b.price.minus(a.price).toNumber()); // descending

    const asks: PriceLevel[] = [];
    for (const [priceStr, size] of local.asks) {
      asks.push({ price: new Decimal(priceStr), size });
    }
    asks.sort((a, b) => a.price.minus(b.price).toNumber()); // ascending

    return { tokenId, bids, asks, timestamp };
  }

  /**
   * Initial connection subscription payload.
   */
  private sendInitialMarketSubscription(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      assets_ids: tokenIds,
      type: "market",
      custom_feature_enabled: true,
    };

    console.log(`[WsFeed] Initial subscribe ${tokenIds.length} tokens:`, tokenIds.map(id => id.slice(0, 12) + "..."));
    this.ws.send(JSON.stringify(msg));
  }

  /** Dynamic subscribe/unsubscribe payload after connection establishment. */
  private sendSubscriptionOperation(
    operation: "subscribe" | "unsubscribe",
    tokenIds: string[],
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || tokenIds.length === 0) return;

    const msg = {
      assets_ids: tokenIds,
      operation,
      custom_feature_enabled: true,
    };

    console.log(`[WsFeed] ${operation} ${tokenIds.length} tokens:`, tokenIds.map(id => id.slice(0, 12) + "..."));
    this.ws.send(JSON.stringify(msg));
  }

  /** Polymarket expects application-level text PING messages. */
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

  /** Reconnect if any subscribed token never receives its initial book snapshot. */
  private startSnapshotTimer(): void {
    this.stopSnapshotTimer();
    this.snapshotTimer = setInterval(() => {
      const now = Date.now();
      for (const [tokenId, subscribedAt] of this.pendingSnapshotSince) {
        if (!this.subscribedTokens.has(tokenId)) {
          this.pendingSnapshotSince.delete(tokenId);
          continue;
        }
        if (now - subscribedAt >= SNAPSHOT_TIMEOUT) {
          console.warn(`[WsFeed] Snapshot timeout for ${tokenId.slice(0, 12)}..., forcing reconnect`);
          this.forceReconnect();
          return;
        }
      }
    }, 5_000);
  }

  private stopSnapshotTimer(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    this.stopSnapshotTimer();
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
    if (this.reconnectTimer) return;

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
      console.warn(`[WsFeed] Stale: no data for ${STALE_TIMEOUT / 1000}s (total msgs: ${this.msgCount}), forcing reconnect`);
      this.forceReconnect();
    }, STALE_TIMEOUT);
  }

  private forceReconnect(): void {
    this.connected = false;
    this.stopHeartbeat();
    this.stopSnapshotTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.scheduleReconnect();
  }
}
