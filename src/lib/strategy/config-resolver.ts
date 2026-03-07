import type { StrategyConfig, StrategyOverride } from "../types";

/**
 * Merge config: global -> accountOverride -> marketOverride
 * Only overrides the 7 fields defined in StrategyOverride; rest kept from global.
 */
export function resolveConfig(
  global: StrategyConfig,
  accountOverride?: StrategyOverride,
  marketOverride?: StrategyOverride,
): StrategyConfig {
  const merged = { ...global };

  for (const override of [accountOverride, marketOverride]) {
    if (!override) continue;
    for (const [key, val] of Object.entries(override)) {
      if (val !== undefined && val !== null) {
        (merged as any)[key] = val;
      }
    }
  }

  return merged;
}
