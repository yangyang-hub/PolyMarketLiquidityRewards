import { NextResponse } from "next/server";
import { store } from "@/lib/store/memory-store";
import { getClobHost } from "@/lib/config";

/**
 * GET /api/markets/orderbooks
 * Fetches orderbooks for all managed market tokens from CLOB REST API.
 * Frontend fallback when WS data is not yet available.
 */
export async function GET() {
  const host = getClobHost();
  const orderbooks: Record<string, { tokenId: string; bids: any[]; asks: any[]; timestamp: number }> = {};

  for (const market of store.managedMarkets) {
    for (const token of market.tokens) {
      try {
        const resp = await fetch(`${host}/book?token_id=${token.token_id}`);
        if (!resp.ok) continue;
        const raw = await resp.json();
        if (!raw?.bids || !raw?.asks) continue;

        orderbooks[token.token_id] = {
          tokenId: token.token_id,
          bids: raw.bids.map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
          asks: raw.asks.map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
          timestamp: Date.now(),
        };
      } catch {
        // skip
      }
    }
  }

  return NextResponse.json({ orderbooks });
}
