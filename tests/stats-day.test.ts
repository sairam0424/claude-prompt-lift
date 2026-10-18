import { expect, test } from "claude-code/testing";
import { localDay, NOW_MS, TODAY } from "./engine";
import { dayOf } from "../hooks/stats";

// --- R6: the stats day is the local day ---

test("dayOf keys stats by the local, zero-padded day", async () => {
  const lateUtc = Date.UTC(2026, 9, 16, 23, 30, 0);
  // Independent check: dayOf uses local time, so compare with UTC adjusted by offset
  const localMs = lateUtc - new Date(lateUtc).getTimezoneOffset() * 60_000;
  const utcDate = new Date(localMs);
  const expectedDay = `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, "0")}-${String(utcDate.getUTCDate()).padStart(2, "0")}`;
  expect(dayOf(lateUtc)).toBe(expectedDay);
  // Also verify against the Date API for consistency (but Date-based)
  expect(dayOf(lateUtc)).toBe(localDay(new Date(lateUtc)));
  expect(dayOf(lateUtc)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Built from local parts, so this literal holds in every zone
  expect(dayOf(new Date(2026, 0, 5, 12).getTime())).toBe("2026-01-05");
  expect(dayOf(NOW_MS)).toBe(TODAY);
});
