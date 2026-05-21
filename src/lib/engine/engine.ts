import Decimal from "decimal.js";
import type { OpenOrder } from "@polymarket/clob-client-v2";
import type {
  AccountConfig,
  AccountState,
  ActiveOrder,
  OrderEvent,
  OrderBook,
} from "../types";
import {
  adjustSizeForCostPrecision,
  ClobExecutor,
  minCostAdjustedSize,
} from "../clob/executor";
import type { TradeUpdate } from "../clob/ws-feed";
import {
  protectedBidNotional,
  shouldCancelDepthOrder,
  shouldCancelMinBookNotional,
  topBidNotional,
} from "../strategy/depth-strategy";
import { store } from "../store/memory-store";

interface BookHistorySample {
  timestamp: number;
  book: OrderBook;
}

interface NotionalSample {
  timestamp: number;
  notional: Decimal;
}

interface CancelTrigger {
  code:
    | "min_book_notional"
    | "depth_position"
    | "front_volume_drop"
    | "buy_pressure"
    | "cancel_follow";
  label: string;
  bypassCooldown?: boolean;
  requiresRestConfirmation?: boolean;
}

interface ResetOrderResult {
  didReset: boolean;
  replacement?: ActiveOrder;
}

interface PendingResetPlacement {
  sourceOrderId: string;
  tokenId: string;
  marketSlug: string;
  side: ActiveOrder["side"];
  priceStr: string;
  size: Decimal;
  nextTryAt: number;
  attempts: number;
}

type PendingResetRiskCheck =
  | { action: "ok" }
  | { action: "retry"; reason: string }
  | { action: "abort"; reason: string };

type OrderValue = Decimal.Value;

interface RawOrderLike {
  id: string;
  asset_id: string;
  side?: string;
  price: OrderValue;
  original_size?: OrderValue;
  size?: OrderValue;
  size_matched?: OrderValue;
  matched_size?: OrderValue;
}

interface RawRestBook {
  bids?: RawBookLevel[];
  asks?: RawBookLevel[];
}

interface RawBookLevel {
  price: OrderValue;
  size: OrderValue;
}

export class AccountEngine {
  private static NEW_ORDER_COOLDOWN_MS = 15_000;
  private static HISTORY_RETENTION_MS = 125_000;
  private account: AccountConfig;
  private executor: ClobExecutor;
  private running = false;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private cancellingTokens: Set<string> = new Set(); // per-token guard
  private realtimeCancelledIds: Set<string> = new Set(); // orders cancelled by realtimeCheck during tick
  private latestBooks: Map<string, OrderBook> = new Map();
  private bookHistory: Map<string, BookHistorySample[]> = new Map();
  private buyPressureHistory: Map<string, NotionalSample[]> = new Map();
  private resetDueAtByOrderId: Map<string, number> = new Map();
  private pendingResetPlacements: Map<string, PendingResetPlacement> = new Map();
  private onEvent: (event: OrderEvent) => void;
  private onStateChange: (name: string, state: AccountState) => void;
  private onTokensDiscovered: (accountName: string, tokenIds: Set<string>) => Promise<void>;

  private static PERIODIC_MS = 15_000; // 15s full refresh

  constructor(
    account: AccountConfig,
    onEvent: (event: OrderEvent) => void,
    onStateChange: (name: string, state: AccountState) => void,
    onTokensDiscovered: (accountName: string, tokenIds: Set<string>) => Promise<void>,
  ) {
    this.account = account;
    this.executor = new ClobExecutor(account);
    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
    this.onTokensDiscovered = onTokensDiscovered;
  }

  async start(): Promise<boolean> {
    if (this.running) return true;
    this.running = true;

    console.log(`[Engine:${this.account.name}] Starting...`);

    try {
      await this.executor.initApiKeys();
      const balance = await this.executor.getCollateralBalance();
      store.updateAccount(this.account.name, { status: "running", balance });
      this.broadcastState();

      // Initial discovery: pull orders immediately to trigger subscriptions
      await this.tick();

      // Start periodic full tick (refresh order list + balance from API)
      this.periodicTimer = setInterval(async () => {
        if (!this.running || this.ticking) return;
        this.ticking = true;
        try {
          await this.tick();
        } catch (e: unknown) {
          console.error(`[Engine:${this.account.name}] Periodic tick error:`, this.errorMessage(e));
        } finally {
          this.ticking = false;
        }
      }, AccountEngine.PERIODIC_MS);

      return true;
    } catch (e: unknown) {
      const message = this.errorMessage(e);
      console.error(`[Engine:${this.account.name}] Init failed:`, message);
      store.updateAccount(this.account.name, { status: "error", error: message });
      this.broadcastState();
      this.running = false;
      this.ticking = false;
      if (this.periodicTimer) {
        clearInterval(this.periodicTimer);
        this.periodicTimer = null;
      }
      return false;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    console.log(`[Engine:${this.account.name}] Stopping...`);
    store.updateAccount(this.account.name, { status: "stopping" });
    this.broadcastState();

    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    this.pendingResetPlacements.clear();
    this.resetDueAtByOrderId.clear();

    store.updateAccount(this.account.name, {
      status: "idle",
      activeOrders: [],
    });
    this.broadcastState();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Cancel a single order by ID */
  async cancelOrderById(orderId: string): Promise<boolean> {
    return this.executor.cancelOrder(orderId);
  }

  /** Cancel all open orders for this account */
  async cancelAllOrders(): Promise<boolean> {
    return this.executor.cancelAll();
  }

  /**
   * Called by manager when an orderbook update arrives.
   * Immediately checks cached orders against the new book — no API call, no debounce.
   */
  onBookUpdate(tokenId: string): void {
    if (!this.running) return;
    const book = store.orderbooks.get(tokenId);
    if (book) {
      this.recordBookUpdate(tokenId, book);
    }
    this.realtimeCancelCheck(tokenId);
  }

  /**
   * Realtime cancel check: uses cached activeOrders from store (no API call).
   * Only checks orders matching the updated tokenId.
   */
  private async realtimeCancelCheck(tokenId: string): Promise<void> {
    if (this.cancellingTokens.has(tokenId)) return;
    this.cancellingTokens.add(tokenId);
    try {
      const book = store.orderbooks.get(tokenId);
      if (!book) return;

      const accountState = store.accounts.get(this.account.name);
      if (!accountState) return;

      const ordersForToken = accountState.activeOrders.filter((o) => o.tokenId === tokenId);
      if (ordersForToken.length === 0) return;

      for (const order of ordersForToken) {
        const orderPrice = new Decimal(order.priceStr);
        const isBuy = order.side === "buy";
        const trigger = this.getRiskCancelTrigger(book, orderPrice, isBuy);
        if (!trigger) continue;

        if (!trigger.bypassCooldown && !this.isOrderEligibleForCancel(order)) continue;

        const confirmed = await this.confirmRiskCancelWithRestBook(tokenId, orderPrice, isBuy, trigger);
        if (!confirmed) continue;

        const cancelled = await this.cancelActiveOrder(order, trigger, "realtime");
        if (cancelled) {
          this.realtimeCancelledIds.add(order.orderId);

          // Remove from cached orders immediately
          const current = store.accounts.get(this.account.name);
          if (current) {
            store.updateAccount(this.account.name, {
              activeOrders: current.activeOrders.filter((o) => o.orderId !== order.orderId),
            });
            this.broadcastState();
          }
        }
      }
    } catch (e: unknown) {
      console.error(`[Engine:${this.account.name}] Realtime check error:`, this.errorMessage(e));
    } finally {
      this.cancellingTokens.delete(tokenId);
    }
  }

  onTrade(trade: TradeUpdate): void {
    if (!this.running || trade.side !== "BUY") return;

    const now = Date.now();
    const timestamp = Number.isFinite(trade.timestamp) ? trade.timestamp : now;
    const samples = this.buyPressureHistory.get(trade.tokenId) || [];
    samples.push({
      timestamp,
      notional: trade.price.times(trade.size),
    });
    this.buyPressureHistory.set(
      trade.tokenId,
      samples.filter((sample) => now - sample.timestamp <= AccountEngine.HISTORY_RETENTION_MS),
    );
  }

  /**
   * Full tick: pulls fresh orders from API, refreshes balance, syncs tokenIds.
   * Called periodically (every 15s) and on initial discovery.
   */
  private async tick(): Promise<void> {
    const config = store.config;
    this.realtimeCancelledIds.clear();
    const prev = store.accounts.get(this.account.name);
    const previousOrderMap = new Map((prev?.activeOrders || []).map((o) => [o.orderId, o]));

    // 1. Get all open orders from API
    const openOrders = await this.executor.getOpenOrders();
    const trackedOrders: ActiveOrder[] = [];
    const activeTokenIds = new Set<string>();

    console.log(
      `[Engine:${this.account.name}] Tick: ${openOrders.length} open orders, ` +
      `cancelDepth=${config.cancelDepthLevel}, minBook=$${config.minBookNotionalUsd}`,
    );

    // Check scoring status
    const allOrderIds = openOrders.map((o) => o.id);
    const scoringMap = allOrderIds.length > 0
      ? await this.executor.areOrdersScoring(allOrderIds)
      : {};

    // 2. Process each order: check risk rules first, then optional reset.
    for (const order of openOrders) {
      const tokenId = order.asset_id;
      activeTokenIds.add(tokenId);

      const book = store.orderbooks.get(tokenId);
      const orderPrice = new Decimal(order.price);
      const isBuy = order.side?.toUpperCase() === "BUY";
      const slug = this.findSlugForToken(tokenId);
      const activeOrder = this.withPreservedTimestamp(
        this.toActiveOrder(order, slug, scoringMap),
        previousOrderMap,
      );

      if (book && !this.latestBooks.has(tokenId)) {
        this.recordBookUpdate(tokenId, book);
      }

      if (book) {
        const trigger = this.getRiskCancelTrigger(book, orderPrice, isBuy);
        if (trigger) {
          if (!trigger.bypassCooldown && !this.isOrderEligibleForCancel(activeOrder)) {
            trackedOrders.push(activeOrder);
            continue;
          }

          const confirmed = await this.confirmRiskCancelWithRestBook(tokenId, orderPrice, isBuy, trigger);
          if (confirmed) {
            const cancelled = await this.cancelRawOrder(order, activeOrder, trigger, "tick");
            if (!cancelled) {
              trackedOrders.push(activeOrder);
            }
            continue;
          }

          trackedOrders.push(activeOrder);
          continue;
        }
      }

      const resetResult = await this.tryResetOrder(order, activeOrder, slug);
      if (resetResult.didReset) {
        if (resetResult.replacement) {
          trackedOrders.push(resetResult.replacement);
          activeTokenIds.add(resetResult.replacement.tokenId);
        }
        continue;
      }

      trackedOrders.push(activeOrder);
    }

    for (const pending of this.pendingResetPlacements.values()) {
      activeTokenIds.add(pending.tokenId);
    }
    const pendingReplacements = await this.processPendingResetPlacements();
    for (const replacement of pendingReplacements) {
      trackedOrders.push(replacement);
      activeTokenIds.add(replacement.tokenId);
    }

    // 3. Update account state BEFORE notifying manager,
    //    so that when WS book snapshot triggers realtimeCancelCheck,
    //    the cached orders are already in the store.
    const freshBalance = await this.executor.getCollateralBalance();
    // Exclude orders that were cancelled by realtimeCancelCheck during this tick
    const finalOrders = trackedOrders.filter((o) => !this.realtimeCancelledIds.has(o.orderId));
    const uniqueOrders = Array.from(
      new Map(finalOrders.map((o) => [o.orderId, o])).values(),
    );
    const mergedOrders = uniqueOrders.map((order) => {
      const existing = previousOrderMap.get(order.orderId);
      return existing ? { ...order, timestamp: existing.timestamp } : order;
    });
    this.cleanupOrderRuntimeState(mergedOrders);
    const balanceChanged = prev?.balance !== freshBalance;
    const ordersChanged = !this.sameActiveOrders(prev?.activeOrders || [], mergedOrders);
    const marketsChanged = prev?.marketsCount !== activeTokenIds.size;
    store.updateAccount(this.account.name, {
      activeOrders: mergedOrders,
      marketsCount: activeTokenIds.size,
      balance: freshBalance,
    });
    if (balanceChanged || ordersChanged || marketsChanged) {
      this.broadcastState();
    }

    // 4. Notify manager of active tokenIds for subscription management.
    //    Must happen AFTER store update so realtimeCancelCheck can find cached orders.
    //    Await so Gamma API completes before we continue — discoveredMarkets will be populated.
    await this.onTokensDiscovered(this.account.name, activeTokenIds);

    // 5. Backfill empty slugs now that discoveredMarkets is populated
    const currentState = store.accounts.get(this.account.name);
    if (currentState) {
      let slugPatched = false;
      const patchedOrders = currentState.activeOrders.map((order) => {
        if (order.marketSlug) return order;
        const slug = this.findSlugForToken(order.tokenId);
        if (slug) {
          slugPatched = true;
          return { ...order, marketSlug: slug };
        }
        return order;
      });
      if (slugPatched) {
        store.updateAccount(this.account.name, { activeOrders: patchedOrders });
        this.broadcastState();
      }
    }
  }

  private findSlugForToken(tokenId: string): string {
    for (const market of store.discoveredMarkets.values()) {
      if (market.tokens.some((t) => t.token_id === tokenId)) {
        return market.slug;
      }
    }
    return "";
  }

  private toActiveOrder(
    order: OpenOrder,
    slug: string,
    scoringMap: Record<string, boolean>,
  ): ActiveOrder {
    return {
      orderId: order.id,
      tokenId: order.asset_id,
      marketSlug: slug,
      side: order.side?.toUpperCase() === "BUY" ? "buy" : "sell",
      price: parseFloat(String(order.price)),
      priceStr: String(order.price),
      size: parseFloat(String(order.original_size || "0")),
      status: "open",
      scoring: scoringMap[order.id] === true,
      timestamp: Date.now(),
    };
  }

  private isOrderEligibleForCancel(order: ActiveOrder): boolean {
    return Date.now() - order.timestamp >= AccountEngine.NEW_ORDER_COOLDOWN_MS;
  }

  private withPreservedTimestamp(
    order: ActiveOrder,
    previousOrderMap: Map<string, ActiveOrder>,
  ): ActiveOrder {
    const existing = previousOrderMap.get(order.orderId);
    return existing ? { ...order, timestamp: existing.timestamp } : order;
  }

  private sameActiveOrders(prev: ActiveOrder[], next: ActiveOrder[]): boolean {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      const a = prev[i];
      const b = next[i];
      if (
        a.orderId !== b.orderId ||
        a.tokenId !== b.tokenId ||
        a.marketSlug !== b.marketSlug ||
        a.side !== b.side ||
        a.price !== b.price ||
        a.priceStr !== b.priceStr ||
        a.size !== b.size ||
        a.status !== b.status ||
        a.scoring !== b.scoring ||
        a.timestamp !== b.timestamp
      ) {
        return false;
      }
    }
    return true;
  }

  private recordBookUpdate(tokenId: string, book: OrderBook): void {
    const now = Date.now();
    this.latestBooks.set(tokenId, book);

    const samples = this.bookHistory.get(tokenId) || [];
    samples.push({ timestamp: now, book });
    this.bookHistory.set(
      tokenId,
      samples.filter((sample) => now - sample.timestamp <= AccountEngine.HISTORY_RETENTION_MS),
    );
  }

  private getRiskCancelTrigger(
    book: OrderBook,
    orderPrice: Decimal,
    isBuy: boolean,
  ): CancelTrigger | null {
    if (!isBuy) return null;

    const config = store.config;

    if (shouldCancelMinBookNotional(book, orderPrice, isBuy, config.minBookNotionalUsd)) {
      return {
        code: "min_book_notional",
        label: `盘口前方金额低于 $${config.minBookNotionalUsd}`,
        bypassCooldown: true,
        requiresRestConfirmation: true,
      };
    }

    if (shouldCancelDepthOrder(book, orderPrice, isBuy, config.cancelDepthLevel)) {
      return {
        code: "depth_position",
        label: `买单进入前 ${config.cancelDepthLevel} 档`,
        bypassCooldown: true,
        requiresRestConfirmation: true,
      };
    }

    if (config.volumeDropPercent > 0) {
      const drop = this.getProtectedBidDropPercent(book, orderPrice, config.volumeDropWindowSec);
      if (drop && drop.greaterThanOrEqualTo(config.volumeDropPercent)) {
        return {
          code: "front_volume_drop",
          label: `${config.volumeDropWindowSec}s 前方买盘骤降 ${drop.toDecimalPlaces(1)}%`,
          requiresRestConfirmation: true,
        };
      }
    }

    if (config.buyPressureUsd > 0) {
      const buyPressure = this.sumBuyPressure(book.tokenId, config.buyPressureWindowSec);
      if (buyPressure.greaterThanOrEqualTo(config.buyPressureUsd)) {
        return {
          code: "buy_pressure",
          label: `${config.buyPressureWindowSec}s 买入成交 $${buyPressure.toDecimalPlaces(2)}`,
        };
      }
    }

    if (config.cancelFollowDropPercent > 0) {
      const drop = this.getTopBidDropPercent(
        book,
        config.cancelFollowDepthLevels,
        config.cancelFollowWindowSec,
      );
      if (drop && drop.greaterThanOrEqualTo(config.cancelFollowDropPercent)) {
        return {
          code: "cancel_follow",
          label: `${config.cancelFollowWindowSec}s 买盘撤量跟随 ${drop.toDecimalPlaces(1)}%`,
          requiresRestConfirmation: true,
        };
      }
    }

    return null;
  }

  private getProtectedBidDropPercent(
    currentBook: OrderBook,
    orderPrice: Decimal,
    windowSec: number,
  ): Decimal | null {
    const peak = this.getPeakBookNotional(currentBook.tokenId, windowSec, (book) =>
      protectedBidNotional(book, orderPrice),
    );
    const current = protectedBidNotional(currentBook, orderPrice);
    return this.dropPercent(peak, current);
  }

  private getTopBidDropPercent(
    currentBook: OrderBook,
    levels: number,
    windowSec: number,
  ): Decimal | null {
    const peak = this.getPeakBookNotional(currentBook.tokenId, windowSec, (book) =>
      topBidNotional(book, levels),
    );
    const current = topBidNotional(currentBook, levels);
    return this.dropPercent(peak, current);
  }

  private getPeakBookNotional(
    tokenId: string,
    windowSec: number,
    selector: (book: OrderBook) => Decimal,
  ): Decimal {
    const cutoff = Date.now() - windowSec * 1000;
    const samples = this.bookHistory.get(tokenId) || [];
    let peak = new Decimal(0);

    for (const sample of samples) {
      if (sample.timestamp < cutoff) continue;
      const value = selector(sample.book);
      if (value.greaterThan(peak)) {
        peak = value;
      }
    }

    return peak;
  }

  private dropPercent(peak: Decimal, current: Decimal): Decimal | null {
    if (peak.lessThanOrEqualTo(0) || current.greaterThanOrEqualTo(peak)) {
      return null;
    }
    return peak.minus(current).dividedBy(peak).times(100);
  }

  private sumBuyPressure(tokenId: string, windowSec: number): Decimal {
    const cutoff = Date.now() - windowSec * 1000;
    const samples = this.buyPressureHistory.get(tokenId) || [];
    let total = new Decimal(0);

    for (const sample of samples) {
      if (sample.timestamp >= cutoff) {
        total = total.plus(sample.notional);
      }
    }

    return total;
  }

  private async confirmRiskCancelWithRestBook(
    tokenId: string,
    orderPrice: Decimal,
    isBuy: boolean,
    trigger: CancelTrigger,
  ): Promise<boolean> {
    if (!trigger.requiresRestConfirmation) return true;

    const rawBook = await this.executor.getOrderBook(tokenId);
    const restBook = this.normalizeRestBook(tokenId, rawBook);
    if (!restBook) {
      console.warn(
        `[Engine:${this.account.name}] Skip cancel for ${tokenId.slice(0, 12)}...: REST book unavailable`,
      );
      return false;
    }

    if (trigger.code === "min_book_notional") {
      return shouldCancelMinBookNotional(
        restBook,
        orderPrice,
        isBuy,
        store.config.minBookNotionalUsd,
      );
    }

    if (trigger.code === "depth_position") {
      return shouldCancelDepthOrder(
        restBook,
        orderPrice,
        isBuy,
        store.config.cancelDepthLevel,
      );
    }

    if (trigger.code === "front_volume_drop") {
      const drop = this.getProtectedBidDropPercent(
        restBook,
        orderPrice,
        store.config.volumeDropWindowSec,
      );
      return drop != null && drop.greaterThanOrEqualTo(store.config.volumeDropPercent);
    }

    if (trigger.code === "cancel_follow") {
      const drop = this.getTopBidDropPercent(
        restBook,
        store.config.cancelFollowDepthLevels,
        store.config.cancelFollowWindowSec,
      );
      return drop != null && drop.greaterThanOrEqualTo(store.config.cancelFollowDropPercent);
    }

    return true;
  }

  private async cancelActiveOrder(
    order: ActiveOrder,
    trigger: CancelTrigger,
    source: "realtime" | "tick",
  ): Promise<boolean> {
    return this.cancelRawOrder(
      {
        id: order.orderId,
        asset_id: order.tokenId,
        side: order.side === "buy" ? "BUY" : "SELL",
        price: order.priceStr,
        original_size: String(order.size),
      },
      order,
      trigger,
      source,
    );
  }

  private async cancelRawOrder(
    rawOrder: RawOrderLike,
    activeOrder: ActiveOrder,
    trigger: CancelTrigger,
    source: "realtime" | "tick",
  ): Promise<boolean> {
    const slug = activeOrder.marketSlug || this.findSlugForToken(activeOrder.tokenId);
    console.log(
      `[Engine:${this.account.name}] Cancelling ${activeOrder.orderId} ` +
      `(${source} ${trigger.code}: ${trigger.label}, token=${activeOrder.tokenId.slice(0, 12)}...)`,
    );

    const cancelled = await this.executor.cancelOrder(activeOrder.orderId);
    if (cancelled) {
      this.resetDueAtByOrderId.delete(activeOrder.orderId);
      this.emitEvent("cancelled", rawOrder, slug, trigger.label);
    }
    return cancelled;
  }

  private async tryResetOrder(
    rawOrder: RawOrderLike,
    activeOrder: ActiveOrder,
    slug: string,
  ): Promise<ResetOrderResult> {
    const dueAt = this.getResetDueAt(activeOrder);
    if (dueAt == null || Date.now() < dueAt) {
      return { didReset: false };
    }

    const remainingSize = this.getRemainingOrderSize(rawOrder, activeOrder);
    if (remainingSize.lessThanOrEqualTo(0)) {
      this.resetDueAtByOrderId.delete(activeOrder.orderId);
      return { didReset: false };
    }

    const price = new Decimal(activeOrder.priceStr);
    const placementSize = this.getPostOnlyPlacementSize(price, remainingSize);
    if (!placementSize) {
      console.warn(
        `[Engine:${this.account.name}] Skip reset for ${activeOrder.orderId}: remaining size is too small to repost`,
      );
      this.resetDueAtByOrderId.set(activeOrder.orderId, Date.now() + 60_000);
      return { didReset: false };
    }

    console.log(
      `[Engine:${this.account.name}] Resetting ${activeOrder.orderId} ` +
      `(timer, token=${activeOrder.tokenId.slice(0, 12)}...)`,
    );

    const cancelled = await this.executor.cancelOrder(activeOrder.orderId);
    if (!cancelled) {
      this.resetDueAtByOrderId.set(activeOrder.orderId, Date.now() + 60_000);
      return { didReset: false };
    }

    this.resetDueAtByOrderId.delete(activeOrder.orderId);
    this.emitEvent("cancelled", rawOrder, slug, "定时重置");

    let newOrderId: string | null = null;
    try {
      newOrderId = activeOrder.side === "buy"
        ? await this.executor.buyLimitPostOnly(activeOrder.tokenId, price, placementSize)
        : await this.executor.sellLimitPostOnly(activeOrder.tokenId, price, placementSize);
    } catch (e: unknown) {
      this.queuePendingResetPlacement(activeOrder, slug, placementSize, this.errorMessage(e));
      return { didReset: true };
    }

    if (!newOrderId) {
      this.queuePendingResetPlacement(activeOrder, slug, placementSize, "CLOB 未返回新订单编号");
      return { didReset: true };
    }

    const replacement: ActiveOrder = {
      ...activeOrder,
      orderId: newOrderId,
      size: placementSize.toNumber(),
      scoring: false,
      timestamp: Date.now(),
    };
    this.getResetDueAt(replacement);

    this.emitEvent("placed", {
      id: newOrderId,
      asset_id: activeOrder.tokenId,
      side: activeOrder.side === "buy" ? "BUY" : "SELL",
      price: activeOrder.priceStr,
      original_size: placementSize.toString(),
    }, slug, "定时重置重挂");

    return { didReset: true, replacement };
  }

  private async processPendingResetPlacements(): Promise<ActiveOrder[]> {
    const now = Date.now();
    const replacements: ActiveOrder[] = [];

    for (const [sourceOrderId, pending] of this.pendingResetPlacements) {
      if (pending.nextTryAt > now) continue;

      const price = new Decimal(pending.priceStr);
      pending.attempts += 1;

      try {
        const riskCheck = await this.checkPendingResetPlacementRisk(pending, price);
        if (riskCheck.action === "retry") {
          this.reschedulePendingResetPlacement(pending, riskCheck.reason);
          continue;
        }
        if (riskCheck.action === "abort") {
          this.pendingResetPlacements.delete(sourceOrderId);
          store.updateAccount(this.account.name, {
            error: `定时重置补挂已取消：${riskCheck.reason}`,
          });
          this.broadcastState();
          console.warn(
            `[Engine:${this.account.name}] Aborted pending reset placement ` +
            `${sourceOrderId}: ${riskCheck.reason}`,
          );
          continue;
        }

        const newOrderId = pending.side === "buy"
          ? await this.executor.buyLimitPostOnly(pending.tokenId, price, pending.size)
          : await this.executor.sellLimitPostOnly(pending.tokenId, price, pending.size);

        if (!newOrderId) {
          this.reschedulePendingResetPlacement(pending, "CLOB 未返回新订单编号");
          continue;
        }

        this.pendingResetPlacements.delete(sourceOrderId);
        store.updateAccount(this.account.name, { error: undefined });

        const replacement: ActiveOrder = {
          orderId: newOrderId,
          tokenId: pending.tokenId,
          marketSlug: pending.marketSlug,
          side: pending.side,
          price: parseFloat(pending.priceStr),
          priceStr: pending.priceStr,
          size: pending.size.toNumber(),
          status: "open",
          scoring: false,
          timestamp: Date.now(),
        };
        this.getResetDueAt(replacement);

        this.emitEvent("placed", {
          id: newOrderId,
          asset_id: pending.tokenId,
          side: pending.side === "buy" ? "BUY" : "SELL",
          price: pending.priceStr,
          original_size: pending.size.toString(),
        }, pending.marketSlug, "定时重置补挂");

        replacements.push(replacement);
      } catch (e: unknown) {
        this.reschedulePendingResetPlacement(pending, this.errorMessage(e));
      }
    }

    return replacements;
  }

  private async checkPendingResetPlacementRisk(
    pending: PendingResetPlacement,
    price: Decimal,
  ): Promise<PendingResetRiskCheck> {
    const isBuy = pending.side === "buy";
    if (!isBuy) return { action: "ok" };

    const rawBook = await this.executor.getOrderBook(pending.tokenId);
    const restBook = this.normalizeRestBook(pending.tokenId, rawBook);
    if (!restBook) {
      return { action: "retry", reason: "盘口数据不可用，暂不补挂" };
    }

    this.recordBookUpdate(pending.tokenId, restBook);
    const trigger = this.getRiskCancelTrigger(restBook, price, isBuy);
    if (!trigger) return { action: "ok" };

    return { action: "abort", reason: trigger.label };
  }

  private queuePendingResetPlacement(
    order: ActiveOrder,
    slug: string,
    size: Decimal,
    reason: string,
  ): void {
    const pending: PendingResetPlacement = {
      sourceOrderId: order.orderId,
      tokenId: order.tokenId,
      marketSlug: slug,
      side: order.side,
      priceStr: order.priceStr,
      size,
      nextTryAt: Date.now() + 5_000,
      attempts: 0,
    };
    this.pendingResetPlacements.set(order.orderId, pending);
    store.updateAccount(this.account.name, {
      error: `定时重置已撤单，但补挂失败，等待重试：${reason}`,
    });
    this.broadcastState();
  }

  private reschedulePendingResetPlacement(
    pending: PendingResetPlacement,
    reason: string,
  ): void {
    const delayMs = Math.min(60_000, 5_000 * Math.max(1, pending.attempts));
    pending.nextTryAt = Date.now() + delayMs;
    store.updateAccount(this.account.name, {
      error: `定时重置补挂失败，${Math.round(delayMs / 1000)} 秒后重试：${reason}`,
    });
    this.broadcastState();
  }

  private getPostOnlyPlacementSize(price: Decimal, rawSize: Decimal): Decimal | null {
    let size = rawSize.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    size = adjustSizeForCostPrecision(price, size);

    if (size.isZero()) {
      const bumped = minCostAdjustedSize(price);
      const bumpedCost = price.times(bumped);
      if (bumpedCost.greaterThan(rawSize.times(price).times(5))) {
        return null;
      }
      size = bumped;
    }

    return price.times(size).greaterThanOrEqualTo(1) ? size : null;
  }

  private getResetDueAt(order: ActiveOrder): number | null {
    const config = store.config;
    if (!config.orderResetEnabled) {
      this.resetDueAtByOrderId.delete(order.orderId);
      return null;
    }

    const minMinutes = Math.max(1, config.orderResetMinMinutes);
    const maxMinutes = Math.max(minMinutes, config.orderResetMaxMinutes);
    const existing = this.resetDueAtByOrderId.get(order.orderId);
    if (existing) return existing;

    const minMs = minMinutes * 60_000;
    const maxMs = maxMinutes * 60_000;
    const dueAt = Date.now() + this.randomBetween(minMs, maxMs);
    this.resetDueAtByOrderId.set(order.orderId, dueAt);
    return dueAt;
  }

  private randomBetween(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  private getRemainingOrderSize(rawOrder: RawOrderLike, activeOrder: ActiveOrder): Decimal {
    const original = this.safeDecimal(rawOrder.original_size ?? rawOrder.size, activeOrder.size);
    const matched = this.safeDecimal(rawOrder.size_matched ?? rawOrder.matched_size, 0);
    const remaining = original.minus(matched);
    return remaining.greaterThan(0) ? remaining : new Decimal(0);
  }

  private safeDecimal(value: unknown, fallback: number): Decimal {
    try {
      if (value == null || value === "") return new Decimal(fallback);
      return new Decimal(value as Decimal.Value);
    } catch {
      return new Decimal(fallback);
    }
  }

  private cleanupOrderRuntimeState(activeOrders: ActiveOrder[]): void {
    const activeIds = new Set(activeOrders.map((order) => order.orderId));
    for (const orderId of this.resetDueAtByOrderId.keys()) {
      if (!activeIds.has(orderId)) {
        this.resetDueAtByOrderId.delete(orderId);
      }
    }
  }

  private normalizeRestBook(tokenId: string, rawBook: unknown): OrderBook | null {
    if (!this.isRawRestBook(rawBook)) {
      return null;
    }

    const bids = rawBook.bids
      .map((level) => ({
        price: new Decimal(level.price),
        size: new Decimal(level.size),
      }))
      .filter((level) => level.size.greaterThan(0))
      .sort((a, b) => b.price.minus(a.price).toNumber());

    const asks = rawBook.asks
      .map((level) => ({
        price: new Decimal(level.price),
        size: new Decimal(level.size),
      }))
      .filter((level) => level.size.greaterThan(0))
      .sort((a, b) => a.price.minus(b.price).toNumber());

    return {
      tokenId,
      bids,
      asks,
      timestamp: Date.now(),
    };
  }

  private isRawRestBook(rawBook: unknown): rawBook is Required<RawRestBook> {
    if (!rawBook || typeof rawBook !== "object") return false;
    const candidate = rawBook as RawRestBook;
    return Array.isArray(candidate.bids) && Array.isArray(candidate.asks);
  }

  private emitEvent(type: OrderEvent["type"], order: RawOrderLike, slug: string, reason?: string): void {
    const event: OrderEvent = {
      type,
      accountName: this.account.name,
      orderId: order.id,
      tokenId: order.asset_id,
      marketSlug: slug,
      side: order.side?.toUpperCase() === "BUY" ? "buy" : "sell",
      price: parseFloat(String(order.price)),
      size: parseFloat(String(order.original_size || order.size || "0")),
      timestamp: Date.now(),
      reason,
    };
    store.addEvent(event);
    this.onEvent(event);
  }

  private broadcastState(): void {
    const state = store.accounts.get(this.account.name);
    if (state) {
      this.onStateChange(this.account.name, state);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
