import { expect, test } from "claude-code/testing";
import {
  splitList,
  parseOptions,
  estimateUsd,
  shortModel,
  ALIAS_PRICE_KEYS,
  DEFAULT_PRICES,
  priceFor,
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
  expect(priceFor("fable", DEFAULT_PRICES)).toEqual(DEFAULT_PRICES["fable-5-1"]);
  expect(priceFor("SONNET", DEFAULT_PRICES)).toEqual(
    DEFAULT_PRICES["sonnet-5-5"],
  );
  expect(priceFor("Haiku", DEFAULT_PRICES)).toEqual(DEFAULT_PRICES["haiku-5-5"]);
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
