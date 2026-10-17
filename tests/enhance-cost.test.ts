import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  block,
  localDay,
  press,
  BEDROCK,
  BETTER,
  DRAFT,
  FABLE,
  GOOD,
  NOW_MS,
  SONNET,
  TODAY,
  USAGE,
  ZERO_USAGE,
} from "./engine";
import { formatDollars } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import {
  addCall,
  dayOf,
  dayRow,
  EMPTY_DAY,
  type DayStats,
} from "../hooks/stats";

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
const OPUS = "us.anthropic.claude-opus-4-1";
/** How every cost tail reads when the price table has no row (R3). */
const UNPRICED = "$? · (no price)";
type Stats = { byDay: Record<string, DayStats> };

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
  expect((e.store.stats as Stats).byDay[TODAY]).toEqual({
    presses: 1,
    usd: 0,
    unpriced: 0,
  });
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

  const usd = estimateUsd(USAGE, FABLE, DEFAULT_PRICES) ?? 0;
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

  const usd = estimateUsd(USAGE, FABLE, DEFAULT_PRICES) ?? 0;
  const stats = e.store.stats as Stats;
  expect(stats.byDay[TODAY]?.presses).toBe(2);
  expect(Math.abs((stats.byDay[TODAY]?.usd ?? 0) - 2 * usd)).toBeLessThan(1e-9);
  expect(usd).toBeGreaterThan(0);
  expect(presses).toEqual([1, 2]);
});

// --- R3: a model the price table does not cover ---

test("an unpriced model shows $? and counts as unpriced, not as $0.00", { options: { models: OPUS } }, async ($, on) => {
  const e = engine(on);
  const recorded: unknown[] = [];
  on(
    "state.set",
    { plugin: "prompt-master", key: "lastUsage" },
    ($, ev, next) => {
      recorded.push((ev.value as { usd: unknown } | null)?.usd);
      return next(ev);
    },
  );

  await press($, DRAFT);
  const status = ((await press($, "status")) as { text: string }).text;

  expect(e.box.text).toBe(BETTER);
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]).toContain(
    ` · 310 out · ${UNPRICED} · added symptom and test`,
  );
  expect(e.toasts[0]).not.toContain("$0");
  // The call and the rewrite both persist the unknown price as JSON null
  expect(recorded).toEqual([null, null]);
  expect(status).toContain(
    `last call: ${OPUS} · 6.8k cached · 1.4k in · 310 out · ${UNPRICED} · cache hit`,
  );
  expect(status).toContain("session: 1 press · $0.000 · unpriced calls: 1");
  expect(status).toContain("today: 1 press · $0.000 · unpriced calls: 1");
  expect((e.store.stats as Stats).byDay[TODAY]).toEqual({
    presses: 1,
    usd: 0,
    unpriced: 1,
  });
});

test("a priced press and an unpriced one: the totals add the priced dollars only", { options: BEDROCK }, async ($, on) => {
  const e = engine(on, {
    replies: [answered(GOOD), answered(JSON.stringify({ verdict: "fine" }))],
  });

  await press($, DRAFT);
  await press($, `model ${OPUS}`);
  e.box.text = "";
  await press($, DRAFT_2);
  const status = ((await press($, "status")) as { text: string }).text;

  expect(e.calls.map((c) => c.model)).toEqual([FABLE, OPUS]);
  expect(e.toasts[1]).toBe(`${FINE} · ${UNPRICED}`);
  expect(status).toContain(
    `session: 2 presses · ${COST} · unpriced calls: 1`,
  );
  expect(status).toContain(`today: 2 presses · ${COST} · unpriced calls: 1`);
  const day = (e.store.stats as Stats).byDay[TODAY];
  expect(day?.presses).toBe(2);
  expect(day?.unpriced).toBe(1);
  const usd = estimateUsd(USAGE, FABLE, DEFAULT_PRICES) ?? 0;
  expect(Math.abs((day?.usd ?? 0) - usd)).toBeLessThan(1e-9);
});

test("a chain of unpriced rungs that fails counts as unpriced, not as $0", { options: { models: OPUS } }, async ($, on) => {
  const e = engine(on, {
    replies: [
      {
        isAnswered: false,
        reason: "api-error",
        status: 429,
        error: "rate_limit",
        usage: USAGE,
      },
    ],
  });

  await press($, DRAFT);
  const status = ((await press($, "status")) as { text: string }).text;

  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.startsWith("prompt-master: no model answered ·")).toBe(
    true,
  );
  expect(e.toasts[0]?.endsWith(` · ${UNPRICED}`)).toBe(true);
  expect(status).toContain("session: 1 press · $0.000 · unpriced calls: 1");
  expect((e.store.stats as Stats).byDay[TODAY]).toEqual({
    presses: 1,
    usd: 0,
    unpriced: 1,
  });
});

test("addCall and dayRow keep a day's row honest, old rows included", async () => {
  expect(addCall(addCall(EMPTY_DAY, 0.04), undefined)).toEqual({
    presses: 2,
    usd: 0.04,
    unpriced: 1,
  });
  // A row written before unpriced calls were counted reads as zero of them
  const legacy = { presses: 3, usd: 0.1 } as DayStats;
  expect(dayRow({ byDay: { [TODAY]: legacy } }, TODAY)).toEqual({
    presses: 3,
    usd: 0.1,
    unpriced: 0,
  });
  expect(dayRow({ byDay: {} }, TODAY)).toEqual(EMPTY_DAY);
  expect(EMPTY_DAY).toEqual({ presses: 0, usd: 0, unpriced: 0 });
});

// --- R2: the toast is one line of at most 200 chars ---

test("a long, multi-line why is cut and the toast stays one line", async ($, on) => {
  const why = Array.from({ length: 60 }, (_, i) => `reason ${i}`).join("\n");
  const e = engine(on, {
    replies: [
      answered(
        JSON.stringify({
          verdict: "improve",
          prompt: BETTER,
          why,
          applied: [],
        }),
      ),
    ],
  });

  await press($, DRAFT);

  expect(why.length).toBeGreaterThan(500);
  expect(e.box.text).toBe(BETTER);
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.length).toBeLessThan(201);
  expect(e.toasts[0]).not.toContain("\n");
  expect(e.toasts[0]).toContain(" · reason 0 reason 1 ");
  expect(e.toasts[0]).toContain("…");
});

test("an error's message in the enhance-failed toast is cut to one short line", async ($, on) => {
  const reason = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const e = engine(on, { denyMessages: reason });

  await press($, DRAFT);

  expect(reason.length).toBeGreaterThan(200);
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.startsWith("prompt-master: enhance failed (")).toBe(true);
  expect(e.toasts[0]?.endsWith("…)")).toBe(true);
  expect(e.toasts[0]?.length).toBeLessThan(32 + 80 + 1);
  expect(e.toasts[0]).not.toContain("\n");
  expect(e.toasts[0]).toContain("line 0 line 1 ");
});

// --- R6: the stats day is the local day ---

test("dayOf keys stats by the local, zero-padded day", async () => {
  const lateUtc = Date.UTC(2026, 9, 16, 23, 30, 0);
  // Expected from the same Date API, never a literal: the zone decides the day
  expect(dayOf(lateUtc)).toBe(localDay(new Date(lateUtc)));
  expect(dayOf(lateUtc)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Built from local parts, so this literal holds in every zone
  expect(dayOf(new Date(2026, 0, 5, 12).getTime())).toBe("2026-01-05");
  expect(dayOf(NOW_MS)).toBe(TODAY);
});
