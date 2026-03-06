import Decimal from "decimal.js";
import type {
  AccountConfig,
  AccountState,
  ActiveOrder,
  OrderEvent,
} from "../types";
import { midpoint } from "../types";
import { ClobExecutor } from "../clob/executor";
import {
  computeDepthQuotes,
  computeQuotes,
  shouldCancelDepthOrder,
} from "../strategy/depth-strategy";
import { store } from "../store/memory-store";

export class AccountEngine {
  private account: AccountConfig;
  private executor: ClobExecutor;
  private running = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private onEvent: (event: OrderEvent) => void;
  private onStateChange: (name: string, state: AccountState) => void;

  constructor(
    account: AccountConfig,
    onEvent: (event: OrderEvent) => void,
    onStateChange: (name: string, state: AccountState) => void,
  ) {
    this.account = account;
    this.executor = new ClobExecutor(account);
    this.onEvent = onEvent;
    this.onStateChange = onStateChange;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[Engine:${this.account.name}] Starting...`);

    try {
      await this.executor.initApiKeys();
      store.updateAccount(this.account.name, { status: "running" });
      this.broadcastState();
      this.loop();
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

    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    // Cancel all orders and wait for completion
    try {
      await this.executor.cancelAll();
    } catch (e: any) {
      console.error(`[Engine:${this.account.name}] cancelAll failed:`, e.message);
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

  private async loop(): Promise<void> {
    if (!this.running) return;

    try {
      await this.tick();
    } catch (e: any) {
      console.error(`[Engine:${this.account.name}] Tick error:`, e.message);
    }

    if (this.running) {
      const interval = store.config.quoteRefreshSecs * 1000;
      this.loopTimer = setTimeout(() => this.loop(), interval);
    }
  }

  private async tick(): Promise<void> {
    const config = store.config;
    const markets = store.rewardMarkets.filter((c) =>
      store.enabledMarketIds.has(c.market.condition_id),
    );

    if (markets.length === 0) {
      console.log(`[Engine:${this.account.name}] No reward markets available`);
      return;
    }

    // Get all open orders
    const openOrders = await this.executor.getOpenOrders();
    const trackedOrders: ActiveOrder[] = [];

    // Build map of token → orders
    const ordersByToken = new Map<string, typeof openOrders>();
    for (const o of openOrders) {
      const list = ordersByToken.get(o.asset_id) || [];
      list.push(o);
      ordersByToken.set(o.asset_id, list);
    }

    // Check scoring status
    const allOrderIds = openOrders.map((o) => o.id);
    const scoringMap = await this.executor.areOrdersScoring(allOrderIds);

    // Process each market
    for (const candidate of markets) {
      const { market } = candidate;

      for (const token of market.tokens) {
        const tokenId = token.token_id;
        const isYes = token.outcome === "Yes";

        // Skip if config says no
        if (isYes && !config.quoteYes) continue;
        if (!isYes && !config.quoteNo) continue;

        // Get orderbook
        const book = store.orderbooks.get(tokenId);
        if (!book || book.bids.length === 0 || book.asks.length === 0) continue;

        const existingOrders = ordersByToken.get(tokenId) || [];

        // Check existing orders: should we cancel?
        for (const order of existingOrders) {
          const orderPrice = new Decimal(order.price);
          const isBuy = order.side?.toUpperCase() === "BUY";

          if (config.orderDepthLevel > 0) {
            const shouldCancel = shouldCancelDepthOrder(
              book,
              orderPrice,
              isBuy,
              config.cancelDepthLevel,
            );

            if (shouldCancel) {
              console.log(`[Engine:${this.account.name}] Cancelling ${order.id} (depth trigger)`);
              const cancelled = await this.executor.cancelOrder(order.id);
              if (cancelled) {
                this.emitEvent("cancelled", order, market.slug);
              }
            } else {
              // Track as active
              trackedOrders.push(this.toActiveOrder(order, market.slug, scoringMap));
              continue;
            }
          }
        }

        // Place new orders if we have no active ones
        // Compute quotes
        let quote = null;
        if (config.orderDepthLevel > 0) {
          quote = computeDepthQuotes(
            book,
            config.orderDepthLevel,
            candidate.clobRewardsMaxSpread,
            new Decimal(0), // position tracking simplified
            config,
            candidate.clobRewardsMinSize,
          );
        } else {
          const mid = midpoint(book);
          if (mid) {
            quote = computeQuotes(
              mid,
              candidate.clobRewardsMaxSpread,
              new Decimal(0),
              config,
              candidate.clobRewardsMinSize,
              new Decimal("0.01"),
            );
          }
        }

        if (!quote) continue;

        // Check if we already have orders at these prices
        const hasBuyAtPrice = existingOrders.some(
          (o) =>
            o.side?.toUpperCase() === "BUY" &&
            new Decimal(o.price).equals(quote!.bidPrice),
        );
        const hasSellAtPrice = existingOrders.some(
          (o) =>
            o.side?.toUpperCase() === "SELL" &&
            new Decimal(o.price).equals(quote!.askPrice),
        );

        // Place buy
        if (!hasBuyAtPrice && config.quoteYes) {
          const orderId = await this.executor.buyLimitPostOnly(
            tokenId,
            quote.bidPrice,
            quote.size,
          );
          if (orderId) {
            const activeOrder: ActiveOrder = {
              orderId,
              tokenId,
              marketSlug: market.slug,
              side: "buy",
              price: quote.bidPrice.toNumber(),
              size: quote.size.toNumber(),
              status: "open",
              scoring: false,
              timestamp: Date.now(),
            };
            trackedOrders.push(activeOrder);
            this.emitEvent("placed", { id: orderId, asset_id: tokenId, side: "BUY", price: quote.bidPrice.toString(), original_size: quote.size.toString() } as any, market.slug);
          }
        }

        // Place sell
        if (!hasSellAtPrice && config.quoteNo) {
          const orderId = await this.executor.sellLimitPostOnly(
            tokenId,
            quote.askPrice,
            quote.size,
          );
          if (orderId) {
            const activeOrder: ActiveOrder = {
              orderId,
              tokenId,
              marketSlug: market.slug,
              side: "sell",
              price: quote.askPrice.toNumber(),
              size: quote.size.toNumber(),
              status: "open",
              scoring: false,
              timestamp: Date.now(),
            };
            trackedOrders.push(activeOrder);
            this.emitEvent("placed", { id: orderId, asset_id: tokenId, side: "SELL", price: quote.askPrice.toString(), original_size: quote.size.toString() } as any, market.slug);
          }
        }
      }
    }

    // Update account state
    store.updateAccount(this.account.name, {
      activeOrders: trackedOrders,
      marketsCount: markets.length,
    });
    this.broadcastState();
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
