import { expect, test } from "claude-code/testing";
import type { On, StateDollar } from "claude-code";
import {
  answered,
  engine,
  phaseOnce,
  press,
  watch,
  BETTER,
  DRAFT,
  FABLE,
  TODAY,
  USAGE,
} from "./engine";
import { resetStuckPhase } from "../hooks/actions";
import { formatDollars } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import { asStats, STATS_STORE_KEY } from "../hooks/stats";

// Spec §5.3 step 9 and §12, resilience: the pair Undo restores is held the
// moment the box is filled, before any cost is recorded, so a failed stats
// write costs the bookkeeping and not the result, on every path that
// answered; a call that answered is recorded even when the press then
// throws (G5, C19); a `running` phase no call backs (one a dropped
// environment left) is reset when a command runs, while a call in flight is
// never reset, and a press counts as in flight until its phase has settled.
// The band's side is in band.test.tsx.

const RECORD_FAILED =
  "prompt-lift: saved the result, but recording its cost failed";
const BAND_FAILED =
  "prompt-lift: saved the result, but the band could not be updated";
const FINE = "prompt-lift: already specific, left as is";
const NOT_TAKEN = "prompt-lift: the prompt box did not take the text (refused)";
/** What a Fable press that answers with USAGE costs: on every toast (C19). */
const COST = formatDollars(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));
const RESTORED = "prompt-lift: restored your draft";
const ANSWER_LIKE =
  "prompt-lift: that reads like an answer to Claude's question";
const BUSY = "prompt-lift: already enhancing";
/** The pair, in the order the success path writes it. */
const PAIR = ["original", "enhanced", "isUndone", "lastDecorations"];
/** The state recording the call writes, in order; the store row follows. */
const RECORD = [
  "lastUsage",
  "blockHash",
  "staticChars",
  "noCacheStreak",
  "sessionPresses",
  "sessionUsd",
];

/** Which of the given state keys were written, in order. */
function watchWrites(on: On, keys: readonly string[]): string[] {
  const order: string[] = [];
  for (const key of keys) {
    on(
      "state.set",
      { plugin: "prompt-lift", key } as never,
      ($, ev, next) => {
        order.push(key);
        return next(ev);
      },
    );
  }
  return order;
}

test("the pair is held before anything about the call is recorded", async ($, on) => {
  const e = engine(on);
  const order = watchWrites(on, [...PAIR, ...RECORD]);

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(order).toEqual([...PAIR, ...RECORD]);
  expect(e.store[STATS_STORE_KEY]).toBeDefined();
});

test("a failed stats write keeps the pair: Undo restores the draft and the toast says so", async ($, on) => {
  const e = engine(on, {
    denyStoreSet: { key: STATS_STORE_KEY, reason: "disk full" },
  });
  const phases = watch(on, "phase");

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(e.toasts).toEqual([RECORD_FAILED]);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("disk full");
  expect(phases).toEqual(["running", "done"]);
  expect(e.store[STATS_STORE_KEY]).toBeUndefined();

  await press($, "undo");

  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts).toEqual([RECORD_FAILED, RESTORED]);
});

test("a box that rejects the fill still has the call recorded", async ($, on) => {
  const e = engine(on, { denyFill: "composer gone" });
  const presses = watch(on, "sessionPresses");
  const phases = watch(on, "phase");

  await press($, DRAFT);

  expect(e.fills).toHaveLength(1);
  expect(e.box.text).toBe("");
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.startsWith("prompt-lift: enhance failed (")).toBe(true);
  // The kit's own rejection: a throwing hook is skipped, nothing else answers
  expect(e.toasts[0]).toContain("prompt.fill");
  // Paid for the answer (G5, C19): the totals and the day row still count it
  expect(presses).toEqual([1]);
  expect(asStats(e.store[STATS_STORE_KEY]).byDay[TODAY]?.presses).toBe(1);
  expect(e.logs).toHaveLength(1);
  expect(phases).toEqual(["running", "idle"]);
});

test("a record that fails on the failure path is logged, not toasted", async ($, on) => {
  const e = engine(on, {
    denyFill: "composer gone",
    denyStoreSet: { key: STATS_STORE_KEY, reason: "disk full" },
  });
  const presses = watch(on, "sessionPresses");

  await press($, DRAFT);

  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.startsWith("prompt-lift: enhance failed (")).toBe(true);
  expect(presses).toEqual([1]);
  expect(e.store[STATS_STORE_KEY]).toBeUndefined();
  expect(e.logs).toHaveLength(2);
  expect(e.logs[0]).toContain("recording the cost failed");
  expect(e.logs[0]).toContain("disk full");
  expect(e.logs[1]).toContain("enhance failed");
});

test("a failed stats write on a fine verdict still toasts the verdict with its cost", async ($, on) => {
  const e = engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
    denyStoreSet: { key: STATS_STORE_KEY, reason: "disk full" },
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([`${FINE} · ${COST}`]);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("recording the cost failed");
  expect(e.logs[0]).toContain("disk full");
});

test("a failed stats write after a refused fill leaves the refusal toast alone", async ($, on) => {
  const e = engine(on, {
    fill: { isFilled: false },
    denyStoreSet: { key: STATS_STORE_KEY, reason: "disk full" },
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(1);
  expect(e.toasts).toEqual([`${NOT_TAKEN} · ${COST}`]);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("recording the cost failed");
});

test("a failed done write after the record keeps the result and says so", async ($, on) => {
  const e = engine(on);
  on("state.set", { plugin: "prompt-lift", key: "phase" }, ($, ev, next) =>
    ev.value === "done" ? { deny: "state gone" } : next(ev),
  );

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(e.toasts).toEqual([BAND_FAILED]);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("state gone");
  expect(asStats(e.store[STATS_STORE_KEY]).byDay[TODAY]?.presses).toBe(1);

  // The pair was held: Undo still restores the draft
  await press($, "undo");

  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts).toEqual([BAND_FAILED, RESTORED]);
});

test("a hash read that throws after the answer still records the call", async ($, on) => {
  const e = engine(on);
  const presses = watch(on, "sessionPresses");
  // The first read of blockHash is assessCall's, after the model answered
  let isPending = true;
  on(
    "state.get",
    { plugin: "prompt-lift", key: "blockHash" },
    ($, ev, next) => {
      if (!isPending) {
        return next(ev);
      }
      isPending = false;
      return { deny: "state gone" };
    },
  );

  await press($, DRAFT);

  expect(e.calls).toHaveLength(1);
  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.startsWith("prompt-lift: enhance failed (")).toBe(true);
  expect(e.toasts[0]).toContain("state gone");
  // Paid for the answer (G5, C19): the totals and the day row count it
  expect(presses).toEqual([1]);
  expect(asStats(e.store[STATS_STORE_KEY]).byDay[TODAY]?.presses).toBe(1);
});

test("a command resets a running phase no call backs", async ($, on) => {
  const e = engine(on);
  const phases = watch(on, "phase");
  phaseOnce(on, "running");

  const r = await press($, "status");

  expect(phases).toEqual(["idle"]);
  expect((r as { text?: string }).text).toContain("prompt-lift status");
  expect(e.calls).toHaveLength(0);
});

test("a command leaves a running phase alone while its call is in flight", async ($, on) => {
  const e = engine(on, { delay: true });
  const phases = watch(on, "phase");

  const run = press($, DRAFT);
  await e.modelCalled;
  await press($, "status");
  expect(phases).toEqual(["running"]);
  e.release();
  await run;

  expect(e.calls).toHaveLength(1);
  expect(e.box.text).toBe(BETTER);
  expect(phases).toEqual(["running", "done"]);
});

test("a press stays in flight until its phase has settled", async ($, on) => {
  const e = engine(on);
  const phases = watch(on, "phase");
  // Settling begins by clearing runningModel; a press that arrives right then
  // finds the first press's phase still `running` and must be told "busy",
  // not run a second call: the first press is live until its phase is set.
  let inWindow: Promise<unknown> | undefined;
  on(
    "state.set",
    { plugin: "prompt-lift", key: "runningModel" },
    async (_, ev, next) => {
      if (inWindow === undefined) {
        inWindow = press($, DRAFT);
        await inWindow;
      }
      return next(ev);
    },
  );

  await press($, "ok do it now");

  expect(inWindow).toBeDefined();
  expect(e.calls).toHaveLength(0);
  expect(e.toasts).toEqual([ANSWER_LIKE, BUSY]);
  expect(phases).toEqual(["running", "idle"]);
});

/**
 * A `$` of the state noun alone: `phase` reads as given, `original` as the
 * held draft or nothing, and every write is kept. The noun's methods are
 * generic over the contract, which a fake that answers two keys cannot
 * spell, hence the cast.
 */
function stateHolding(
  values: { phase: string; original?: string },
  onRead: () => void,
): { $: StateDollar; writes: unknown[] } {
  const writes: unknown[] = [];
  const state = {
    get: async (ref: { key: string }) => {
      onRead();
      const value =
        ref.key === "phase" ? values.phase : (values.original ?? null);
      return { value, version: 1 };
    },
    set: async (_ref: unknown, value: unknown) => {
      writes.push(value);
      return { isSet: true, version: 2 };
    },
  };
  return { $: { state } as unknown as StateDollar, writes };
}

test("resetStuckPhase idles a running phase no call backs", async () => {
  const { $, writes } = stateHolding({ phase: "running" }, () => undefined);

  await resetStuckPhase($, () => false);

  expect(writes).toEqual(["idle"]);
});

test("resetStuckPhase returns a running phase to done while a pair is held", async () => {
  // A press had filled the box before the environment went: after a hot
  // reload its Send and Undo row comes back, not the idle one.
  const { $, writes } = stateHolding(
    { phase: "running", original: DRAFT },
    () => undefined,
  );

  await resetStuckPhase($, () => false);

  expect(writes).toEqual(["done"]);
});

test("resetStuckPhase asks whether a call is in flight after it has read the phase", async () => {
  let isInFlight = false;
  const { $, writes } = stateHolding({ phase: "running" }, () => {
    isInFlight = true;
  });

  await resetStuckPhase($, () => isInFlight);

  expect(writes).toEqual([]);
});
