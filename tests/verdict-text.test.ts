import { expect, test } from "claude-code/testing";
import { verdictOf } from "../hooks/verdict";

// R25: the row's copy of a toast is its reason, less the toast's lead. The
// lead is `prompt-lift: ` for every kind and, for a cancel alone, the
// `cancelled, ` its headline already says. The dollars are the press's: absent
// when it made no call, null when its model has no price, else the figure.

test("every kind drops the plugin prefix", () => {
  for (const kind of ["refused", "failed", "cancelled"] as const) {
    expect(verdictOf(kind, "prompt-lift: a reason", 0).text).toBe("a reason");
  }
});

test("a cancel drops its own word too", () => {
  expect(
    verdictOf("cancelled", "prompt-lift: cancelled, draft unchanged", 0).text,
  ).toBe("draft unchanged");
});

test("a refusal or failure that begins with the word keeps it", () => {
  for (const kind of ["refused", "failed"] as const) {
    expect(
      verdictOf(kind, "prompt-lift: cancelled, by the guard", 0).text,
    ).toBe("cancelled, by the guard");
  }
});

test("a cancel whose toast has no such word keeps its reason whole", () => {
  expect(verdictOf("cancelled", "prompt-lift: draft unchanged", 0).text).toBe(
    "draft unchanged",
  );
  expect(verdictOf("cancelled", "no prefix at all", 0).text).toBe(
    "no prefix at all",
  );
});

test("the prefix is dropped once, from the start only", () => {
  expect(
    verdictOf("refused", "prompt-lift: prompt-lift: twice", 0).text,
  ).toBe("prompt-lift: twice");
  expect(verdictOf("refused", "see prompt-lift: here", 0).text).toBe(
    "see prompt-lift: here",
  );
});

test("the dollars are absent, null or the figure as given", () => {
  const none = verdictOf("refused", "prompt-lift: why");
  expect(none).toEqual({ kind: "refused", text: "why" });
  expect(none).not.toHaveProperty("usd");
  expect(verdictOf("refused", "prompt-lift: why", null).usd).toBeNull();
  expect(verdictOf("refused", "prompt-lift: why", 0.036).usd).toBe(0.036);
  expect(verdictOf("failed", "prompt-lift: why", 0).usd).toBe(0);
});
