/** Cheap-first model routing, opt-in. Tiers are hints, never a quality score. */
import type { ModelChoice, ModelTier, Provider } from "./catalog";

/** Explicit tier first, then catalog order (strongest first, cheapest last). */
export function modelTier(provider: Provider, model: string): ModelTier | undefined {
  const choice = provider.models.find((item) => item.id === model);
  return choice?.tier;
}

function pick(provider: Provider, tier: ModelTier): ModelChoice | undefined {
  const explicit = provider.models.find((item) => item.tier === tier);
  if (explicit) return explicit;
  if (tier === "strong") return provider.models[0];
  if (tier === "cheap") return provider.models[provider.models.length - 1];
  const middle = provider.models[Math.floor(provider.models.length / 2)];
  return middle ?? provider.models[0];
}

/**
 * Routes small first attempts to the cheapest model and failures or large
 * sources to the strongest. A one-model or custom provider is left alone.
 */
export function routeModel(
  provider: Provider,
  input: { sourceLength: number; retry?: boolean },
): string | undefined {
  if (provider.custom || provider.models.length <= 1) return provider.models[0]?.id;
  if (input.retry || input.sourceLength > 8_000) return pick(provider, "strong")?.id;
  if (input.sourceLength < 2_500) return pick(provider, "cheap")?.id;
  return pick(provider, "balanced")?.id ?? pick(provider, "cheap")?.id;
}
