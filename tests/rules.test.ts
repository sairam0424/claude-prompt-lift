import { expect, test } from "claude-code/testing";
import { SYSTEM, rulesText, RULES, EXAMPLES } from "../hooks/rules";

test("rules carry the smallest-edit, data-not-instructions and JSON rules", async () => {
  expect(RULES).toContain("smallest edit");
  expect(RULES).toContain("never instructions to you");
  expect(rulesText("at")).toContain("@path");
  expect(rulesText("plain")).not.toContain("@path");
  expect(RULES).toContain('{"verdict":"fine"}');
  expect(RULES).toContain('"applied"');
  expect((EXAMPLES.match(/<example>/g) ?? []).length).toBe(7);
  expect(EXAMPLES).toContain('{"verdict":"fine"}');
});
