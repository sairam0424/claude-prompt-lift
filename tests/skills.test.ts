import { expect, test } from "claude-code/testing";
import {
  demoteLeadingSkill,
  stripUnknownSkills,
  postProcess,
} from "../hooks/guards";
import { parseOptions } from "../hooks/config";

// A leading path never reaches the demotion: `startsWithCommandPrefix`
// refuses it first (the §2 anti-goal), through postProcess (C13: leading path refusal, via postProcess)
test("postProcess refuses a rewrite that leads with a path such as /src/auth.ts", () => {
  const cfg = parseOptions({});
  const draft = "fix the login bug in /src/auth.ts";
  const result = postProcess({
    draft,
    reply: JSON.stringify({
      verdict: "improve",
      prompt:
        "/src/auth.ts has the login bug, fix the login bug in /src/auth.ts",
      why: "",
      applied: [],
    }),
    outputTokens: 50,
    cfg,
    knownSkills: new Set(["review"]),
    listedSkills: new Set(["review"]),
    descriptions: new Map(),
    documents: "",
  });
  expect(result).toEqual({
    ok: false,
    toast:
      "prompt-lift: rewrite starts with a command prefix, kept your prompt",
  });
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

test("demoteLeadingSkill moves the whole run of trailing marks and mentions the bare skill", () => {
  const cfg = parseOptions({});
  const descriptions = new Map([
    ["commit-commands:commit", "Create a conventional commit"],
    ["review", "Pre-landing PR review"],
  ]);
  // The run of marks moves as one; `..` never ends up inside the sentence
  expect(
    demoteLeadingSkill("/commit-commands:commit Write a commit...", {
      draft: "write a commit message",
      cfg,
      descriptions,
    }),
  ).toBe("Write a commit, using the /commit-commands:commit skill...");
  // The mention is the skill's name, not the token with its punctuation
  expect(
    demoteLeadingSkill("/review, then fix the bug.", {
      draft: "fix the bug",
      cfg,
      descriptions,
    }),
  ).toBe("Then fix the bug, using the /review skill.");
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


// Task 7 fold-in: demotion keeps a mark-only rewrite (§12 R7)
test("demoteLeadingSkill keeps /skill... unchanged when rest is only marks", () => {
  const cfg = parseOptions({});
  const descriptions = new Map([
    ["review", "Pre-landing PR review"],
    ["code-review", "Staff-engineer code review"],
  ]);
  
  expect(demoteLeadingSkill("/review...", {
    draft: "review the PR",
    cfg,
    descriptions,
  })).toBe("/review...");
  
  expect(demoteLeadingSkill("/code-review?!", {
    draft: "code-review please",
    cfg,
    descriptions,
  })).toBe("/code-review?!");
});
