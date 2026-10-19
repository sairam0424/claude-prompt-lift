import { expect, test } from "claude-code/testing";
import { parseCapArg, CAP_USAGE } from "../hooks/caps";

// Fold-in tests from Task 3 review: parseCapArg must reject non-decimal formats.

test("parseCapArg accepts valid decimal", () => {
  const r1 = parseCapArg("cap 2.50");
  expect(r1).toEqual({ kind: "set", usd: 2.50 });

  const r2 = parseCapArg("cap 10");
  expect(r2).toEqual({ kind: "set", usd: 10 });

  const r3 = parseCapArg("cap 0.5");
  expect(r3).toEqual({ kind: "set", usd: 0.5 });
});

test("parseCapArg rejects hex", () => {
  const r = parseCapArg("cap 0x10");
  expect(r).toEqual({ kind: "invalid" });
});

test("parseCapArg rejects scientific notation", () => {
  const r = parseCapArg("cap 1e2");
  expect(r).toEqual({ kind: "invalid" });
});

test("parseCapArg rejects negative zero", () => {
  const r = parseCapArg("cap -0");
  expect(r).toEqual({ kind: "invalid" });
});

test("parseCapArg rejects negative numbers", () => {
  const r = parseCapArg("cap -5");
  expect(r).toEqual({ kind: "invalid" });
});
