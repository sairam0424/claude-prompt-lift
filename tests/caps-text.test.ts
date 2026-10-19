import { expect, test } from "claude-code/testing";
import { parseOptions, type Config } from "../hooks/config";
import {
  capReachedToast,
  capsLine,
  capStatus,
  leftText,
} from "../hooks/caps";

const SESSION_REACHED =
  "prompt-lift: session cap $0.10 reached · /prompt-lift cap off";
const DAY_REACHED = "prompt-lift: day cap $0.50 reached";

function caps(sessionCapUsd: number, dayCapUsd: number) {
  return parseOptions({ sessionCapUsd, dayCapUsd });
}

test("capStatus names the active windows, what is left and the one hit", () => {
  const spent = { session: 0.25, day: 0.25 };
  expect(capStatus(spent, null, caps(0, 0))).toEqual({});
  expect(capStatus(spent, null, caps(1, 0))).toEqual({
    session: { cap: 1, left: 0.75 },
  });
  expect(capStatus(spent, null, caps(0, 2))).toEqual({
    day: { cap: 2, left: 1.75 },
  });
  // The override replaces the option for the session; 0 turns it off
  expect(capStatus(spent, 2, caps(1, 0)).session).toEqual({
    cap: 2,
    left: 1.75,
  });
  expect(capStatus(spent, 0.5, caps(0, 0)).session).toEqual({
    cap: 0.5,
    left: 0.25,
  });
  expect(capStatus(spent, 0, caps(1, 0))).toEqual({});
  // Reached at the cap, not before; the session's is named first
  const reached = (s: number, d: number, cfg: Config) =>
    capStatus({ session: s, day: d }, null, cfg).reached;
  expect(reached(0.1, 0, caps(0.1, 0))).toBe("session");
  expect(reached(0.0999, 0, caps(0.1, 0))).toBeUndefined();
  expect(reached(0, 0.2, caps(0, 0.1))).toBe("day");
  expect(reached(1, 1, caps(0.1, 0.1))).toBe("session");
  // The day cap has no override
  expect(capStatus({ session: 0, day: 0.2 }, 5, caps(0, 0.1))).toEqual({
    session: { cap: 5, left: 5 },
    day: { cap: 0.1, left: 0 },
    reached: "day",
  });
});

test("capReachedToast, leftText and capsLine spell the caps out", () => {
  const session = { cap: 1, left: 0.75 };
  const day = { cap: 2, left: 0.3 };
  expect(
    capReachedToast({ session: { cap: 0.1, left: 0 }, reached: "session" }),
  ).toBe(SESSION_REACHED);
  expect(capReachedToast({ day: { cap: 0.5, left: 0 }, reached: "day" })).toBe(
    DAY_REACHED,
  );
  expect(capReachedToast({ session })).toBeUndefined();

  expect(leftText({})).toBeUndefined();
  expect(leftText({ session })).toBe("$0.75 left");
  expect(leftText({ day })).toBe("$0.30 left (day)");
  expect(leftText({ session, day })).toBe("$0.30 left (day)");
  expect(leftText({ session, day: { cap: 2, left: 0.75 } })).toBe("$0.75 left");

  expect(capsLine({})).toBe("caps: off");
  expect(capsLine({ session })).toBe("caps: session $1.00 ($0.75 left)");
  expect(capsLine({ session, day })).toBe(
    "caps: session $1.00 ($0.75 left) · day $2.00 ($0.30 left)",
  );
});

// Task 7 fold-in: capsLine with day only, leftText tie (C11 §12.2, R7)
test("capsLine renders day-only cap", () => {
  const day = { cap: 5, left: 4.5 };
  expect(capsLine({ day })).toBe("caps: day $5.00 ($4.50 left)");
});

test("leftText tie: when day.left === session.left, show session", () => {
  const session = { cap: 1, left: 0.5 };
  const day = { cap: 2, left: 0.5 };
  expect(leftText({ session, day })).toBe("$0.50 left");
});
