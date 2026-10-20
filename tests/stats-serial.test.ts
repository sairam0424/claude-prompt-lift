import { expect, test } from "claude-code/testing";
import type { EngineInterface } from "claude-code";
import { NOW_MS, TODAY } from "./engine";
import {
  recordPress,
  recordSpend,
  spentUsd,
  STATS_STORE_KEY,
  type DayStats,
  type Stats,
} from "../hooks/stats";

// R18 (catalogue review of seed PR #341, finding 2): `recordPress`'s
// read-modify-write of the day row is serialized inside the module, so two
// presses recorded in the same instant both land, with both costs. The queue is
// module state shared by every test in this file (one module instance): the
// rejection test runs right before the fresh-engine test on purpose, to show
// the queue goes on after a rejected write.

const AMOUNT = 0.01;

type StateName = { readonly plugin: string; readonly key: string };
type Versioned = { value: unknown; version: number };
type Fake = { $: EngineInterface; store: Record<string, unknown> };

/**
 * The slice of `$` that `recordPress` and `recordSpend` touch, answered from
 * memory with the host's await gaps. A test gets the engine's own `$`, which
 * has no `store`, `state` or `clock`, so the hooks' functions cannot take it;
 * and a press cannot start while another runs (the phase guard), so `press`
 * cannot race two of them. `denySet` makes every write of that store key
 * reject, as `engine`'s `denyStoreSet` does; `state.set` honours `ifVersion`
 * so `update`'s retry loop runs as it does on the host.
 */
function fakeEngine(denySet?: { key: string; reason: string }): Fake {
  const store: Record<string, unknown> = {};
  const state = new Map<string, Versioned>();
  const nameOf = (ref: StateName): string => `${ref.plugin}/${ref.key}`;
  const unset: Versioned = { value: undefined, version: 0 };
  const slice = {
    clock: { now: async (): Promise<number> => NOW_MS },
    store: {
      get: async (key: string): Promise<unknown> => store[key],
      set: async (key: string, value: unknown): Promise<void> => {
        if (denySet !== undefined && denySet.key === key) {
          throw new Error(denySet.reason);
        }
        store[key] = value;
      },
    },
    state: {
      get: async (ref: StateName): Promise<Versioned> =>
        state.get(nameOf(ref)) ?? unset,
      set: async (
        ref: StateName,
        value: unknown,
        options?: { ifVersion?: number },
      ): Promise<{ isSet: boolean; version: number }> => {
        const current = state.get(nameOf(ref)) ?? unset;
        const wanted = options?.ifVersion;
        if (wanted !== undefined && wanted !== current.version) {
          return { isSet: false, version: current.version };
        }
        const next = { value, version: current.version + 1 };
        state.set(nameOf(ref), next);
        return { isSet: true, version: next.version };
      },
    },
  };
  return { $: slice as unknown as EngineInterface, store };
}

function dayRow(store: Record<string, unknown>): DayStats | undefined {
  return (store[STATS_STORE_KEY] as Stats | undefined)?.byDay[TODAY];
}

/** The kit has no toBeCloseTo: a dollar sum is checked to within 1e-9. */
function expectUsd(actual: number | undefined, usd: number): void {
  expect(Math.abs((actual ?? Number.NaN) - usd)).toBeLessThan(1e-9);
}

test("two presses recorded in the same instant both land in the day row", async () => {
  const f = fakeEngine();

  await Promise.all([recordPress(f.$, AMOUNT), recordPress(f.$, AMOUNT)]);

  const row = dayRow(f.store);
  expect(row?.presses).toBe(2);
  expect(row?.unpriced).toBe(0);
  expectUsd(row?.usd, 0.02);
});

test("a priced and an unpriced press in the same instant both count", async () => {
  const f = fakeEngine();

  await Promise.all([recordPress(f.$, AMOUNT), recordPress(f.$, undefined)]);

  const row = dayRow(f.store);
  expect(row?.presses).toBe(2);
  expect(row?.unpriced).toBe(1);
  expectUsd(row?.usd, 0.01);
});

test("three concurrent recordSpend calls count three presses in the day row and the session", async () => {
  const f = fakeEngine();

  await Promise.all([
    recordSpend(f.$, 0.02),
    recordSpend(f.$, 0.02),
    recordSpend(f.$, 0.02),
  ]);

  const row = dayRow(f.store);
  expect(row?.presses).toBe(3);
  expect(row?.unpriced).toBe(0);
  expectUsd(row?.usd, 0.06);
  const spent = await spentUsd(f.$);
  expectUsd(spent.session, 0.06);
  expectUsd(spent.day, 0.06);
});

test("a refused store write rejects recordPress with the reason", async () => {
  const f = fakeEngine({ key: STATS_STORE_KEY, reason: "disk full" });

  await expect(recordPress(f.$, AMOUNT)).rejects.toThrow("disk full");
  expect(f.store[STATS_STORE_KEY]).toBe(undefined);
});

test("the queue goes on after a rejected write: a fresh engine records the next press", async () => {
  const f = fakeEngine();

  await recordPress(f.$, AMOUNT);

  const row = dayRow(f.store);
  expect(row?.presses).toBe(1);
  expect(row?.unpriced).toBe(0);
  expectUsd(row?.usd, AMOUNT);
});

test("two presses recorded in turn give the row they always did", async () => {
  const f = fakeEngine();

  await recordPress(f.$, 0.01);
  await recordPress(f.$, 0.03);

  const row = dayRow(f.store);
  expect(row?.presses).toBe(2);
  expect(row?.unpriced).toBe(0);
  expectUsd(row?.usd, 0.04);
});
