import Decimal from "decimal.js";
import type {
  AccountConfig,
  AccountState,
  ActiveOrder,
  OrderEvent,
} from "../types";
import { ClobExecutor } from "../clob/executor";
import {
  computeDepthQuotes,
  shouldCancelDepthOrder,
} from "../strategy/depth-strategy";
import { resolveConfig } from "../strategy/config-resolver";
import { store } from "../store/memory-store";

export class AccountEngine {
  private account: AccountConfig;
  private executor: ClobExecutor;
  private running = false;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private onEvent: (event: OrderEvent) => void;
  private onStateChange: (name: string, state: AccountState) => void;

  private static DEBOUNCE_MS = 2000; // coalesce rapid book updates

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
      const balance = await this.executor.getCollateralBalance();
      store.updateAccount(this.account.name, { status: "running", balance });
      this.broadcastState();
      // Run initial tick immediately
      this.scheduleTick();
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

    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
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

  /** Cancel a single order by ID */
  async cancelOrderById(orderId: string): Promise<boolean> {
    return this.executor.cancelOrder(orderId);
  }

  /** Cancel all open orders for this account */
  async cancelAllOrders(): Promise<void> {
    await this.executor.cancelAll();
  }

  /** Called by manager when an orderbook update arrives. Debounces into a tick. */
  onBookUpdate(_tokenId: string): void {
    if (!this.running) return;
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (this.tickTimer) return; // already scheduled
    this.tickTimer = setTimeout(async () => {
      this.tickTimer = null;
      if (!this.running || this.ticking) return;
      this.ticking = true;
      try {
        await this.tick();
      } catch (e: any) {
        console.error(`[Engine:${this.account.name}] Tick error:`, e.message);
      }
      this.ticking = false;
    }, AccountEngine.DEBOUNCE_MS);
  }

  private async tick(): Promise<void> {
    const markets = store.managedMarkets.filter((m) => m.active);

    if (markets.length === 0) {
      console.log(`[Engine:${this.account.name}] No managed markets available`);
      return;
    }

    console.log(`[Engine:${this.account.name}] Tick: ${markets.length} markets, ${store.orderbooks.size} orderbooks cached`);

    // Get all open orders
    const openOrders = await this.executor.getOpenOrders();
    const trackedOrders: ActiveOrder[] = [];

    // Build map of token -> orders
    const ordersByToken = new Map<string, typeof openOrders>();
    for (const o of openOrders) {
      const list = ordersByToken.get(o.asset_id) || [];
      list.push(o);
      ordersByToken.set(o.asset_id, list);
    }

    // Check scoring status
    const allOrderIds = openOrders.map((o) => o.id);
    const scoringMap = await this.executor.areOrdersScoring(allOrderIds);

    // Track which orders were cancelled this tick
    const cancelledOrderIds = new Set<string>();

    // Get account balance for sizing (same balance available for all tokens)
    const accountState = store.accounts.get(this.account.name);
    const balance = new Decimal(accountState?.balance || 0);
    console.log(`[Engine:${this.account.name}] Balance: $${balance}`);

    // Process each market
    for (const market of markets) {
      // Resolve layered config: global -> account override -> market override
      const config = resolveConfig(
        store.config,
        store.accountOverrides[this.account.name],
        store.marketOverrides[market.conditionId],
      );

      const rewardsMaxSpread = new Decimal(market.rewardsMaxSpread);
      const rewardsMinSize = new Decimal(market.rewardsMinSize);

      for (const token of market.tokens) {
        const tokenId = token.token_id;

        // Skip based on outcome type
        // First token = "Yes" side, second token = "No" side
        const tokenIndex = market.tokens.indexOf(token);
        const isFirstOutcome = tokenIndex === 0;

        if (isFirstOutcome && !config.quoteYes) continue;
        if (!isFirstOutcome && !config.quoteNo) continue;

        // Get orderbook
        const book = store.orderbooks.get(tokenId);
        if (!book || book.bids.length === 0 || book.asks.length === 0) {
          console.log(`[Engine:${this.account.name}] ${token.outcome}: no orderbook data (bids=${book?.bids.length ?? 0}, asks=${book?.asks.length ?? 0})`);
          continue;
        }

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
                cancelledOrderIds.add(order.id);
                this.emitEvent("cancelled", order, market.slug);
              }
            } else {
              // Track as active
              trackedOrders.push(this.toActiveOrder(order, market.slug, scoringMap));
            }
          }
        }

        // Compute quotes at depth level
        const quote = computeDepthQuotes(
          book,
          config.orderDepthLevel,
          rewardsMaxSpread,
          new Decimal(0),
          config,
          rewardsMinSize,
          balance,
        );

        if (!quote) {
          console.log(`[Engine:${this.account.name}] ${token.outcome}: quote=null (depth=${config.orderDepthLevel}, bids=${book.bids.length}, asks=${book.asks.length}, maxSpread=${rewardsMaxSpread})`);
          continue;
        }

        console.log(`[Engine:${this.account.name}] ${token.outcome}: quote bid=${quote.bidPrice}×${quote.bidSize} ask=${quote.askPrice}×${quote.askSize}`);

        // Check if we already have LIVE (non-cancelled) orders at these prices
        const hasBuyAtPrice = existingOrders.some(
          (o) =>
            !cancelledOrderIds.has(o.id) &&
            o.side?.toUpperCase() === "BUY" &&
            new Decimal(o.price).equals(quote!.bidPrice),
        );
        const hasSellAtPrice = existingOrders.some(
          (o) =>
            !cancelledOrderIds.has(o.id) &&
            o.side?.toUpperCase() === "SELL" &&
            new Decimal(o.price).equals(quote!.askPrice),
        );

        // Place buy
        if (!hasBuyAtPrice && quote.bidSize.greaterThan(0)) {
          const orderId = await this.executor.buyLimitPostOnly(
            tokenId,
            quote.bidPrice,
            quote.bidSize,
          );
          if (orderId) {
            const activeOrder: ActiveOrder = {
              orderId,
              tokenId,
              marketSlug: market.slug,
              side: "buy",
              price: quote.bidPrice.toNumber(),
              size: quote.bidSize.toNumber(),
              status: "open",
              scoring: false,
              timestamp: Date.now(),
            };
            trackedOrders.push(activeOrder);
            this.emitEvent("placed", { id: orderId, asset_id: tokenId, side: "BUY", price: quote.bidPrice.toString(), original_size: quote.bidSize.toString() } as any, market.slug);
          }
        }

        // Place sell
        if (!hasSellAtPrice && quote.askSize.greaterThan(0)) {
          const orderId = await this.executor.sellLimitPostOnly(
            tokenId,
            quote.askPrice,
            quote.askSize,
          );
          if (orderId) {
            const activeOrder: ActiveOrder = {
              orderId,
              tokenId,
              marketSlug: market.slug,
              side: "sell",
              price: quote.askPrice.toNumber(),
              size: quote.askSize.toNumber(),
              status: "open",
              scoring: false,
              timestamp: Date.now(),
            };
            trackedOrders.push(activeOrder);
            this.emitEvent("placed", { id: orderId, asset_id: tokenId, side: "SELL", price: quote.askPrice.toString(), original_size: quote.askSize.toString() } as any, market.slug);
          }
        }
      }
    }

    // Update account state (including fresh balance)
    const freshBalance = await this.executor.getCollateralBalance();
    store.updateAccount(this.account.name, {
      activeOrders: trackedOrders,
      marketsCount: markets.length,
      balance: freshBalance,
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
