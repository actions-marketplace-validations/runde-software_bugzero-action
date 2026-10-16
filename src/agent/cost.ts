// The action's own cost estimate. The bugzero app re-prices every run from the
// per-request usage the action reports (with its current model catalog), so new
// models and price changes don't need an action release — this estimate only matters
// for older app versions and models the bundled catalog doesn't know.
import {
  DEFAULT_MODEL,
  callCostUsd,
  pricingFor,
  type CallUsage,
  type Provider,
} from "../models";

export type { Provider };
export type NormalizedUsage = CallUsage;

const warned = new Set<string>();

// Cost of ONE request, priced with the bundled catalog.
export function estimateCostUsd(
  model: string,
  provider: Provider,
  usage: NormalizedUsage,
): number {
  let pricing = pricingFor(model);
  if (!pricing) {
    if (!warned.has(model)) {
      warned.add(model);
      console.warn(
        `bugzero: model "${model}" isn't in this action's price list — estimating with ${DEFAULT_MODEL[provider]} (bugzero prices it exactly).`,
      );
    }
    pricing = pricingFor(DEFAULT_MODEL[provider])!;
  }
  return callCostUsd(pricing, usage);
}
