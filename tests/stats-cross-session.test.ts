import { expect, test } from "claude-code/testing";
import type { ModelUsage } from "claude-code";
import {
  answered,
  engine,
  press,
  DRAFT,
  FABLE,
  GOOD,
  NOW_MS,
  TODAY,
  USAGE,
} from "./engine";
import { formatDollars } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import {
  createLedger,
  dayOf,
  dayTotal,
  newWriterId,
  recordPress,
  spendKey,
  STATS_STORE_KEY,
  type DayStats,
} from "../hooks/ledger";
import { recordPress as thisSessionPress, spentUsd } from "../hooks/stats";
import {
  expectUsd,
  fakeEngine,
  storeTotal,
  todayKeys,
  TODAY_PREFIX,
} from "./ledger-fake";

// R24 (catalogue review of seed PR #341, finding 1): two sessions are two
// loaded copies of the stats module with separate queues, so a shared day row
// lost one of two presses recorded in the same instant. Now each writer has
// its own `spend:<day>:<writer>` row and the day is summed on read. Two
// writers are stood for by two `createLedger`s against ONE fake store (the kit
// loads a module once, so a second copy cannot be imported), and once by the
// real thing: the kit's own copy of the plugin, pressed, beside this file's
// import of the same module.

const AMOUNT = 0.01;
/** An Anthropic API session model: the alias chain prices there (R19). */
const API_FABLE = "claude-fable-5-1";
const DAY_MS = 86_400_000;
const DRAFT_2 = "fix the login bug in src/auth.ts please now";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What a Fable press that answers with USAGE costs. */
const COST = estimateUsd(USAGE, FABLE, DEFAULT_PRICES) ?? 0;
/** A Fable reply that costs $0.0099: 500 uncached input tokens, 80 out. */
const CENT: ModelUsage = {
  input_tokens: 500,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 80,
};

function row(presses: number, usd: number, unpriced = 0): DayStats {
  return { presses, usd, unpriced };
}

/** Today's row of `writer` as stored. */
function rowOf(store: Record<string, unknown>, writer: string): unknown {
  return store[spendKey(TODAY, writer)];
}

// --- the maintainer's case, with two real module instances ---

test("two sessions pressing in the same instant both count toward the day", async ($, on) => {
  // The kit loads the plugin's own copy of hooks/stats.ts for `press`; this
  // file's import is a second, independent copy with its own queue. Both write
  // ONE store (`e.store`); the other copy's write is held until this copy's
  // ledger has made its first read of the store (at 0.4.1 the day row, now
  // the migration check), so both read before either writes — the
  // interleaving two real sessions can produce. At 45d7130 this test ended
  // with `Expected: 2 / Received: 1`.
  let release: () => void = () => undefined;
  const engineRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Registered before the stub's own store handlers, so it stands outside them
  on("store.get", { key: STATS_STORE_KEY }, async ($, ev, next) => {
    const result = await next(ev);
    release();
    return result;
  });
  const e = engine(on, { model: API_FABLE });
  const otherSession = fakeEngine({ store: e.store, holdSet: engineRead });

  await Promise.all([
    press($, DRAFT),
    thisSessionPress(otherSession.$, AMOUNT),
  ]);

  const today = await storeTotal(e.store);
  expect(today.presses).toBe(2);
  expect(today.unpriced).toBe(0);
  expectUsd(today.usd, COST + AMOUNT);
  // Two writers, two rows, each under a UUID the other cannot share
  const keys = todayKeys(e.store);
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
  for (const key of keys) {
    expect(key.slice(TODAY_PREFIX.length)).toMatch(UUID);
  }
  expect(e.store[STATS_STORE_KEY]).toBeUndefined();
});

test("newWriterId gives a UUID, never the same one twice", () => {
  const first = newWriterId();
  expect(first).toMatch(UUID);
  expect(newWriterId()).not.toBe(first);
});

// --- two ledgers, one store ---

test("(a) two ledgers writing one store in the same instant: two rows, two presses summed", async () => {
  const f = fakeEngine();
  const a = createLedger("a");
  const b = createLedger("b");

  await Promise.all([recordPress(a, f.$, AMOUNT), recordPress(b, f.$, AMOUNT)]);

  const today = await dayTotal(f.$, TODAY);
  expect(today.presses).toBe(2);
  expect(today.unpriced).toBe(0);
  expectUsd(today.usd, 0.02);
  expect(Object.keys(f.store).sort()).toEqual([
    spendKey(TODAY, "a"),
    spendKey(TODAY, "b"),
  ]);
  expect(rowOf(f.store, "a")).toEqual(row(1, AMOUNT));
  expect(rowOf(f.store, "b")).toEqual(row(1, AMOUNT));
});

test("(b) interleaved writers: two presses from one and three from the other make five", async () => {
  const f = fakeEngine();
  const a = createLedger("a");
  const b = createLedger("b");

  await Promise.all([
    recordPress(a, f.$, AMOUNT),
    recordPress(b, f.$, undefined),
    recordPress(a, f.$, AMOUNT),
    recordPress(b, f.$, AMOUNT),
    recordPress(b, f.$, AMOUNT),
  ]);

  const today = await storeTotal(f.store);
  expect(today.presses).toBe(5);
  expect(today.unpriced).toBe(1);
  expectUsd(today.usd, 0.04);
  expect(rowOf(f.store, "a")).toEqual(row(2, 0.02));
  expect((rowOf(f.store, "b") as DayStats).presses).toBe(3);
});

test("dayTotal sums the exact spend:<day>: prefix once the legacy row is present, and a malformed row counts as nothing", async () => {
  // The legacy row is present, so the stale stats row is not read; a day
  // still only in `stats` is ledger-upgrade.test.ts
  const f = fakeEngine({
    store: {
      [spendKey(TODAY, "a")]: row(2, 0.2),
      [spendKey(TODAY, "b")]: { presses: 3 },
      [spendKey(TODAY, "c")]: "nonsense",
      [spendKey(TODAY, "d")]: { presses: "4", usd: Number.NaN, unpriced: null },
      [spendKey(TODAY, "legacy")]: row(1, 0.2),
      [spendKey("2026-10-15", "a")]: row(9, 0.9),
      [`spend:${TODAY}x:a`]: row(9, 0.9),
      [`xspend:${TODAY}:a`]: row(9, 0.9),
      [`spend:${TODAY}`]: row(9, 0.9),
      model: "sonnet",
      [STATS_STORE_KEY]: { byDay: { [TODAY]: row(9, 0.9) } },
    },
  });

  const today = await storeTotal(f.store);

  expect(today).toEqual(row(6, 0.4));
  expect(await storeTotal(f.store, "2026-10-15")).toEqual(row(9, 0.9));
  expect(await storeTotal(f.store, "2026-10-14")).toEqual(row(0, 0));
});

// --- (c) what the caps and status read ---

test("(c) spentUsd's day is the machine-wide sum: this writer's row plus the others'", async () => {
  const f = fakeEngine({
    store: { [spendKey(TODAY, "other")]: row(4, 0.5) },
  });

  await thisSessionPress(f.$, AMOUNT);
  const spent = await spentUsd(f.$);

  expectUsd(spent.day, 0.51);
  expect(spent.session).toBe(0);
  expect(todayKeys(f.store)).toHaveLength(2);
});

test("(c) status's today line is the machine-wide sum after one press beside another session's row", async ($, on) => {
  const e = engine(on, { model: API_FABLE });
  e.store[spendKey(TODAY, "other")] = row(4, 0.5, 1);

  await press($, DRAFT);
  const status = ((await press($, "status")) as { text: string }).text;

  expect(status).toContain(`session: 1 press · ${formatDollars(COST)}\n`);
  expect(status).toContain(
    `today: 5 presses · ${formatDollars(0.5 + COST)} · unpriced calls: 1\n`,
  );
  expect(todayKeys(e.store)).toHaveLength(2);
});

// --- (d) the 0.4.x row ---

test("(d) the first write migrates the stats row to legacy rows and deletes it; a later ledger finds nothing to do", async () => {
  const f = fakeEngine({
    store: {
      [STATS_STORE_KEY]: {
        byDay: { [TODAY]: row(3, 0.05), "2026-10-15": row(1, 0.01) },
      },
    },
  });

  await recordPress(createLedger("m"), f.$, AMOUNT);

  expect(f.store[STATS_STORE_KEY]).toBeUndefined();
  expect(rowOf(f.store, "legacy")).toEqual(row(3, 0.05));
  expect(f.store[spendKey("2026-10-15", "legacy")]).toEqual(row(1, 0.01));
  expect(rowOf(f.store, "m")).toEqual(row(1, AMOUNT));
  const today = await storeTotal(f.store);
  expect(today.presses).toBe(4);
  expectUsd(today.usd, 0.06);

  const before = JSON.stringify(f.store);
  await recordPress(createLedger("n"), f.$, undefined);

  // The second ledger added its own row and touched nothing else
  const after = { ...f.store };
  delete after[spendKey(TODAY, "n")];
  expect(JSON.stringify(after)).toBe(before);
  expect((await storeTotal(f.store)).presses).toBe(5);
});

test("(d) two ledgers migrating one stats row at once write each legacy row once, identically", async () => {
  const f = fakeEngine({
    store: {
      [STATS_STORE_KEY]: {
        byDay: { [TODAY]: row(3, 0.05), "2026-10-15": row(1, 0.01) },
      },
    },
  });
  const a = createLedger("a");
  const b = createLedger("b");

  await Promise.all([recordPress(a, f.$, AMOUNT), recordPress(b, f.$, AMOUNT)]);

  expect(f.store[STATS_STORE_KEY]).toBeUndefined();
  expect(rowOf(f.store, "legacy")).toEqual(row(3, 0.05));
  expect(f.store[spendKey("2026-10-15", "legacy")]).toEqual(row(1, 0.01));
  expect(Object.keys(f.store).sort()).toEqual(
    [
      spendKey("2026-10-15", "legacy"),
      spendKey(TODAY, "a"),
      spendKey(TODAY, "b"),
      spendKey(TODAY, "legacy"),
    ].sort(),
  );
  const today = await storeTotal(f.store);
  expect(today.presses).toBe(5);
  expectUsd(today.usd, 0.07);
});

test("(d) a legacy row already present is kept, not overwritten; the stats row still goes", async () => {
  const f = fakeEngine({
    store: {
      [spendKey(TODAY, "legacy")]: row(9, 0.9),
      [STATS_STORE_KEY]: { byDay: { [TODAY]: row(3, 0.05) } },
    },
  });

  await recordPress(createLedger("m"), f.$, AMOUNT);

  expect(f.store[STATS_STORE_KEY]).toBeUndefined();
  expect(rowOf(f.store, "legacy")).toEqual(row(9, 0.9));
  expect((await storeTotal(f.store)).presses).toBe(10);
});

test("(d) a migration whose write is refused is retried by the next press", async () => {
  const store: Record<string, unknown> = {
    [STATS_STORE_KEY]: { byDay: { [TODAY]: row(3, 0.05) } },
  };
  const refused = fakeEngine({
    store,
    denySet: { key: spendKey(TODAY, "legacy"), reason: "disk full" },
  });
  const ledger = createLedger("m");

  await expect(recordPress(ledger, refused.$, AMOUNT)).rejects.toThrow(
    "disk full",
  );
  expect(store[STATS_STORE_KEY]).toBeDefined();
  expect(todayKeys(store)).toEqual([]);

  await recordPress(ledger, fakeEngine({ store }).$, AMOUNT);

  expect(store[STATS_STORE_KEY]).toBeUndefined();
  expect(rowOf(store, "legacy")).toEqual(row(3, 0.05));
  expect((await storeTotal(store)).presses).toBe(4);
});

// --- (e) pruning ---

test("(e) a write prunes rows older than seven days and keeps today's and the last seven days'", async () => {
  const seventhDay = dayOf(NOW_MS - 7 * DAY_MS);
  const eighthDay = dayOf(NOW_MS - 8 * DAY_MS);
  const f = fakeEngine({
    store: {
      "spend:2026-10-01:x": row(1, 0.01),
      "spend:2026-10-10:x": row(1, 0.01),
      [spendKey(eighthDay, "x")]: row(1, 0.01),
      [spendKey(seventhDay, "x")]: row(1, 0.01),
      [spendKey(TODAY, "other")]: row(1, 0.01),
      model: "sonnet",
    },
  });

  await thisSessionPress(f.$, AMOUNT);

  expect(f.store["spend:2026-10-01:x"]).toBeUndefined();
  expect(f.store[spendKey(eighthDay, "x")]).toBeUndefined();
  expect(f.store["spend:2026-10-10:x"]).toEqual(row(1, 0.01));
  expect(f.store[spendKey(seventhDay, "x")]).toEqual(row(1, 0.01));
  expect(rowOf(f.store, "other")).toEqual(row(1, 0.01));
  expect(f.store.model).toBe("sonnet");
  expect((await storeTotal(f.store)).presses).toBe(2);
});

// --- (f) the day cap counts the other session ---

test(
  "(f) the day cap is crossed by another session's spend plus one press here, and the next press is refused",
  { options: { dayCapUsd: 0.02 } },
  async ($, on) => {
    const e = engine(on, {
      model: API_FABLE,
      replies: [answered(GOOD, CENT), answered(GOOD, CENT)],
    });
    e.store[spendKey(TODAY, "other")] = row(1, 0.015);

    await press($, DRAFT);
    e.box.text = "";
    await press($, DRAFT_2);

    expect(e.calls).toHaveLength(1);
    expect(e.fills).toHaveLength(1);
    expect(e.toasts).toHaveLength(2);
    expect(e.toasts[1]).toBe("prompt-lift: day cap $0.02 reached");
    // Alone, this session's $0.0099 would be under the cap
    const today = await storeTotal(e.store);
    expect(today.presses).toBe(2);
    expectUsd(
      today.usd,
      0.015 + (estimateUsd(CENT, FABLE, DEFAULT_PRICES) ?? 0),
    );
    expect(((await press($, "status")) as { text: string }).text).toContain(
      "\ncaps: day $0.02 ($0.00 left)\n",
    );
  },
);
