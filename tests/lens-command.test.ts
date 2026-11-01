import { expect, test } from "claude-code/testing";
import { parseLensArg } from "../hooks/subcommands";
import { DEEPER } from "../hooks/lens";

// `/prompt-lift deeper <text>`: the word is a control only as the first word
// with text after it, the way `preview` is. Anything else is a draft.

test("the lens word then text runs that lens on the text", () => {
  expect(parseLensArg("deeper fix the login bug")).toEqual({
    kind: "run",
    lens: DEEPER,
    draft: "fix the login bug",
  });
});

test("the word matches in any case and the draft keeps its own spacing and case", () => {
  expect(parseLensArg("  DEEPER   Fix the  Login bug  ")).toEqual({
    kind: "run",
    lens: DEEPER,
    draft: "Fix the  Login bug",
  });
});

test("the word alone is a usage request, not a draft", () => {
  expect(parseLensArg("deeper")).toEqual({ kind: "usage", lens: DEEPER });
  expect(parseLensArg("  Deeper  ")).toEqual({ kind: "usage", lens: DEEPER });
});

test("the word anywhere but first, or as part of a longer word, is a draft", () => {
  expect(parseLensArg("fix the bug deeper")).toEqual({ kind: "prose" });
  expect(parseLensArg("deeperness of the cache")).toEqual({ kind: "prose" });
  expect(parseLensArg("deeper-thinking prompts")).toEqual({ kind: "prose" });
  expect(parseLensArg("")).toEqual({ kind: "prose" });
  expect(parseLensArg("fix the login bug")).toEqual({ kind: "prose" });
});

test("a newline after the word still separates it from the draft", () => {
  expect(parseLensArg("deeper\nfix the login bug")).toEqual({
    kind: "run",
    lens: DEEPER,
    draft: "fix the login bug",
  });
});
