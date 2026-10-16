// The models the agent can run on — the single source for the Agent page, server-side
// validation, the run context handed to the GitHub Action and run cost estimates
// (computed by the app from the per-request usage the action reports; the action
// bundles this file too, for its own fallback estimate). Keep it dependency-free with
// no imports, so both the Next.js app (incl. client components) and the esbuild action
// bundle can use it.
//
// UI text lives in the Models messages (src/i18n/messages): each model's description
// is Models.descriptions.<modelKey(id)>, each effort's name and hint Models.effort.<id>.
// Model and provider labels are brand names and stay here.

export type Provider = "anthropic" | "openai";

export const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export function isEffort(value: unknown): value is Effort {
  return (EFFORTS as readonly unknown[]).includes(value);
}

// USD per 1M tokens. When one request's prompt (input incl. cached tokens) exceeds
// `longContext.aboveTokens`, that whole request is billed at the long-context rates.
export type Rates = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type ModelPricing = Rates & { longContext?: Rates & { aboveTokens: number } };

export type ModelOption = {
  id: string;
  provider: Provider;
  label: string;
  efforts: Effort[];
  defaultEffort: Effort;
  pricing: ModelPricing;
  recommended?: boolean;
};

const STANDARD_EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

// OpenAI bills prompts over 272K tokens at 2x input/cache and 1.5x output.
function openAiPricing(r: Rates): ModelPricing {
  return {
    ...r,
    longContext: {
      aboveTokens: 272_000,
      input: r.input * 2,
      cacheWrite: r.cacheWrite * 2,
      cacheRead: r.cacheRead * 2,
      output: r.output * 1.5,
    },
  };
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    label: "Claude Opus 5.5",
    efforts: STANDARD_EFFORTS,
    defaultEffort: "medium",
    pricing: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
    recommended: true,
  },
  {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    label: "Claude Sonnet 5.5",
    efforts: STANDARD_EFFORTS,
    defaultEffort: "high",
    pricing: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  },
  {
    id: "claude-fable-5-1",
    provider: "anthropic",
    label: "Claude Fable 5.1",
    efforts: STANDARD_EFFORTS,
    defaultEffort: "high",
    pricing: { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  },
  {
    id: "claude-haiku-5-5",
    provider: "anthropic",
    label: "Claude Haiku 5.5",
    efforts: STANDARD_EFFORTS,
    defaultEffort: "medium",
    pricing: {
      input: 0.1,
      cacheWrite: 0.125,
      cacheRead: 0.01,
      output: 0.5,
      longContext: { aboveTokens: 100_000, input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 },
    },
  },
  {
    id: "gpt-6.1-sol",
    provider: "openai",
    label: "GPT-6.1 Sol",
    efforts: STANDARD_EFFORTS,
    defaultEffort: "medium",
    pricing: openAiPricing({ input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 }),
    recommended: true,
  },
  {
    id: "gpt-6-astra",
    provider: "openai",
    label: "GPT-6 Astra",
    efforts: STANDARD_EFFORTS,
    defaultEffort: "medium",
    pricing: openAiPricing({ input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 }),
  },
  {
    id: "gpt-6-luna",
    provider: "openai",
    label: "GPT-6 Luna",
    efforts: ["none", ...STANDARD_EFFORTS],
    defaultEffort: "medium",
    pricing: openAiPricing({ input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 }),
  },
];

// Models we no longer offer. Stored configs move to the successor; pricing stays so
// runs dispatched with an older id are still estimated correctly.
export const LEGACY_MODELS: Record<
  string,
  { provider: Provider; label: string; successor: string; pricing: ModelPricing }
> = {
  "claude-sonnet-4-6": {
    provider: "anthropic",
    label: "Claude Sonnet 4.6",
    successor: "claude-sonnet-5-5",
    pricing: { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  },
  "claude-opus-4-8": {
    provider: "anthropic",
    label: "Claude Opus 4.8",
    successor: "claude-opus-5-5",
    pricing: { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  },
  "claude-opus-4-6": {
    provider: "anthropic",
    label: "Claude Opus 4.6",
    successor: "claude-opus-5-5",
    pricing: { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  },
  "gpt-5.5": {
    provider: "openai",
    label: "GPT-5.5",
    successor: "gpt-6-astra",
    pricing: { input: 5, cacheWrite: 5, cacheRead: 0.5, output: 30 },
  },
  "gpt-5.4": {
    provider: "openai",
    label: "GPT-5.4",
    successor: "gpt-6.1-sol",
    pricing: { input: 2.5, cacheWrite: 2.5, cacheRead: 0.25, output: 15 },
  },
  "gpt-5.4-mini": {
    provider: "openai",
    label: "GPT-5.4 mini",
    successor: "gpt-6-luna",
    pricing: { input: 0.75, cacheWrite: 0.75, cacheRead: 0.075, output: 4.5 },
  },
};

export const PROVIDERS: { id: Provider; label: string; secretName: string }[] = [
  { id: "anthropic", label: "Anthropic", secretName: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", secretName: "OPENAI_API_KEY" },
];

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-6.1-sol",
};

export function modelsFor(provider: Provider): ModelOption[] {
  return MODELS.filter((m) => m.provider === provider);
}

export function findModel(id: string | null | undefined): ModelOption | undefined {
  return MODELS.find((m) => m.id === id);
}

// A model id as a message key: next-intl nests keys on "." ("gpt-6.1-sol" →
// "gpt-6_1-sol"), so Models.descriptions is keyed by this.
export function modelKey(id: string): string {
  return id.replace(/\./g, "_");
}

// Display name for any model id we know (current or legacy), else the raw id;
// undefined without an id (the UI then shows Models.unknown).
export function modelLabel(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return findModel(id)?.label ?? LEGACY_MODELS[id]?.label ?? id;
}

export function providerLabel(provider: string | null | undefined): string {
  return PROVIDERS.find((p) => p.id === provider)?.label ?? "Anthropic";
}

// Prices for cost estimates — current, legacy, or undefined for an unknown id.
export function pricingFor(id: string): ModelPricing | undefined {
  return findModel(id)?.pricing ?? LEGACY_MODELS[id]?.pricing;
}

// Token usage of ONE model request, normalized across providers: uncached input, cache
// writes, cache reads, output (thinking/reasoning included).
export type CallUsage = {
  inputFull: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

// Cost of one request. Long-context rates apply per request, based on that request's
// whole prompt (uncached + cached tokens).
export function callCostUsd(pricing: ModelPricing, usage: CallUsage): number {
  const prompt = usage.inputFull + usage.cacheWrite + usage.cacheRead;
  const r =
    pricing.longContext && prompt > pricing.longContext.aboveTokens
      ? pricing.longContext
      : pricing;
  return (
    (usage.inputFull * r.input +
      usage.cacheWrite * r.cacheWrite +
      usage.cacheRead * r.cacheRead +
      usage.output * r.output) /
    1_000_000
  );
}

// Cost of a whole run from its per-request usage, or null for a model we can't price.
export function runCostUsd(model: string, calls: CallUsage[]): number | null {
  const pricing = pricingFor(model);
  return pricing ? calls.reduce((sum, c) => sum + callCostUsd(pricing, c), 0) : null;
}

// The price the model picker shows: input / output USD per 1M tokens. `tiered` marks
// Anthropic models with long-context rates, whose price is shown as "from …" (the UI
// formats it with Models.pricing).
export function listPrice(m: ModelOption): { input: number; output: number; tiered: boolean } {
  const p = m.pricing;
  return {
    input: p.input,
    output: p.output,
    tiered: m.provider === "anthropic" && !!p.longContext,
  };
}

export type AgentConfig = { provider: Provider; model: string; effort: Effort };

// The configuration that actually applies: the stored model when we still offer it,
// its successor for a retired id (e.g. claude-sonnet-4-6 → claude-sonnet-5-5), else
// the provider's default. The stored effort is kept when the model supports it.
export function resolveAgentConfig(
  cfg: { provider?: string | null; model?: string | null; effort?: string | null } | null | undefined,
): AgentConfig {
  const provider: Provider = cfg?.provider === "openai" ? "openai" : "anthropic";
  const id = cfg?.model ?? "";
  const candidate = findModel(id) ?? findModel(LEGACY_MODELS[id]?.successor);
  const model =
    candidate && candidate.provider === provider
      ? candidate
      : (findModel(DEFAULT_MODEL[provider]) as ModelOption);
  const effort = model.efforts.includes(cfg?.effort as Effort)
    ? (cfg?.effort as Effort)
    : model.defaultEffort;
  return { provider, model: model.id, effort };
}

// Whether a provider/model/effort combination is one we offer.
export function isValidAgentConfig(provider: string, model: string, effort: string): boolean {
  const m = findModel(model);
  return !!m && m.provider === provider && m.efforts.includes(effort as Effort);
}
