import { getGammaHost } from "../config";
import type { MarketInfo, MarketToken } from "../types";

/**
 * Gamma API returns camelCase fields + tokens as separate JSON strings.
 * Map to our internal MarketInfo structure.
 */
interface GammaMarketResp {
  conditionId: string;
  questionID: string;
  slug: string;
  question: string;
  active: boolean;
  closed: boolean;
  negRisk: boolean;
  clobTokenIds: string; // JSON string: '["tokenId1", "tokenId2"]'
  outcomes: string; // JSON string: '["Yes", "No"]'
  rewardsMinSize: number;
  rewardsMaxSpread: number;
  liquidity: string | number;
}

function mapToMarketInfo(m: GammaMarketResp): MarketInfo {
  // Parse clobTokenIds and outcomes from JSON strings
  let tokenIds: string[] = [];
  let outcomeNames: string[] = [];
  try {
    tokenIds = JSON.parse(m.clobTokenIds || "[]");
  } catch { tokenIds = []; }
  try {
    outcomeNames = JSON.parse(m.outcomes || "[]");
  } catch { outcomeNames = []; }

  const tokens: MarketToken[] = tokenIds.map((id, i) => ({
    token_id: id,
    outcome: outcomeNames[i] || `Outcome ${i}`,
    winner: false,
  }));

  return {
    condition_id: m.conditionId,
    question_id: m.questionID,
    slug: m.slug,
    question: m.question,
    active: m.active,
    closed: m.closed,
    neg_risk: m.negRisk ?? false,
    tokens,
    rewards: m.rewardsMaxSpread ? {
      max_spread: m.rewardsMaxSpread,
      min_size: m.rewardsMinSize,
    } : undefined,
    liquidity: typeof m.liquidity === "string" ? parseFloat(m.liquidity) || 0 : m.liquidity || 0,
  };
}

export async function fetchMarketByConditionId(conditionId: string): Promise<MarketInfo | null> {
  const host = getGammaHost();
  const url = `${host}/markets?condition_id=${conditionId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Gamma API error: ${resp.status}`);
  const data: GammaMarketResp[] = await resp.json();
  if (data.length === 0) return null;
  return mapToMarketInfo(data[0]);
}

export async function fetchMarketBySlug(slug: string): Promise<MarketInfo | null> {
  const host = getGammaHost();
  const url = `${host}/markets?slug=${slug}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Gamma API error: ${resp.status}`);
  const data: GammaMarketResp[] = await resp.json();
  if (data.length === 0) return null;
  return mapToMarketInfo(data[0]);
}
