import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { engineManager } from "@/lib/engine/manager";
import { store } from "@/lib/store/memory-store";

export async function GET() {
  const markets = engineManager.getRewardMarkets();
  const dto = markets.map((m) => ({
    conditionId: m.market.condition_id,
    slug: m.market.slug,
    question: m.market.question,
    density: m.density instanceof Decimal ? m.density.toNumber() : m.density,
    dailyRate: m.dailyRate instanceof Decimal ? m.dailyRate.toNumber() : m.dailyRate,
    maxSpread: m.clobRewardsMaxSpread instanceof Decimal ? m.clobRewardsMaxSpread.toNumber() : m.clobRewardsMaxSpread,
    minSize: m.clobRewardsMinSize instanceof Decimal ? m.clobRewardsMinSize.toNumber() : m.clobRewardsMinSize,
    liquidity: m.market.liquidity,
    tokens: m.market.tokens,
    enabled: store.isMarketEnabled(m.market.condition_id),
  }));
  return NextResponse.json({ markets: dto });
}
