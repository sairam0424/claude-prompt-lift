import type { PluginOptions, ModelUsage } from "claude-code";

export type Price = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

export const DEFAULT_PRICES: Readonly<Record<string, Price>> = {
  "fable-5-1": {
    input: 11,
    output: 55,
    cacheWrite: 13.75,
    cacheRead: 0.275,
  },
  "sonnet-5-5": {
    input: 2.2,
    output: 11,
    cacheWrite: 2.75,
    cacheRead: 0.11,
  },
  "haiku-5-5": {
    input: 0.11,
    output: 0.55,
    cacheWrite: 0.1375,
    cacheRead: 0.011,
  },
};

export type Config = {
  models: readonly string[];
  effortModels: ReadonlySet<string>;
  maxTokens: number;
  timeoutMsFirst: number;
  timeoutMsNext: number;
  minWords: number;
  maxDraftChars: number;
  includeConversation: boolean;
  conversationMessages: number;
  instructionExclude: readonly string[];
  instructionFileMaxChars: number;
  skillExclude: readonly string[];
  relevantSkills: number;
  skillPlacement: "mention" | "run";
  skillPrefixAllow: readonly string[];
  filePrefix: "plain" | "at";
  keptShareFloor: number;
  maxGrowthChars: number;
  enhanceAction: string;
  prices: Readonly<Record<string, Price>>;
};

// The defaults are the engine's own aliases, so a fresh install works on every
// Claude surface; a Bedrock account pins its `us.*` ids in `pluginConfigs`
// instead (README, "Bedrock users"). They mirror plugin.json.
const DEFAULT_MODEL_CHAIN = "fable,sonnet,haiku";
const DEFAULT_INSTRUCTION_EXCLUDE = "~/.claude/CLAUDE.md,~/CLAUDE.md";
// Empty: every skill Claude lists goes to the model. A person leaves out their
// own noisy namespaces (`sparc:*,gws-*`) in `pluginConfigs`.
const DEFAULT_SKILL_EXCLUDE = "";

/**
 * An alias prices as the current generation of its family: the price-table
 * key `priceFor` reads when the model is exactly the alias, in any case.
 */
export const ALIAS_PRICE_KEYS: Readonly<Record<string, string>> = {
  fable: "fable-5-1",
  sonnet: "sonnet-5-5",
  haiku: "haiku-5-5",
};

export function splitList(value: unknown): string[] {
  // If value is already an array, join it with commas first
  const str = Array.isArray(value) ? value.join(",") : String(value ?? "");

  // Split by comma, trim each item, filter out empty strings, and deduplicate while keeping order
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of str.split(",")) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

export function parseOptions(options: PluginOptions): Config {
  const models = splitList(options.models ?? DEFAULT_MODEL_CHAIN);
  const effortModelsArr = splitList(
    options.effortModels ?? models.slice(0, 2).join(","),
  );

  return {
    models,
    effortModels: new Set(effortModelsArr),
    maxTokens: typeof options.maxTokens === "number" ? options.maxTokens : 2000,
    timeoutMsFirst:
      typeof options.timeoutMsFirst === "number"
        ? options.timeoutMsFirst
        : 30000,
    timeoutMsNext:
      typeof options.timeoutMsNext === "number" ? options.timeoutMsNext : 15000,
    minWords: typeof options.minWords === "number" ? options.minWords : 3,
    maxDraftChars:
      typeof options.maxDraftChars === "number" ? options.maxDraftChars : 4000,
    includeConversation:
      typeof options.includeConversation === "boolean"
        ? options.includeConversation
        : false,
    conversationMessages:
      typeof options.conversationMessages === "number"
        ? options.conversationMessages
        : 6,
    instructionExclude: splitList(
      options.instructionExclude ?? DEFAULT_INSTRUCTION_EXCLUDE,
    ),
    instructionFileMaxChars:
      typeof options.instructionFileMaxChars === "number"
        ? options.instructionFileMaxChars
        : 40000,
    skillExclude: splitList(options.skillExclude ?? DEFAULT_SKILL_EXCLUDE),
    relevantSkills:
      typeof options.relevantSkills === "number" ? options.relevantSkills : 8,
    skillPlacement:
      options.skillPlacement === "mention" || options.skillPlacement === "run"
        ? options.skillPlacement
        : "mention",
    skillPrefixAllow: splitList(options.skillPrefixAllow ?? ""),
    filePrefix:
      options.filePrefix === "plain" || options.filePrefix === "at"
        ? options.filePrefix
        : "plain",
    keptShareFloor:
      typeof options.keptShareFloor === "number" ? options.keptShareFloor : 0.5,
    maxGrowthChars:
      typeof options.maxGrowthChars === "number"
        ? options.maxGrowthChars
        : 1200,
    enhanceAction:
      typeof options.enhanceAction === "string"
        ? options.enhanceAction
        : "app:cycleDiffBase",
    prices: DEFAULT_PRICES,
  };
}

export function priceFor(
  model: string,
  prices: Readonly<Record<string, Price>>,
): Price | undefined {
  // An alias on its own prices as its family's current generation
  const alias = model.toLowerCase();
  if (Object.hasOwn(ALIAS_PRICE_KEYS, alias)) {
    const aliased = prices[ALIAS_PRICE_KEYS[alias]!];
    if (aliased !== undefined) {
      return aliased;
    }
  }
  // Else the first key that is a substring of the model
  for (const key of Object.keys(prices)) {
    if (model.includes(key)) {
      return prices[key];
    }
  }
  return undefined;
}

export function estimateUsd(
  usage: ModelUsage,
  model: string,
  prices: Readonly<Record<string, Price>>,
): number {
  const price = priceFor(model, prices);
  if (!price) {
    return 0;
  }

  const cost =
    ((usage.input_tokens ?? 0) * price.input +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      (usage.output_tokens ?? 0) * price.output) /
    1e6;

  return cost;
}

export function shortModel(id: string): string {
  if (id.includes("fable-5-1")) {
    return "fable 5.1";
  }
  if (id.includes("sonnet-5-5")) {
    return "sonnet 5.5";
  }
  if (id.includes("haiku-5-5")) {
    return "haiku 5.5";
  }
  return id;
}
