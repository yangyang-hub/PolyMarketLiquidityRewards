import Decimal from "decimal.js";
import type {
  AccountConfig,
  AccountState,
  ActiveOrder,
  OrderEvent,
} from "../types";
import { ClobExecutor } from "../clob/executor";
import { shouldCancelDepthOrder } from "../strategy/depth-strategy";
import { store } from "../store/memory-store";

export class AccountEngine {
  private account: AccountConfig;
  private executor: ClobExecutor;
  private running = false;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private cancelling = false; // guard for realtimeCheck
  private onEvent: (event: OrderEvent) => void;
  private onStateChange: (name: string, state: AccountState) => void;
  private onTokensDiscovered: (accountName: string, tokenIds: Set<string>) => void;

  private static PERIODIC_MS = 15_000; // 15s full refresh

  constructor(
    account: AccountConfig,
    onEvent: (event: OrderEvent) => void,
    onStateChange: (name: string, state: AccountState) => void,
    onTokensDiscovered: (accountName: string, tokenIds: Set<string>) => void,
  ) {
    this.account = account;
    this.executor = new ClobExecutor(account);
    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
    this.onTokensDiscovered = onTokensDiscovered;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[Engine:${this.account.name}] Starting...`);

    try {
      await this.executor.initApiKeys();
      const balance = await this.executor.getCollateralBalance();
      store.updateAccount(this.account.name, { status: "running", balance });
      this.broadcastState();

      // Initial discovery: pull orders immediately to trigger subscriptions
      await this.discover();

      // Start periodic full tick (refresh order list + balance from API)
      this.periodicTimer = setInterval(async () => {
        if (!this.running || this.ticking) return;
        this.ticking = true;
        try {
          await this.tick();
        } catch (e: any) {
          console.error(`[Engine:${this.account.name}] Periodic tick error:`, e.message);
        }
        this.ticking = false;
      }, AccountEngine.PERIODIC_MS);
    } catch (e: any) {
      console.error(`[Engine:${this.account.name}] Init failed:`, e.message);
      store.updateAccount(this.account.name, { status: "error", error: e.message });
      this.broadcastState();
      this.running = false;
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
  async cancelAllOrders(): Promise<void> {
    await this.executor.cancelAll();
  }

  /**
   * Called by manager when an orderbook update arrives.
   * Immediately checks cached orders against the new book — no API call, no debounce.
   */
  onBookUpdate(tokenId: string): void {
    if (!this.running) return;
    this.realtimeCancelCheck(tokenId);
  }

  /** Initial discovery: pull orders once to trigger subscriptions */
  private async discover(): Promise<void> {
    try {
      await this.tick();
    } catch (e: any) {
      console.error(`[Engine:${this.account.name}] Discover error:`, e.message);
    }
  }

  /**
   * Realtime cancel check: uses cached activeOrders from store (no API call).
   * Only checks orders matching the updated tokenId.
   */
  private async realtimeCancelCheck(tokenId: string): Promise<void> {
    if (this.cancelling) return;
    this.cancelling = true;
    try {
      const cancelDepthLevel = store.config.cancelDepthLevel;
      if (cancelDepthLevel === 0) return;

      const book = store.orderbooks.get(tokenId);
      if (!book) return;

      const accountState = store.accounts.get(this.account.name);
      if (!accountState) return;

      const ordersForToken = accountState.activeOrders.filter((o) => o.tokenId === tokenId);
      if (ordersForToken.length === 0) return;

      for (const order of ordersForToken) {
        const orderPrice = new Decimal(order.priceStr);
        const isBuy = order.side === "buy";

        if (shouldCancelDepthOrder(book, orderPrice, isBuy, cancelDepthLevel)) {
          const slug = order.marketSlug || this.findSlugForToken(tokenId);
          console.log(`[Engine:${this.account.name}] Cancelling ${order.orderId} (realtime depth trigger, token=${tokenId.slice(0, 12)}...)`);
          const cancelled = await this.executor.cancelOrder(order.orderId);
          if (cancelled) {
            this.emitEvent("cancelled", {
              id: order.orderId,
              asset_id: order.tokenId,
              side: order.side === "buy" ? "BUY" : "SELL",
              price: order.priceStr,
              original_size: String(order.size),
            }, slug);

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
      }
    } catch (e: any) {
      console.error(`[Engine:${this.account.name}] Realtime check error:`, e.message);
    } finally {
      this.cancelling = false;
    }
  }

  /**
   * Full tick: pulls fresh orders from API, refreshes balance, syncs tokenIds.
   * Called periodically (every 15s) and on initial discovery.
   */
  private async tick(): Promise<void> {
    const cancelDepthLevel = store.config.cancelDepthLevel;

    // 1. Get all open orders from API
    const openOrders = await this.executor.getOpenOrders();
    const trackedOrders: ActiveOrder[] = [];
    const activeTokenIds = new Set<string>();

    console.log(`[Engine:${this.account.name}] Tick: ${openOrders.length} open orders, cancelDepth=${cancelDepthLevel}`);

    // Check scoring status
    const allOrderIds = openOrders.map((o) => o.id);
    const scoringMap = allOrderIds.length > 0
      ? await this.executor.areOrdersScoring(allOrderIds)
      : {};

    // 2. Process each order: check cancel condition
    for (const order of openOrders) {
      const tokenId = order.asset_id;
      activeTokenIds.add(tokenId);

      const book = store.orderbooks.get(tokenId);
      const orderPrice = new Decimal(order.price);
      const isBuy = order.side?.toUpperCase() === "BUY";

      const slug = this.findSlugForToken(tokenId);

      if (book && cancelDepthLevel > 0) {
        const shouldCancel = shouldCancelDepthOrder(book, orderPrice, isBuy, cancelDepthLevel);

        if (shouldCancel) {
          console.log(`[Engine:${this.account.name}] Cancelling ${order.id} (tick depth trigger, token=${tokenId.slice(0, 12)}...)`);
          const cancelled = await this.executor.cancelOrder(order.id);
          if (cancelled) {
            this.emitEvent("cancelled", order, slug);
          } else {
            trackedOrders.push(this.toActiveOrder(order, slug, scoringMap));
          }
        } else {
          trackedOrders.push(this.toActiveOrder(order, slug, scoringMap));
        }
      } else {
        trackedOrders.push(this.toActiveOrder(order, slug, scoringMap));
      }
    }

    // 3. Notify manager of active tokenIds for subscription management
    this.onTokensDiscovered(this.account.name, activeTokenIds);

    // Update account state
    const freshBalance = await this.executor.getCollateralBalance();
    const uniqueOrders = Array.from(
      new Map(trackedOrders.map((o) => [o.orderId, o])).values(),
    );
    const prev = store.accounts.get(this.account.name);
    const balanceChanged = prev?.balance !== freshBalance;
    const ordersChanged = prev?.activeOrders.length !== uniqueOrders.length;
    store.updateAccount(this.account.name, {
      activeOrders: uniqueOrders,
      marketsCount: activeTokenIds.size,
      balance: freshBalance,
    });
    if (balanceChanged || ordersChanged) {
      this.broadcastState();
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
    order: any,
    slug: string,
    scoringMap: Record<string, boolean>,
  ): ActiveOrder {
    return {
      orderId: order.id,
      tokenId: order.asset_id,
      marketSlug: slug,
      side: order.side?.toUpperCase() === "BUY" ? "buy" : "sell",
      price: parseFloat(order.price),
      priceStr: order.price,
      size: parseFloat(order.original_size),
      status: "open",
      scoring: scoringMap[order.id] === true,
      timestamp: Date.now(),
    };
  }

  private emitEvent(type: OrderEvent["type"], order: any, slug: string): void {
    const event: OrderEvent = {
      type,
      accountName: this.account.name,
      orderId: order.id,
      tokenId: order.asset_id,
      marketSlug: slug,
      side: order.side?.toUpperCase() === "BUY" ? "buy" : "sell",
      price: parseFloat(order.price),
      size: parseFloat(order.original_size || order.size || "0"),
      timestamp: Date.now(),
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
}
