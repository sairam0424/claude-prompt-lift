import { expect, test } from "claude-code/testing";
import { growthAllowed, MIN_GROWTH_CHARS, postProcess } from "../hooks/guards";
import { parseOptions } from "../hooks/config";
import { EXAMPLES, EXAMPLE_PAIRS } from "../hooks/rules";

// R15 (growth floor) and the invariant behind it: the mod's own few-shot
// examples must survive the post-call guard chain. Before the floor, the first
// example (a 225-char rewrite of the 17-char draft "fix the login bug") was
// over the 218-char allowance, so the model was taught to answer in a way
// Step 6 then refused, after the press was billed.

const TOO_LONG = "prompt-lift: rewrite too long, kept your prompt";
const DEFAULT_CAP = 1200;
const defaultCfg = parseOptions({});

// The one skill the built-in examples name; `postProcess` needs it listed.
const SKILLS = new Set(["commit-commands:commit"]);

function run(
  draft: string,
  prompt: string,
  cfg: ReturnType<typeof parseOptions> = defaultCfg,
) {
  return postProcess({
    draft,
    reply: JSON.stringify({ verdict: "improve", prompt, why: "", applied: [] }),
    outputTokens: 50,
    cfg,
    knownSkills: SKILLS,
    listedSkills: SKILLS,
    descriptions: new Map(),
    documents: "",
  });
}

function pairFor(draft: string) {
  const pair = EXAMPLE_PAIRS.find((p) => p.draft === draft);
  if (!pair) {
    throw new Error(`no built-in example for the draft "${draft}"`);
  }
  return pair;
}

test("MIN_GROWTH_CHARS is a 400 character floor and the default cap is 1200", () => {
  expect(MIN_GROWTH_CHARS).toBe(400);
  expect(defaultCfg.maxGrowthChars).toBe(DEFAULT_CAP);
});

test("growthAllowed gives short drafts the floor and long drafts the cap", () => {
  // [draft length, allowance]: 83 is the last length still under the floor
  // (150 + 3 * 83 = 399), 84 the first over it (402), 350 the first that hits
  // the 1200 cap (150 + 1050), and 1000 sits well past it.
  const table: ReadonlyArray<readonly [number, number]> = [
    [0, 400],
    [17, 417],
    [83, 483],
    [84, 486],
    [350, 1550],
    [1000, 2200],
  ];
  for (const [draftLen, allowed] of table) {
    expect({ draftLen, allowed: growthAllowed(draftLen, DEFAULT_CAP) }).toEqual(
      { draftLen, allowed },
    );
  }
});

test("maxGrowthChars still wins when a user sets it below the floor", () => {
  const table: ReadonlyArray<readonly [number, number]> = [
    [0, 100],
    [17, 117],
    [83, 183],
    [84, 184],
    [350, 450],
    [1000, 1100],
  ];
  for (const [draftLen, allowed] of table) {
    expect({ draftLen, allowed: growthAllowed(draftLen, 100) }).toEqual({
      draftLen,
      allowed,
    });
  }
});

test("the 225-char example rewrite for the 17-char draft passes the growth guard", () => {
  const { draft, answer } = pairFor("fix the login bug");
  expect(draft.length).toBe(17);
  expect(answer.prompt.length).toBe(225);
  expect(answer.prompt.length).toBeLessThanOrEqual(
    growthAllowed(draft.length, DEFAULT_CAP),
  );
  expect(run(draft, answer.prompt).ok).toBe(true);
});

test("a rewrite is refused one character past the widened allowance", () => {
  const draft = "fix the login bug";
  const fill = (n: number) => "Fix the login bug, " + "a".repeat(n - 19);
  const allowed = growthAllowed(draft.length, DEFAULT_CAP);

  expect(allowed).toBe(417);
  expect(run(draft, fill(allowed)).ok).toBe(true);
  expect(run(draft, fill(allowed + 1))).toEqual({ ok: false, toast: TOO_LONG });
});

test("a user cap below the floor refuses what the floor would allow", () => {
  const { draft, answer } = pairFor("fix the login bug");
  const tight = parseOptions({ maxGrowthChars: 100 });

  // 17 + min(100, max(400, 201)) = 117 < the 225-char example rewrite.
  expect(run(draft, answer.prompt, tight)).toEqual({
    ok: false,
    toast: TOO_LONG,
  });
});

test("the sentence cap still refuses a long rewrite that fits the allowance", () => {
  const draft = "fix the login bug";
  const five =
    "Fix the login bug. Start from the auth middleware. Add a regression test. Run the suite. Report the root cause.";
  const four =
    "Fix the login bug. Start from the auth middleware. Add a regression test. Report the root cause.";

  // Both fit the 417-char allowance, so only the sentence cap tells them apart.
  expect(five.length).toBeLessThan(growthAllowed(draft.length, DEFAULT_CAP));
  expect(run(draft, five)).toEqual({ ok: false, toast: TOO_LONG });
  expect(run(draft, four).ok).toBe(true);
});

test("every improve example passes the post-call guards against its own draft", () => {
  expect(EXAMPLE_PAIRS.length).toBeGreaterThan(0);
  for (const { draft, answer } of EXAMPLE_PAIRS) {
    expect(answer.verdict).toBe("improve");
    const result = postProcess({
      draft,
      reply: JSON.stringify(answer),
      outputTokens: 50,
      cfg: defaultCfg,
      knownSkills: SKILLS,
      listedSkills: SKILLS,
      descriptions: new Map(),
      documents: "",
    });
    expect({ draft, ok: result.ok }).toEqual({ draft, ok: true });
  }
});

test("EXAMPLES is built from EXAMPLE_PAIRS", () => {
  for (const { draft, answer } of EXAMPLE_PAIRS) {
    expect(EXAMPLES).toContain(
      `<example>\n<draft>${draft}</draft>\n<answer>${JSON.stringify(answer)}</answer>\n</example>`,
    );
  }
});

// The static block is the cache key's biggest part, so the emitted examples
// text must not change by accident (every user's prompt cache would miss).
// This is the literal as v0.3.x shipped it at 927f0b0, captured with
// `git show 927f0b0:hooks/rules.ts`, evaluated with
// `node --experimental-strip-types` and written out unchanged (1995 chars,
// sha256 c774b97c6dc0f4a788d6cafbe40769b19f71329c53bf0c6ef8eaaf9832062b48).
const EXAMPLES_AT_927F0B0 = `<examples>
<example>
<draft>fix the login bug</draft>
<answer>{"verdict":"improve","prompt":"Fix the login bug where the session expires right after sign-in. Start from the auth middleware, add a regression test that reproduces it (per CLAUDE.md's test-first rule), and tell me the root cause before changing anything.","why":"added location, test requirement, and order","applied":["rule 1","rule 3","rule 4"]}</answer>
</example>
<example>
<draft>make it faster</draft>
<answer>{"verdict":"improve","prompt":"Profile the slow path first and tell me where the time goes before optimizing; then make the smallest change that fixes the hotspot and report the before/after numbers.","why":"added profile-first step and success criteria","applied":["rule 1","rule 2"]}</answer>
</example>
<example>
<draft>can you suggest some changes to this function</draft>
<answer>{"verdict":"improve","prompt":"Suggest changes to this function to improve its readability. List them; do not edit the file.","why":"preserved informational intent, made goal explicit","applied":["rule 2"]}</answer>
</example>
<example>
<draft>write a commit</draft>
<answer>{"verdict":"improve","prompt":"Write a conventional commit for the staged changes with the WHY in the body, using the /commit-commands:commit skill.","why":"named the skill that fits","applied":["rule 5"]}</answer>
</example>
<example>
<draft>why is auth/session.ts so slow</draft>
<answer>{"verdict":"improve","prompt":"Why is auth/session.ts slow? Read it and its callers before answering; explain the cause, do not change code yet.","why":"kept informational, added investigation path","applied":["rule 2","rule 4"]}</answer>
</example>
<example>
<draft>yes, go ahead with option B for now</draft>
<answer>{"verdict":"fine"}</answer>
</example>
<example>
<draft>fix the typo in README</draft>
<answer>{"verdict":"improve","prompt":"Fix the typo in README.md.","why":"minimal change, kept restraint","applied":["rule 1"]}</answer>
</example>
</examples>`;

test("EXAMPLES text is byte-identical to the v0.3.x literal", () => {
  expect(EXAMPLES).toBe(EXAMPLES_AT_927F0B0);
});
