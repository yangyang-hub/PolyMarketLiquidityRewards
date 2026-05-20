import { NextResponse } from "next/server";
import { store } from "@/lib/store/memory-store";
import { getClobHost } from "@/lib/config";

interface OrderBookLevelDto {
  price: number;
  size: number;
}

interface OrderBookDto {
  tokenId: string;
  bids: OrderBookLevelDto[];
  asks: OrderBookLevelDto[];
  timestamp: number;
}

interface RawBookLevel {
  price: string | number;
  size: string | number;
}

interface RawOrderBook {
  bids?: RawBookLevel[];
  asks?: RawBookLevel[];
}

/**
 * GET /api/markets/orderbooks
 * Fetches orderbooks for all discovered market tokens from CLOB REST API.
 * Frontend fallback when WS data is not yet available.
 */
export async function GET() {
  const host = getClobHost();
  const orderbooks: Record<string, OrderBookDto> = {};

  for (const market of store.discoveredMarkets.values()) {
    for (const token of market.tokens) {
      try {
        const resp = await fetch(`${host}/book?token_id=${token.token_id}`);
        if (!resp.ok) continue;
        const raw = await resp.json() as RawOrderBook;
        if (!raw?.bids || !raw?.asks) continue;

        orderbooks[token.token_id] = {
          tokenId: token.token_id,
          bids: raw.bids.map((b) => ({ price: parseFloat(String(b.price)), size: parseFloat(String(b.size)) })),
          asks: raw.asks.map((a) => ({ price: parseFloat(String(a.price)), size: parseFloat(String(a.size)) })),
          timestamp: Date.now(),
        };
      } catch {
        // skip
      }
    }
  }

  return NextResponse.json({ orderbooks });
}
