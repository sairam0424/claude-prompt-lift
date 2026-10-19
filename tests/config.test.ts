import { expect, test } from "claude-code/testing";
import {
  splitList,
  parseOptions,
  estimateUsd,
  shortModel,
  ALIAS_PRICE_KEYS,
  DEFAULT_PRICES,
  priceFor,
  parsePrices,
} from "../hooks/config";

test("splitList dedupes and trims", async () => {
  expect(splitList(" a, b ,a,,")).toEqual(["a", "b"]);
});

test("splitList handles arrays", async () => {
  expect(splitList(["x", "y", "x"])).toEqual(["x", "y"]);
});

test("splitList handles empty input", async () => {
  expect(splitList("")).toEqual([]);
  expect(splitList([])).toEqual([]);
});

test("parseOptions fills defaults and dedupes the chain", async () => {
  const c = parseOptions({ models: "x,y,x", minWords: 2 });
  expect(c.models).toEqual(["x", "y"]);
  expect(c.minWords).toBe(2);
  expect(c.maxTokens).toBe(2000);
  expect(parseOptions({}).models).toEqual(["fable", "sonnet", "haiku"]);
});

test("parseOptions effortModels defaults to first two from chain", async () => {
  const c = parseOptions({});
  expect(Array.from(c.effortModels)).toEqual(["fable", "sonnet"]);
  expect(c.effortModels.has("haiku")).toBe(false);
});

test("parseOptions skillExclude defaults to nothing excluded", async () => {
  expect(parseOptions({}).skillExclude).toEqual([]);
  expect(parseOptions({ skillExclude: "sparc:*,gws-*" }).skillExclude).toEqual([
    "sparc:*",
    "gws-*",
  ]);
});

test("parseOptions handles all field types correctly", async () => {
  const c = parseOptions({
    maxTokens: 1000,
    timeoutMsFirst: 60000,
    includeConversation: true,
    skillPlacement: "run",
    filePrefix: "at",
  });
  expect(c.maxTokens).toBe(1000);
  expect(c.timeoutMsFirst).toBe(60000);
  expect(c.includeConversation).toBe(true);
  expect(c.skillPlacement).toBe("run");
  expect(c.filePrefix).toBe("at");
});

test("parseOptions ignores wrong types", async () => {
  const c = parseOptions({
    maxTokens: "wrong" as any,
    includeConversation: "yes" as any,
    skillPlacement: "invalid" as any,
  });
  expect(c.maxTokens).toBe(2000); // falls back to default
  expect(c.includeConversation).toBe(false); // falls back to default
  expect(c.skillPlacement).toBe("mention"); // falls back to default
});

test("parseOptions accepts array inputs for list fields", async () => {
  const c = parseOptions({
    models: ["a", "b"],
    effortModels: ["a"],
    instructionExclude: ["~/x", "~/y"],
    skillExclude: ["foo:*", "bar:*"],
    skillPrefixAllow: ["baz", "qux"],
  });
  expect(c.models).toEqual(["a", "b"]);
  expect(Array.from(c.effortModels)).toEqual(["a"]);
  expect(c.instructionExclude).toEqual(["~/x", "~/y"]);
  expect(c.skillExclude).toEqual(["foo:*", "bar:*"]);
  expect(c.skillPrefixAllow).toEqual(["baz", "qux"]);
});

test("priceFor finds model by substring", async () => {
  const price = priceFor("us.anthropic.claude-fable-5-1", DEFAULT_PRICES);
  expect(price).toEqual({
    input: 11,
    output: 55,
    cacheWrite: 13.75,
    cacheRead: 0.275,
  });
});

test("priceFor maps an alias to the current generation of its family", async () => {
  expect(ALIAS_PRICE_KEYS).toEqual({
    fable: "fable-5-1",
    sonnet: "sonnet-5-5",
    haiku: "haiku-5-5",
  });
  expect(priceFor("fable", DEFAULT_PRICES)).toEqual(
    DEFAULT_PRICES["fable-5-1"],
  );
  expect(priceFor("SONNET", DEFAULT_PRICES)).toEqual(
    DEFAULT_PRICES["sonnet-5-5"],
  );
  expect(priceFor("Haiku", DEFAULT_PRICES)).toEqual(
    DEFAULT_PRICES["haiku-5-5"],
  );
  // A full id still prices by substring; an alias matches only whole.
  expect(priceFor("us.anthropic.claude-haiku-5-5", DEFAULT_PRICES)).toEqual(
    DEFAULT_PRICES["haiku-5-5"],
  );
  expect(priceFor("fable-next", DEFAULT_PRICES)).toBeUndefined();
  expect(priceFor("opus", DEFAULT_PRICES)).toBeUndefined();
});

test("priceFor returns undefined for unknown model", async () => {
  expect(priceFor("unknown-model", DEFAULT_PRICES)).toBeUndefined();
});

test("estimateUsd prices a warm Fable press", async () => {
  const usd = estimateUsd(
    {
      input_tokens: 1500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 7000,
      output_tokens: 400,
    },
    "us.anthropic.claude-fable-5-1",
    DEFAULT_PRICES,
  );
  const expected = (1500 * 11 + 7000 * 0.275 + 400 * 55) / 1e6;
  // Check within 6 decimal places (microsecond precision)
  expect(Math.abs((usd ?? 0) - expected)).toBeLessThan(1e-6);
});

test("estimateUsd prices an alias chain as its family's current generation", async () => {
  const usage = {
    input_tokens: 1500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 7000,
    output_tokens: 400,
  };
  const usd = estimateUsd(usage, "fable", DEFAULT_PRICES);
  expect(usd).toBeGreaterThan(0);
  expect(usd).toBe(
    estimateUsd(usage, "us.anthropic.claude-fable-5-1", DEFAULT_PRICES),
  );
});

test("estimateUsd returns undefined for a model with no price (R3)", async () => {
  const usd = estimateUsd(
    {
      input_tokens: 1000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 100,
    },
    "us.anthropic.claude-opus-4-1",
    DEFAULT_PRICES,
  );
  expect(usd).toBeUndefined();
});

test("estimateUsd handles missing token counts", async () => {
  const usd = estimateUsd(
    { input_tokens: 1000 } as any,
    "us.anthropic.claude-sonnet-5-5",
    DEFAULT_PRICES,
  );
  expect(usd).toBe((1000 * 2.2) / 1e6);
});

test("shortModel", async () => {
  expect(shortModel("us.anthropic.claude-sonnet-5-5")).toBe("sonnet 5.5");
  expect(shortModel("haiku")).toBe("haiku");
  expect(shortModel("fable")).toBe("fable");
  expect(shortModel("us.anthropic.claude-fable-5-1")).toBe("fable 5.1");
  expect(shortModel("us.anthropic.claude-haiku-5-5")).toBe("haiku 5.5");
});

test("parsePrices returns empty object for empty string", async () => {
  expect(parsePrices("")).toEqual({});
});

test("parsePrices parses valid JSON with correct Price fields", async () => {
  const json = JSON.stringify({
    "custom-model": {
      input: 5,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.1,
    },
  });
  const result = parsePrices(json);
  expect(result).toEqual({
    "custom-model": {
      input: 5,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.1,
    },
  });
});

test("parsePrices returns empty object and logs for invalid JSON", async () => {
  const logs: string[] = [];
  const result = parsePrices("{invalid json}", (msg) => logs.push(msg));
  expect(result).toEqual({});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("prompt-lift: prices option ignored:");
});

test("parsePrices returns empty object and logs for non-object JSON", async () => {
  const logs: string[] = [];
  const result = parsePrices("[]", (msg) => logs.push(msg));
  expect(result).toEqual({});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("prompt-lift: prices option ignored:");
});

test("parsePrices returns empty object and logs for missing fields", async () => {
  const logs: string[] = [];
  const json = JSON.stringify({
    "model": { input: 1, output: 2 }, // missing cacheWrite and cacheRead
  });
  const result = parsePrices(json, (msg) => logs.push(msg));
  expect(result).toEqual({});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("prompt-lift: prices option ignored:");
});

test("parsePrices returns empty object and logs for non-numeric fields", async () => {
  const logs: string[] = [];
  const json = JSON.stringify({
    "model": { input: "not a number", output: 2, cacheWrite: 1, cacheRead: 0.1 },
  });
  const result = parsePrices(json, (msg) => logs.push(msg));
  expect(result).toEqual({});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("prompt-lift: prices option ignored:");
});

test("parsePrices returns empty object and logs for negative numbers", async () => {
  const logs: string[] = [];
  const json = JSON.stringify({
    "model": { input: -1, output: 2, cacheWrite: 1, cacheRead: 0.1 },
  });
  const result = parsePrices(json, (msg) => logs.push(msg));
  expect(result).toEqual({});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("prompt-lift: prices option ignored:");
});

test("parsePrices accepts multiple valid entries", async () => {
  const json = JSON.stringify({
    "model-a": { input: 1, output: 2, cacheWrite: 0.5, cacheRead: 0.05 },
    "model-b": { input: 3, output: 4, cacheWrite: 1.5, cacheRead: 0.15 },
  });
  const result = parsePrices(json);
  expect(result).toEqual({
    "model-a": { input: 1, output: 2, cacheWrite: 0.5, cacheRead: 0.05 },
    "model-b": { input: 3, output: 4, cacheWrite: 1.5, cacheRead: 0.15 },
  });
});

test("parseOptions merges user prices over DEFAULT_PRICES", async () => {
  const userPrices = JSON.stringify({
    "fable-5-1": { input: 5, output: 25, cacheWrite: 6, cacheRead: 0.1 },
  });
  const config = parseOptions({ prices: userPrices });
  
  // User's fable-5-1 should override default
  expect(config.prices["fable-5-1"]).toEqual({
    input: 5,
    output: 25,
    cacheWrite: 6,
    cacheRead: 0.1,
  });
  
  // Other defaults should remain
  expect(config.prices["sonnet-5-5"]).toEqual(DEFAULT_PRICES["sonnet-5-5"]);
  expect(config.prices["haiku-5-5"]).toEqual(DEFAULT_PRICES["haiku-5-5"]);
});

test("priceFor lets a user key win over the default fragment it contains", async () => {
  const v2 = "us.anthropic.claude-sonnet-5-5-v2";
  const row = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  const config = parseOptions({ prices: JSON.stringify({ [v2]: row }) });

  // The user's rows come first in the scan, so the longer key wins
  expect(Object.keys(config.prices)[0]).toBe(v2);
  expect(priceFor(v2, config.prices)).toEqual(row);
  // The default row still prices what only it names
  expect(priceFor("us.anthropic.claude-sonnet-5-5", config.prices)).toEqual(
    DEFAULT_PRICES["sonnet-5-5"],
  );
  expect(priceFor("sonnet", config.prices)).toEqual(
    DEFAULT_PRICES["sonnet-5-5"],
  );
});

test("parseOptions stores pricesIssue when prices JSON is invalid", async () => {
  const config = parseOptions({ prices: "{invalid" });
  expect(config.pricesIssue).toBeDefined();
  expect(config.pricesIssue).toContain("prompt-lift: prices option ignored:");
});

test("parseOptions has no pricesIssue when prices is valid", async () => {
  const config = parseOptions({
    prices: JSON.stringify({
      "custom": { input: 1, output: 2, cacheWrite: 0.5, cacheRead: 0.05 },
    }),
  });
  expect(config.pricesIssue).toBeUndefined();
});

test("estimateUsd uses overridden prices", async () => {
  const userPrices = JSON.stringify({
    "fable-5-1": { input: 1, output: 2, cacheWrite: 0.5, cacheRead: 0.05 },
  });
  const config = parseOptions({ prices: userPrices });
  
  const usage = {
    input_tokens: 1000000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 1000000,
  };
  
  const cost = estimateUsd(usage, "fable-5-1", config.prices);
  // With overridden prices: (1M * 1 + 1M * 2) / 1M = $3
  expect(cost).toBe(3);
});


test("parsePrices is all-or-nothing: one invalid entry returns empty object", async () => {
  const logs: string[] = [];
  const json = JSON.stringify({
    "model-valid": { input: 1, output: 2, cacheWrite: 0.5, cacheRead: 0.05 },
    "model-invalid": { input: -1, output: 2, cacheWrite: 1, cacheRead: 0.1 },
  });
  const result = parsePrices(json, (msg) => logs.push(msg));
  expect(result).toEqual({});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("prompt-lift: prices option ignored:");
});
