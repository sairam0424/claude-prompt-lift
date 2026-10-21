import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  press,
  BEDROCK,
  BETTER,
  DRAFT,
  FABLE,
  GOOD,
  HAIKU,
  SONNET,
  USAGE,
} from "./engine";
import { formatDollars } from "../hooks/chain";
import {
  DEFAULT_PRICES,
  estimateUsd,
  platformOf,
  priceFor,
  type Platform,
} from "../hooks/config";
import { attemptsUsd, callUsd } from "../hooks/stats";
import { statusText, type StatusInput } from "../hooks/status";
import { storeTotal } from "./ledger-fake";

// R19: an alias rung (`fable`, `sonnet`, `haiku`) prices as its family's
// current generation on the Anthropic API only. On Bedrock and Vertex the
// engine's alias defaults can lag a generation and `$.model.complete` never
// says which id answered, so the alias is unpriced there (`$?`, counted as
// unpriced, never toward a cap) and `status` says so. A chain of full ids
// prices on every platform as before. The harness session model is FABLE, a
// Bedrock id, unless a test hands it an Anthropic-shaped one.

/** An Anthropic API model id: aliases price there. */
const API_FABLE = "claude-fable-5-1";
/** How every cost tail reads when the rung has no price (R3). */
const UNPRICED = "$? · (no price)";
const FABLE_COST = formatDollars(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));
const SONNET_COST = formatDollars(estimateUsd(USAGE, SONNET, DEFAULT_PRICES));
/** A cold Haiku answer heavy enough to show a non-zero price on the toast. */
const HEAVY: typeof USAGE = { ...USAGE, input_tokens: 12000 };
const HAIKU_COST = formatDollars(estimateUsd(HEAVY, HAIKU, DEFAULT_PRICES));
const RATE_LIMITED = {
  isAnswered: false,
  reason: "api-error",
  status: 429,
  error: "rate_limit",
  usage: USAGE,
} as const;

function aliasLine(platform: string): string {
  return `aliases: unpriced on ${platform} — pin full ids in models for prices (README › Cost)`;
}

async function statusOf($: Parameters<typeof press>[0]): Promise<string> {
  return ((await press($, "status")) as { text: string }).text;
}

// --- end to end, through the command ---

test(
  "an alias rung on a Bedrock session is unpriced: $?, counted, and status says so",
  { options: { models: "sonnet" } },
  async ($, on) => {
    const e = engine(on);

    await press($, DRAFT);
    const status = await statusOf($);

    expect(e.box.text).toBe(BETTER);
    expect(e.calls.map((c) => c.model)).toEqual(["sonnet"]);
    expect(e.toasts).toHaveLength(1);
    expect(e.toasts[0]).toContain(` · 310 out · ${UNPRICED} · `);
    expect(e.toasts[0]).not.toContain("$0");
    expect(status).toContain(
      `chain: sonnet\n${aliasLine("bedrock")}\nlast call: sonnet · `,
    );
    expect(status).toContain(`310 out · ${UNPRICED} · cache hit`);
    expect(status).toContain("session: 1 press · $0.000 · unpriced calls: 1");
    expect(status).toContain("today: 1 press · $0.000 · unpriced calls: 1");
    expect(await storeTotal(e.store)).toEqual({
      presses: 1,
      usd: 0,
      unpriced: 1,
    });
  },
);

test(
  "the same alias rung on the Anthropic API prices as Sonnet 5.5, no aliases line",
  { options: { models: "sonnet" } },
  async ($, on) => {
    const e = engine(on, { model: API_FABLE });

    await press($, DRAFT);
    const status = await statusOf($);

    expect(e.box.text).toBe(BETTER);
    expect(e.toasts).toHaveLength(1);
    expect(e.toasts[0]).toContain(` · 310 out · ${SONNET_COST} · `);
    expect(status).toContain(`chain: sonnet\nlast call: sonnet · `);
    expect(status).not.toContain("aliases:");
    expect(status).toContain(`session: 1 press · ${SONNET_COST}\n`);
    const day = await storeTotal(e.store);
    expect(day.presses).toBe(1);
    expect(day.unpriced).toBe(0);
    const usd = estimateUsd(USAGE, SONNET, DEFAULT_PRICES) ?? 0;
    expect(Math.abs(day.usd - usd)).toBeLessThan(1e-9);
  },
);

test(
  "a chain of full ids on a Bedrock session prices as before, no aliases line",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    await press($, DRAFT);
    const status = await statusOf($);

    expect(e.toasts).toHaveLength(1);
    expect(e.toasts[0]).toContain(` · 310 out · ${FABLE_COST} · `);
    expect(status).toContain(
      `chain: ${FABLE} → ${SONNET} → ${HAIKU}\nlast call:`,
    );
    expect(status).not.toContain("aliases:");
    expect(status).toContain(`session: 1 press · ${FABLE_COST}\n`);
    expect((await storeTotal(e.store)).unpriced).toBe(0);
  },
);

test(
  "a mixed chain on Bedrock: the failed alias rung adds nothing, the full id answers priced",
  { options: { models: `sonnet,${HAIKU}` } },
  async ($, on) => {
    const e = engine(on, { replies: [RATE_LIMITED, answered(GOOD, HEAVY)] });

    await press($, DRAFT);
    const status = await statusOf($);

    expect(e.calls.map((c) => c.model)).toEqual(["sonnet", HAIKU]);
    expect(e.toasts).toHaveLength(1);
    // The answering rung's own price alone: the unpriced rung is not a $0 part
    expect(e.toasts[0]).toContain(
      `prompt-lift: haiku 5.5 · 6.8k cached · 12.0k in · 310 out · ${HAIKU_COST} · `,
    );
    expect(e.toasts[0]).toContain("via sonnet: rate_limit");
    expect(status).toContain(
      `chain: sonnet → ${HAIKU}\n${aliasLine("bedrock")}\nlast call:`,
    );
    const day = await storeTotal(e.store);
    expect(day.unpriced).toBe(0);
    const usd = estimateUsd(HEAVY, HAIKU, DEFAULT_PRICES) ?? 0;
    expect(Math.abs(day.usd - usd)).toBeLessThan(1e-9);
  },
);

// --- the pure parts ---

/** A valid ANTHROPIC_MODEL on Bedrock: it names no model, so an alias rung on
 * it stays unpriced like on any other Bedrock session. */
const PROFILE_ARN =
  "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123";

test("platformOf reads the platform off the session's model id", () => {
  const table: [string, Platform][] = [
    ["us.anthropic.claude-sonnet-5-5", "bedrock"],
    ["anthropic.claude-haiku-4-5-20251001-v1:0", "bedrock"],
    ["eu.anthropic.claude-fable-5-1", "bedrock"],
    [PROFILE_ARN, "bedrock"],
    ["claude-sonnet-5-5@20251001", "vertex"],
    ["claude-sonnet-5-5", "anthropic"],
    ["sonnet", "anthropic"],
    ["", "anthropic"],
  ];
  for (const [id, platform] of table) {
    expect([id, platformOf(id)]).toEqual([id, platform]);
  }
});

test("an alias rung on a Bedrock inference-profile ARN session is unpriced", () => {
  expect(
    priceFor("sonnet", DEFAULT_PRICES, platformOf(PROFILE_ARN)),
  ).toBeUndefined();
});

test("priceFor prices an alias on the Anthropic API only; a full id everywhere", () => {
  const sonnet = DEFAULT_PRICES["sonnet-5-5"];
  for (const alias of ["sonnet", "SONNET", "Sonnet"]) {
    expect(priceFor(alias, DEFAULT_PRICES, "anthropic")).toEqual(sonnet);
    expect(priceFor(alias, DEFAULT_PRICES, "bedrock")).toBeUndefined();
    expect(priceFor(alias, DEFAULT_PRICES, "vertex")).toBeUndefined();
  }
  // The default platform is the Anthropic API, as before
  expect(priceFor("sonnet", DEFAULT_PRICES)).toEqual(sonnet);
  for (const platform of ["anthropic", "bedrock", "vertex"] as const) {
    expect(priceFor(SONNET, DEFAULT_PRICES, platform)).toEqual(sonnet);
    expect(
      priceFor("claude-sonnet-5-5@20251001", DEFAULT_PRICES, platform),
    ).toEqual(sonnet);
  }
  expect(
    estimateUsd(USAGE, "sonnet", DEFAULT_PRICES, "bedrock"),
  ).toBeUndefined();
  expect(estimateUsd(USAGE, "sonnet", DEFAULT_PRICES, "anthropic")).toBe(
    estimateUsd(USAGE, SONNET, DEFAULT_PRICES, "bedrock"),
  );
});

test("callUsd and attemptsUsd price the rungs by the platform they were called on", () => {
  const failed = { model: "sonnet", outcome: "rate_limit", usage: USAGE };
  const answer = { model: HAIKU, outcome: "ok", usage: HEAVY };
  const attempts = [failed, answer];
  const haiku = estimateUsd(HEAVY, HAIKU, DEFAULT_PRICES) ?? 0;
  const sonnet = estimateUsd(USAGE, SONNET, DEFAULT_PRICES) ?? 0;

  // On Bedrock the alias rung adds nothing; the full id prices
  expect(attemptsUsd(attempts, DEFAULT_PRICES, "bedrock")).toBe(haiku);
  expect(attemptsUsd([failed], DEFAULT_PRICES, "bedrock")).toBeUndefined();
  // On the Anthropic API both rungs price
  expect(attemptsUsd(attempts, DEFAULT_PRICES, "anthropic")).toBe(
    sonnet + haiku,
  );

  const run = {
    ok: true as const,
    text: "",
    usage: HEAVY,
    model: HAIKU,
    attempts,
  };
  expect(callUsd(run, DEFAULT_PRICES, "bedrock")).toBe(haiku);
  // An alias that answered on Bedrock is unpriced whatever the other rungs cost
  const aliasRun = { ...run, model: "sonnet", attempts: [answer, failed] };
  expect(callUsd(aliasRun, DEFAULT_PRICES, "bedrock")).toBeUndefined();
  expect(callUsd(aliasRun, DEFAULT_PRICES, "anthropic")).toBe(sonnet + haiku);
});

test("statusText prints the aliases line after chain only where an alias is unpriced", () => {
  const a: StatusInput = {
    chain: ["fable", SONNET],
    platform: "vertex",
    last: null,
    session: { presses: 0, usd: 0, unpriced: 0 },
    today: { presses: 0, usd: 0, unpriced: 0 },
    caps: {},
    staticChars: 0,
    blockHash: "",
    skills: { included: 0, total: 0 },
    included: [],
    excluded: [],
    tail: 0,
  };
  expect(statusText(a)).toContain(
    `\nchain: fable → ${SONNET}\n${aliasLine("vertex")}\nlast call: none yet\n`,
  );
  expect(statusText({ ...a, platform: "bedrock", chain: ["Haiku"] })).toContain(
    `\nchain: Haiku\n${aliasLine("bedrock")}\nlast call:`,
  );
  expect(statusText({ ...a, platform: "anthropic" })).not.toContain("aliases:");
  expect(statusText({ ...a, chain: [FABLE, SONNET] })).not.toContain(
    "aliases:",
  );
  // `opus` is no alias the mod prices: no line, the rung is unpriced everywhere
  expect(statusText({ ...a, chain: ["opus"] })).not.toContain("aliases:");
});

test(
  "an alias chain that fails on Bedrock counts as unpriced, not as dollars",
  { options: { models: "sonnet" } },
  async ($, on) => {
    const e = engine(on, { replies: [RATE_LIMITED] });

    await press($, DRAFT);
    const status = await statusOf($);

    expect(e.toasts).toHaveLength(1);
    expect(e.toasts[0]).toBe(
      `prompt-lift: no model answered · sonnet: rate_limit · ${UNPRICED}`,
    );
    expect(status).toContain("session: 1 press · $0.000 · unpriced calls: 1");
    expect(await storeTotal(e.store)).toEqual({
      presses: 1,
      usd: 0,
      unpriced: 1,
    });
  },
);
