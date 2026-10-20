import { expect, test } from "claude-code/testing";
import { engine, press, DRAFT, FABLE, TODAY, USAGE } from "./engine";
import { formatDollars } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import {
  createLedger,
  dayOf,
  dayTotal,
  recordPress,
  spendKey,
  STATS_STORE_KEY,
  type DayStats,
} from "../hooks/ledger";
import { expectUsd, fakeEngine, storeTotal } from "./ledger-fake";

// The Task 17 review's minors, fixed before the 0.4.2 tag. A day still in
// the 0.4.x `stats` row is read from it until a write has migrated it, so a
// 0.4.2 session that has not pressed yet does not show `today: 0` beside a
// day of 0.4.1 presses; and once the legacy row is there `stats` is ignored,
// so no interleaving of a reader with another session's migration counts a
// day twice. A refused delete while pruning is logged to debug and the press
// stays recorded, instead of the false toast "saved the result, but
// recording its cost failed". The pruning cutoff is a local calendar step,
// so the seventh day back is kept at every hour of the year, the evening
// after clocks go back included.

const AMOUNT = 0.01;
const OLD_KEY = "spend:2026-10-01:x";
const PRUNE_FAILED = "prompt-lift: pruning old day rows failed: ";
const RECORD_FAILED =
  "prompt-lift: saved the result, but recording its cost failed";
/** What a Fable press that answers with USAGE costs: on every toast (C19). */
const COST = formatDollars(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));

function row(presses: number, usd: number, unpriced = 0): DayStats {
  return { presses, usd, unpriced };
}

// --- (a), (b) the 0.4.x row is read until it is migrated, never twice ---

test("(a) a day still in the stats row is read before any write, and counted once after the migration", async () => {
  const f = fakeEngine({
    store: { [STATS_STORE_KEY]: { byDay: { [TODAY]: row(2, 0.03) } } },
  });

  // At 3254129 this read gave 0 presses: only `spend:` rows were summed
  const before = await dayTotal(f.$, TODAY);
  expect(before.presses).toBe(2);
  expect(before.unpriced).toBe(0);
  expectUsd(before.usd, 0.03);
  // A read writes nothing: the stats row is still the store's only key
  expect(Object.keys(f.store)).toEqual([STATS_STORE_KEY]);

  await recordPress(createLedger("m"), f.$, AMOUNT);

  const after = await storeTotal(f.store);
  expect(after.presses).toBe(3);
  expect(after.unpriced).toBe(0);
  expectUsd(after.usd, 0.04);
  expect(f.store[STATS_STORE_KEY]).toBeUndefined();
  expect(f.store[spendKey(TODAY, "legacy")]).toEqual(row(2, 0.03));
  expect(f.store[spendKey(TODAY, "m")]).toEqual(row(1, AMOUNT));
});

test("(b) with the legacy row present, a stale stats row is not counted", async () => {
  // The interval between another session's `set(legacy)` and its
  // `delete(stats)`: a reader here sees both and must count the day once
  const f = fakeEngine({
    store: {
      [spendKey(TODAY, "legacy")]: row(2, 0.03),
      [spendKey(TODAY, "m")]: row(1, AMOUNT),
      [STATS_STORE_KEY]: { byDay: { [TODAY]: row(2, 0.03) } },
    },
  });

  const today = await storeTotal(f.store);

  expect(today.presses).toBe(3);
  expect(today.unpriced).toBe(0);
  expectUsd(today.usd, 0.04);
});

// --- (c) a refused delete while pruning ---

test("(c) a refused delete while pruning is logged to debug; the press is recorded and recordPress resolves", async () => {
  const f = fakeEngine({
    store: { [OLD_KEY]: row(1, 0.01) },
    denyDelete: { key: "spend:", reason: "read-only store" },
  });

  // At 3254129 this rejected with "read-only store"
  await recordPress(createLedger("m"), f.$, AMOUNT);

  expect(f.store[spendKey(TODAY, "m")]).toEqual(row(1, AMOUNT));
  expect(f.store[OLD_KEY]).toEqual(row(1, 0.01));
  expect(f.logs).toEqual([`${PRUNE_FAILED}read-only store`]);
  expect((await storeTotal(f.store)).presses).toBe(1);
});

test("(c) a press whose prune is refused toasts the usage line, not the cost-failed one", async ($, on) => {
  // Registered before the stub's own store handlers, so it stands outside them
  on("store.delete", { key: OLD_KEY }, () => ({ deny: "read-only store" }));
  const e = engine(on);
  e.store[OLD_KEY] = row(1, 0.01);

  await press($, DRAFT);

  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]).not.toBe(RECORD_FAILED);
  expect(e.toasts[0]).toContain(COST);
  const pruneLogs = e.logs.filter((line) => line.startsWith(PRUNE_FAILED));
  expect(pruneLogs).toHaveLength(1);
  expect(pruneLogs[0]).toContain("read-only store");
  expect(e.store[OLD_KEY]).toEqual(row(1, 0.01));
  expect((await storeTotal(e.store)).presses).toBe(1);
});

// --- (d) the cutoff is a local calendar step ---

test("(d) at 23:30 the day after clocks go back, the seventh day back is kept and the eighth pruned", async () => {
  // Each `now` is the evening after an autumn clocks-back shift somewhere:
  // the US on 2026-11-01, Europe on 2026-10-25. In such a zone the shift day
  // has 25 hours, so `now − 7 × 24 h` falls at 00:30 on the day AFTER the
  // seventh day back, and at 3254129 that day's rows were pruned. The dates
  // are built in local time, so a zone with no shift asserts the same days
  // and the test holds everywhere.
  const cases = [
    {
      now: new Date(2026, 10, 2, 23, 30),
      kept: "2026-10-26",
      gone: "2026-10-25",
    },
    {
      now: new Date(2026, 9, 26, 23, 30),
      kept: "2026-10-19",
      gone: "2026-10-18",
    },
  ];
  for (const c of cases) {
    const f = fakeEngine({
      nowMs: c.now.getTime(),
      store: {
        [spendKey(c.kept, "x")]: row(1, 0.01),
        [spendKey(c.gone, "x")]: row(1, 0.01),
      },
    });

    await recordPress(createLedger("m"), f.$, AMOUNT);

    expect(f.store[spendKey(c.kept, "x")]).toEqual(row(1, 0.01));
    expect(f.store[spendKey(c.gone, "x")]).toBeUndefined();
    expect(f.store[spendKey(dayOf(c.now.getTime()), "m")]).toEqual(
      row(1, AMOUNT),
    );
    expect(f.logs).toEqual([]);
  }
});
