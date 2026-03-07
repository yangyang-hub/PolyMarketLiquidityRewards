import { getGammaHost } from "../config";
import type { MarketInfo } from "../types";

interface GammaMarketResp {
  condition_id: string;
  question_id: string;
  slug: string;
  question: string;
  active: boolean;
  closed: boolean;
  neg_risk: boolean;
  tokens: {
    token_id: string;
    outcome: string;
    winner: boolean;
  }[];
  rewards?: {
    max_spread: number;
    min_size: number;
  };
  liquidity: number;
}

function mapToMarketInfo(m: GammaMarketResp): MarketInfo {
  return {
    condition_id: m.condition_id,
    question_id: m.question_id,
    slug: m.slug,
    question: m.question,
    active: m.active,
    closed: m.closed,
    neg_risk: m.neg_risk,
    tokens: m.tokens || [],
    rewards: m.rewards,
    liquidity: m.liquidity || 0,
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
