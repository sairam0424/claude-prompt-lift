import { expect } from "claude-code/testing";
import type { EngineInterface } from "claude-code";
import { NOW_MS, TODAY } from "./engine";
import { dayTotal, spendKey, type DayStats } from "../hooks/ledger";

// The ledger tests' fake `$` and their reads of a store, shared by
// stats-serial.test.ts and stats-cross-session.test.ts and by the tests that
// read what a press wrote through the stub engine's `e.store`.

type StateName = { readonly plugin: string; readonly key: string };
type Versioned = { value: unknown; version: number };
export type Fake = {
  $: EngineInterface;
  store: Record<string, unknown>;
  /** Every line the ledger wrote through `$.ui.log`, in order. */
  logs: string[];
};

export type FakeOptions = {
  /**
   * The record to answer the store from: the stub engine's `e.store`, or one
   * record shared by two ledgers; a fresh one when absent.
   */
  store?: Record<string, unknown>;
  /** The clock's one answer; `NOW_MS` when absent. */
  nowMs?: number;
  /**
   * Make every write of a key with this prefix reject, as `engine`'s
   * `denyStoreSet` does.
   */
  denySet?: { key: string; reason: string };
  /** Make every delete of a key with this prefix reject. */
  denyDelete?: { key: string; reason: string };
  /** Hold every write until this settles: the other session's write, timed. */
  holdSet?: Promise<void>;
};

/**
 * The slice of `$` the ledger touches (`clock`, `store`, `state`, `ui.log`),
 * answered from memory with the host's await gaps. A test gets the engine's
 * own `$`, which has no `store`, `state` or `clock`, so the ledger's functions
 * cannot take it; and a press cannot start while another runs (the phase
 * guard), so `press` cannot race two of them. `state.set` honours `ifVersion`
 * so `update`'s retry loop runs as it does on the host.
 */
export function fakeEngine(opts: FakeOptions = {}): Fake {
  const store = opts.store ?? {};
  const logs: string[] = [];
  const state = new Map<string, Versioned>();
  const nameOf = (ref: StateName): string => `${ref.plugin}/${ref.key}`;
  const unset: Versioned = { value: undefined, version: 0 };
  const slice = {
    clock: { now: async (): Promise<number> => opts.nowMs ?? NOW_MS },
    store: {
      get: async (key: string): Promise<unknown> => store[key],
      set: async (key: string, value: unknown): Promise<void> => {
        await opts.holdSet;
        if (opts.denySet !== undefined && key.startsWith(opts.denySet.key)) {
          throw new Error(opts.denySet.reason);
        }
        store[key] = value;
      },
      delete: async (key: string): Promise<void> => {
        const denied = opts.denyDelete;
        if (denied !== undefined && key.startsWith(denied.key)) {
          throw new Error(denied.reason);
        }
        delete store[key];
      },
      keys: async (): Promise<string[]> => Object.keys(store),
    },
    ui: {
      log: (text: string): void => {
        logs.push(text);
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
  return { $: slice as unknown as EngineInterface, store, logs };
}

/** The exact prefix of today's rows, every writer's. */
export const TODAY_PREFIX = spendKey(TODAY, "");

/** Today's row keys in `store`, every writer's, in insertion order. */
export function todayKeys(store: Record<string, unknown>): string[] {
  return Object.keys(store).filter((key) => key.startsWith(TODAY_PREFIX));
}

/** What the production read makes of `store`'s rows for `day`. */
export function storeTotal(
  store: Record<string, unknown>,
  day: string = TODAY,
): Promise<DayStats> {
  return dayTotal(fakeEngine({ store }).$, day);
}

/** The kit has no toBeCloseTo: a dollar sum is checked to within 1e-9. */
export function expectUsd(actual: number | undefined, usd: number): void {
  expect(Math.abs((actual ?? Number.NaN) - usd)).toBeLessThan(1e-9);
}
