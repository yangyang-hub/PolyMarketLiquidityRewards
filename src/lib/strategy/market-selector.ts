import Decimal from "decimal.js";
import type { MarketInfo, ClobRewardData, RewardMarketCandidate, StrategyConfig } from "../types";

export function selectRewardMarkets(
  markets: MarketInfo[],
  clobRewards: ClobRewardData[],
  config: StrategyConfig,
): RewardMarketCandidate[] {
  // Build lookup by condition_id
  const rewardsMap = new Map<string, ClobRewardData>();
  for (const r of clobRewards) {
    rewardsMap.set(r.conditionId, r);
  }

  const candidates: RewardMarketCandidate[] = [];

  for (const market of markets) {
    // Filter: active, binary (2 tokens), not negRisk
    if (!market.active) continue;
    if (market.tokens.length !== 2) continue;
    if (market.neg_risk) continue;

    // Must be in CLOB rewards
    const reward = rewardsMap.get(market.condition_id);
    if (!reward) continue;

    // Daily rate filter
    if (reward.totalDailyRate.lessThan(config.minDailyRate)) continue;

    // Density = daily_rate / (liquidity + 1)
    const density = reward.totalDailyRate.dividedBy(
      new Decimal(market.liquidity || 0).plus(1)
    );

    candidates.push({
      market,
      density,
      clobRewardsMaxSpread: reward.rewardsMaxSpread,
      clobRewardsMinSize: reward.rewardsMinSize,
      dailyRate: reward.totalDailyRate,
    });
  }

  // Sort by density descending
  candidates.sort((a, b) => b.density.minus(a.density).toNumber());

  // Truncate to maxMarkets
  return candidates.slice(0, config.maxMarkets);
}
