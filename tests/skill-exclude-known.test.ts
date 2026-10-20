import { expect, test } from "claude-code/testing";
import { knownSkillSet } from "../hooks/context";
import { examplePairsFor } from "../hooks/rules";
import { answered, block, engine, improve, press } from "./engine";

// R20: one notion of a known skill. A skill the user left out with
// `skillExclude` is unknown to the guards and to the few-shot example alike.
// Before R20 the example renderer and `riskyAdditions` still saw the command
// the session listed, so a copy of the skill example passed the risky-token
// check and `stripUnknownSkills` then garbled it to "the commit-commands:commit
// skill".

const COMMIT = "commit-commands:commit";
const COMMIT_DRAFT = "write a commit";
const REFUSED =
  "prompt-lift: added a command or link you did not write, kept your prompt";

const COMMIT_COMMAND = { name: COMMIT, description: "d", source: "plugin" };

function commitPrompt(skills: ReadonlySet<string>): string {
  const pair = examplePairsFor(skills).find((p) => p.draft === COMMIT_DRAFT);
  if (!pair) {
    throw new Error("no built-in example for the draft 'write a commit'");
  }
  return pair.answer.prompt;
}

test("knownSkillSet drops a name that matches a skillExclude pattern", () => {
  const ctx = { skillNames: [], commands: [COMMIT_COMMAND] };

  expect(knownSkillSet(ctx, ["commit-commands:*"]).has(COMMIT)).toBe(false);
  expect(knownSkillSet(ctx, [COMMIT]).has(COMMIT)).toBe(false);
  expect(knownSkillSet(ctx, []).has(COMMIT)).toBe(true);
});

test("knownSkillSet keeps every name no pattern matches, skill or command", () => {
  const ctx = {
    skillNames: ["review", "sparc:x"],
    commands: [COMMIT_COMMAND, { name: "help", description: "d", source: "x" }],
  };

  expect([...knownSkillSet(ctx, ["sparc:*", "commit-*"])].sort()).toEqual([
    "help",
    "review",
  ]);
});

test(
  "an excluded skill gets the fallback example and a copy of the skill one is refused",
  { options: { skillExclude: "commit-commands:*" } },
  async ($, on) => {
    const skilled = commitPrompt(new Set([COMMIT]));
    const e = engine(on, { replies: [answered(improve(skilled))] });

    await press($, COMMIT_DRAFT);

    expect(e.fills.map((fill) => fill.text)).toEqual([]);
    expect(e.box.text).toBe("");
    expect(e.toasts.join("\n")).toContain(REFUSED);
    const first = block(e, 0, 0);
    expect(first).toContain(commitPrompt(new Set()));
    expect(first).not.toContain(`/${COMMIT}`);
  },
);

test("without the exclusion the skill example is taught and a copy of it is kept intact", async ($, on) => {
  const skilled = commitPrompt(new Set([COMMIT]));
  const e = engine(on, { replies: [answered(improve(skilled))] });

  await press($, COMMIT_DRAFT);

  const first = block(e, 0, 0);
  expect(first).toContain(skilled);
  expect(first).toContain(`using the /${COMMIT} skill`);
  expect(e.fills).toHaveLength(1);
  expect(e.fills[0]?.text).toBe(skilled);
  expect(e.toasts.join("\n")).not.toContain("you did not write");
});
