import { getGammaHost } from "../config";
import type { MarketInfo } from "../types";

const GAMMA_MARKETS_ENDPOINT = "/markets";

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

export async function fetchGammaMarkets(limit = 100, offset = 0): Promise<MarketInfo[]> {
  const host = getGammaHost();
  const url = `${host}${GAMMA_MARKETS_ENDPOINT}?limit=${limit}&offset=${offset}&active=true&closed=false`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Gamma API error: ${resp.status} ${resp.statusText}`);
  }

  const data: GammaMarketResp[] = await resp.json();
  return data.map((m) => ({
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
  }));
}

export async function fetchAllActiveMarkets(): Promise<MarketInfo[]> {
  const allMarkets: MarketInfo[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const batch = await fetchGammaMarkets(limit, offset);
    allMarkets.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return allMarkets;
}
