import { expect, test } from "claude-code/testing";
import type { On, StateDollar } from "claude-code";
import {
  engine,
  phaseOnce,
  press,
  watch,
  BETTER,
  DRAFT,
  TODAY,
} from "./engine";
import { resetStuckPhase } from "../hooks/actions";
import { asStats, STATS_STORE_KEY } from "../hooks/stats";

// Spec §5.3 step 9 and §12, resilience: the pair Undo restores is held the
// moment the box is filled, before any cost is recorded, so a failed stats
// write costs the bookkeeping and not the result; a call that answered is
// recorded even when the press then throws (G5, C19); a `running` phase no
// call backs (one a dropped environment left) is reset when a command runs,
// while a call in flight is never reset, and a press counts as in flight
// until its phase has settled. The band's side is in band.test.tsx.

const RECORD_FAILED =
  "prompt-master: saved the result, but recording its cost failed";
const RESTORED = "prompt-master: restored your draft";
const ANSWER_LIKE =
  "prompt-master: that reads like an answer to Claude's question";
const BUSY = "prompt-master: already enhancing";
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
      { plugin: "prompt-master", key } as never,
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
  expect(e.toasts[0]?.startsWith("prompt-master: enhance failed (")).toBe(true);
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
  expect(e.toasts[0]?.startsWith("prompt-master: enhance failed (")).toBe(true);
  expect(presses).toEqual([1]);
  expect(e.store[STATS_STORE_KEY]).toBeUndefined();
  expect(e.logs).toHaveLength(2);
  expect(e.logs[0]).toContain("recording the cost failed");
  expect(e.logs[0]).toContain("disk full");
  expect(e.logs[1]).toContain("enhance failed");
});

test("a command resets a running phase no call backs", async ($, on) => {
  const e = engine(on);
  const phases = watch(on, "phase");
  phaseOnce(on, "running");

  const r = await press($, "status");

  expect(phases).toEqual(["idle"]);
  expect((r as { text?: string }).text).toContain("prompt-master status");
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
    { plugin: "prompt-master", key: "runningModel" },
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
 * A `$` of the state noun alone, every read answered with `phase` and every
 * write kept. The noun's methods are generic over the contract, which a fake
 * that answers one key cannot spell, hence the cast.
 */
function stateHolding(
  phase: string,
  onRead: () => void,
): { $: StateDollar; writes: unknown[] } {
  const writes: unknown[] = [];
  const state = {
    get: async () => {
      onRead();
      return { value: phase, version: 1 };
    },
    set: async (_ref: unknown, value: unknown) => {
      writes.push(value);
      return { isSet: true, version: 2 };
    },
  };
  return { $: { state } as unknown as StateDollar, writes };
}

test("resetStuckPhase idles a running phase no call backs", async () => {
  const { $, writes } = stateHolding("running", () => undefined);

  await resetStuckPhase($, () => false);

  expect(writes).toEqual(["idle"]);
});

test("resetStuckPhase asks whether a call is in flight after it has read the phase", async () => {
  let isInFlight = false;
  const { $, writes } = stateHolding("running", () => {
    isInFlight = true;
  });

  await resetStuckPhase($, () => isInFlight);

  expect(writes).toEqual([]);
});
