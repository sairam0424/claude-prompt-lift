import { expect, test } from "claude-code/testing";
import { recordPress, recordSpend, spentUsd } from "../hooks/stats";
import {
  expectUsd,
  fakeEngine,
  storeTotal,
  todayKeys,
  TODAY_PREFIX,
} from "./ledger-fake";

// R18 (catalogue review of seed PR #341, finding 2): a writer's
// read-modify-write of its own day row is serialized inside its ledger, so two
// presses recorded in the same instant both land, with both costs. These cases
// drive the module's own ledger — one writer, one queue, shared by every test
// in this file (one module instance) — and read the day back through
// `dayTotal`, the machine-wide sum (R24). The rejection test runs right before
// the fresh-engine test on purpose, to show the queue goes on after a rejected
// write. Two writers are stats-cross-session.test.ts.

const AMOUNT = 0.01;

test("two presses recorded in the same instant both land in the writer's one row", async () => {
  const f = fakeEngine();

  await Promise.all([recordPress(f.$, AMOUNT), recordPress(f.$, AMOUNT)]);

  const today = await storeTotal(f.store);
  expect(today.presses).toBe(2);
  expect(today.unpriced).toBe(0);
  expectUsd(today.usd, 0.02);
  expect(todayKeys(f.store)).toHaveLength(1);
});

test("a priced and an unpriced press in the same instant both count", async () => {
  const f = fakeEngine();

  await Promise.all([recordPress(f.$, AMOUNT), recordPress(f.$, undefined)]);

  const today = await storeTotal(f.store);
  expect(today.presses).toBe(2);
  expect(today.unpriced).toBe(1);
  expectUsd(today.usd, 0.01);
});

test("three concurrent recordSpend calls count three presses in the day and the session", async () => {
  const f = fakeEngine();

  await Promise.all([
    recordSpend(f.$, 0.02),
    recordSpend(f.$, 0.02),
    recordSpend(f.$, 0.02),
  ]);

  const today = await storeTotal(f.store);
  expect(today.presses).toBe(3);
  expect(today.unpriced).toBe(0);
  expectUsd(today.usd, 0.06);
  const spent = await spentUsd(f.$);
  expectUsd(spent.session, 0.06);
  expectUsd(spent.day, 0.06);
});

test("a refused store write rejects recordPress, and the queue goes on: the next presses land", async () => {
  const refused = fakeEngine({
    denySet: { key: TODAY_PREFIX, reason: "disk full" },
  });

  await expect(recordPress(refused.$, AMOUNT)).rejects.toThrow("disk full");
  expect(todayKeys(refused.store)).toEqual([]);

  // Same module-level queue, fresh engine: the rejected entry must not stall
  // it, in this very test, whatever order the runner picks.
  const f = fakeEngine();
  await recordPress(f.$, AMOUNT);
  await Promise.all([recordPress(f.$, AMOUNT), recordPress(f.$, AMOUNT)]);

  const today = await storeTotal(f.store);
  expect(today.presses).toBe(3);
  expect(today.unpriced).toBe(0);
  expectUsd(today.usd, 3 * AMOUNT);
});

test("two presses recorded in turn give the row they always did", async () => {
  const f = fakeEngine();

  await recordPress(f.$, 0.01);
  await recordPress(f.$, 0.03);

  const today = await storeTotal(f.store);
  expect(today.presses).toBe(2);
  expect(today.unpriced).toBe(0);
  expectUsd(today.usd, 0.04);
});
