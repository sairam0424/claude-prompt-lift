import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  block,
  press,
  BEDROCK,
  DRAFT,
  FABLE,
  GOOD,
  SONNET,
  TODAY,
  USAGE,
  ZERO_USAGE,
} from "./engine";
import { formatDollars } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";

// Spec G5 and C19: every call the chain paid for is recorded and its dollars
// end every toast that follows it; `status` shows the last call, not the last
// success.

const DRAFT_2 = "fix the login bug in src/auth.ts please now";
/**
 * What a Fable press that answers with USAGE costs: on every toast (C19). The
 * alias `fable` prices as this id, so it holds for the default chain too.
 */
const COST = formatDollars(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));
const FINE = "prompt-master: already specific, left as is";
type Stats = { byDay: Record<string, { presses: number; usd: number }> };

test("model failure leaves the draft and names the attempts", { options: BEDROCK }, async ($, on) => {
  const e = engine(on, {
    replies: [
      {
        isAnswered: false,
        reason: "api-error",
        status: 429,
        error: "rate_limit",
        usage: ZERO_USAGE,
      },
      { isAnswered: false, reason: "empty-reply", usage: ZERO_USAGE },
      { isAnswered: false, reason: "aborted", usage: ZERO_USAGE },
    ],
  });

  await press($, DRAFT);

  expect(e.calls).toHaveLength(3);
  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("");
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]).toContain("fable 5.1: rate_limit");
  expect(e.toasts[0]).toContain("sonnet 5.5: no text (possible refusal)");
  expect(e.toasts[0]).toContain("haiku 5.5: timeout");
  expect(e.toasts[0]?.endsWith(` · ${formatDollars(0)}`)).toBe(true);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("rate_limit");
  expect((e.store.stats as Stats).byDay[TODAY]).toEqual({ presses: 1, usd: 0 });
});


test("a chain that fails after a paid rung records the spend", async ($, on) => {
  const e = engine(on, {
    replies: [
      { isAnswered: false, reason: "empty-reply", usage: USAGE },
      {
        isAnswered: false,
        reason: "api-error",
        status: 429,
        error: "rate_limit",
        usage: ZERO_USAGE,
      },
      { isAnswered: false, reason: "aborted", usage: ZERO_USAGE },
    ],
  });
  const presses: unknown[] = [];
  on(
    "state.set",
    { plugin: "prompt-master", key: "sessionPresses" },
    ($, ev, next) => {
      presses.push(ev.value);
      return next(ev);
    },
  );

  await press($, DRAFT);

  const usd = estimateUsd(USAGE, FABLE, DEFAULT_PRICES);
  const day = (e.store.stats as Stats).byDay[TODAY];
  expect(day?.presses).toBe(1);
  expect(Math.abs((day?.usd ?? 0) - usd)).toBeLessThan(1e-9);
  expect(presses).toEqual([1]);
  expect(e.toasts[0]?.startsWith("prompt-master: no model answered ·")).toBe(
    true,
  );
  expect(e.toasts[0]?.endsWith(` · ${COST}`)).toBe(true);
});


test("a fine verdict toasts and does not fill", async ($, on) => {
  const e = engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([`${FINE} · ${COST}`]);
});


test("a fine verdict is paid for: stats, session totals and status say so", { options: BEDROCK }, async ($, on) => {
  const e = engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
  });
  const presses: unknown[] = [];
  on(
    "state.set",
    { plugin: "prompt-master", key: "sessionPresses" },
    ($, ev, next) => {
      presses.push(ev.value);
      return next(ev);
    },
  );

  await press($, DRAFT);
  const status = ((await press($, "status")) as { text: string }).text;

  const day = (e.store.stats as Stats).byDay[TODAY];
  expect(day?.presses).toBe(1);
  expect(day?.usd ?? 0).toBeGreaterThan(0);
  expect(presses).toEqual([1]);
  expect(status).toContain(`session: 1 press · ${COST}`);
  expect(status).toContain(`today: 1 press · ${COST}`);
  expect(status).toContain(
    `last call: fable 5.1 · 6.8k cached · 1.4k in · 310 out · ${COST}`,
  );
  expect(status).toMatch(/static block: [1-9]\d* chars · hash [0-9a-f]+/);
});


test("status shows the last call, not the last success", { options: BEDROCK }, async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(GOOD),
      {
        isAnswered: false,
        reason: "api-error",
        status: 429,
        error: "rate_limit",
        usage: ZERO_USAGE,
      },
      answered(JSON.stringify({ verdict: "fine" })),
    ],
  });

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);
  const status = ((await press($, "status")) as { text: string }).text;

  expect(e.calls.map((c) => c.model)).toEqual([FABLE, FABLE, SONNET]);
  expect(e.fills).toHaveLength(1);
  expect(status).toContain("last call: sonnet 5.5 ·");
  expect(status).toContain("session: 2 presses · ");
  expect(e.toasts[1]).toBe(
    `${FINE} · ${formatDollars(estimateUsd(USAGE, SONNET, DEFAULT_PRICES))}`,
  );
});


test("a fine verdict after a success keeps the phase at done", async ($, on) => {
  const e = engine(on, {
    replies: [answered(GOOD), answered(JSON.stringify({ verdict: "fine" }))],
  });
  const phases: unknown[] = [];
  on("state.set", { plugin: "prompt-master", key: "phase" }, ($, ev, next) => {
    phases.push(ev.value);
    return next(ev);
  });

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);

  expect(e.fills).toHaveLength(1);
  expect(e.toasts[1]).toBe(`${FINE} · ${COST}`);
  expect(phases).toEqual(["running", "done", "running", "done"]);
});


test("stats accumulate presses and dollars by day", async ($, on) => {
  const e = engine(on);
  const presses: unknown[] = [];
  on(
    "state.set",
    { plugin: "prompt-master", key: "sessionPresses" },
    ($, ev, next) => {
      presses.push(ev.value);
      return next(ev);
    },
  );

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);

  const usd = estimateUsd(USAGE, FABLE, DEFAULT_PRICES);
  const stats = e.store.stats as {
    byDay: Record<string, { presses: number; usd: number }>;
  };
  expect(stats.byDay[TODAY]?.presses).toBe(2);
  expect(Math.abs((stats.byDay[TODAY]?.usd ?? 0) - 2 * usd)).toBeLessThan(1e-9);
  expect(usd).toBeGreaterThan(0);
  expect(presses).toEqual([1, 2]);
});
