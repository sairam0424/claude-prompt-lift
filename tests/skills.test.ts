import { expect, test } from "claude-code/testing";
import {
  demoteLeadingSkill,
  stripUnknownSkills,
  postProcess,
} from "../hooks/guards";
import { parseOptions } from "../hooks/config";

// R7 precision: demote only command-shaped leading tokens
test("demoteLeadingSkill leaves /src/auth.ts path-like leading token untouched", () => {
  const cfg = parseOptions({});
  const draft = "there is a bug";
  const result = demoteLeadingSkill("/src/auth.ts has a bug", {
    draft,
    cfg,
    descriptions: new Map(),
  });
  expect(result).toBe("/src/auth.ts has a bug");
});

test("demoteLeadingSkill moves trailing punctuation after the skill clause", () => {
  const cfg = parseOptions({});
  const draft = "write a commit message";
  const descriptions = new Map([
    ["commit-commands:commit", "Create a conventional commit"],
  ]);
  const result = demoteLeadingSkill("/commit-commands:commit Write a commit.", {
    draft,
    cfg,
    descriptions,
  });
  expect(result).toBe("Write a commit, using the /commit-commands:commit skill.");
});

test("stripUnknownSkills strips against listed names, not the full known set", () => {
  const listed = new Set(["/review", "review"]);
  const result1 = stripUnknownSkills("/mindforge:do fix it", listed);
  expect(result1).toBe("mindforge:do fix it"); // mindforge not in listing

  const result2 = stripUnknownSkills("/review the code", listed);
  expect(result2).toBe("/review the code"); // review is listed
});

test("isTruncated on verdict.prompt, not raw reply: JSON ending in } not truncated when prompt ends with period", () => {
  const cfg = parseOptions({});
  const draft = "write a test";
  const reply = '{"verdict":"improve","prompt":"Write a unit test for the auth module.","why":"","applied":[]}';
  const result = postProcess({
    draft,
    reply,
    outputTokens: 1850,
    cfg: { ...cfg, maxTokens: 2000 },
    knownSkills: new Set(),
    listedSkills: new Set(),
    descriptions: new Map(),
    documents: "",
  });
  // The raw reply ends in }, but verdict.prompt ends with ., so not truncated
  expect(result.ok).toBe(true);
});
