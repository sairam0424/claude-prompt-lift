import { expect, test } from "claude-code/testing";
import {
  commandTokens,
  pathTokens,
  protectedTokens,
  stripEdges,
} from "../hooks/tokens";
import { riskyAdditions, stripUnknownSkills } from "../hooks/guards";

// The token shapes the post-processing guards compare (spec §9.8–§9.11), with
// the punctuation prose wraps them in stripped off, and the file-looking test
// the path guard applies before it asks the filesystem.

test("stripEdges drops wrapping punctuation and keeps the token's own", () => {
  expect(stripEdges("src/auth.ts.")).toBe("src/auth.ts");
  expect(stripEdges("(src/auth.ts),")).toBe("src/auth.ts");
  expect(stripEdges('"/review"!')).toBe("/review");
  expect(stripEdges("@src/a.ts;")).toBe("@src/a.ts");
  expect(stripEdges("e.g.")).toBe("e.g");
  expect(stripEdges("...")).toBe("");
});

test("protected tokens survive a sentence that ends with them", () => {
  expect(protectedTokens("fix the bug in src/auth.ts.")).toEqual([
    "src/auth.ts",
  ]);
  expect(protectedTokens("why does @src/a.ts, break?")).toContain("@src/a.ts");
  expect(protectedTokens("see `foo.bar()`.")).toEqual(["`foo.bar()`"]);
  expect(protectedTokens("compare with [Image #2].")).toEqual(["[Image #2]"]);
  expect(protectedTokens("fix (src/auth.ts) and auth.ts.")).toEqual([
    "src/auth.ts",
    "auth.ts",
  ]);
});

test("path and command tokens come back without edge punctuation", () => {
  expect(pathTokens("see src/auth.ts, then docs/x.md.")).toEqual([
    "src/auth.ts",
    "docs/x.md",
  ]);
  expect(commandTokens("run /review. then /commit-commands:commit,")).toEqual([
    "/review",
    "/commit-commands:commit",
  ]);
  expect(commandTokens("see /src/auth.ts and /a/b")).toEqual([]);
});

test("a sentence-final skill mention is not a risky addition", () => {
  const known = new Set(["review"]);
  expect(riskyAdditions("Do it, then run /review.", "", known)).toEqual([]);
  expect(riskyAdditions("Do it, then run /unknown.", "", known)).toEqual([
    "/unknown",
  ]);
  expect(riskyAdditions("see /etc/hosts.", "edit /etc/hosts.", known)).toEqual(
    [],
  );
});

test("stripUnknownSkills strips per token and leaves paths alone", () => {
  const known = new Set(["review"]);
  expect(stripUnknownSkills("see /src/foo and /foo", known)).toBe(
    "see /src/foo and foo",
  );
  expect(stripUnknownSkills("run /review. then /nope.", known)).toBe(
    "run /review. then nope.",
  );
  expect(stripUnknownSkills("(/nope) and /review", known)).toBe(
    "(nope) and /review",
  );
  expect(stripUnknownSkills("/foo\n/foo", new Set())).toBe("foo\nfoo");
});
