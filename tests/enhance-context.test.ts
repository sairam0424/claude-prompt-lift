import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  block,
  improve,
  press,
  DRAFT,
  HOME,
  PROJECT_FILE,
  PROJECT_TEXT,
  ROOT,
  RULES_FILE,
  RULES_TEXT,
} from "./engine";
import { examplePairsFor } from "../hooks/rules";

// Spec §6: what reaches block 0 and block 1 — the selected instruction files,
// the conversation tail only when enabled, a named subproject's CLAUDE.md, and
// the per-file cap.

test("AutoMem and excluded globals never enter block 0", async ($, on) => {
  const globalFile = `${HOME}/.claude/CLAUDE.md`;
  const homeFile = `${HOME}/CLAUDE.md`;
  const autoMem = `${HOME}/.claude/projects/x/memory/MEMORY.md`;
  const e = engine(on, {
    memoryFiles: [
      { path: PROJECT_FILE, type: "Project", tokens: 10 },
      { path: homeFile, type: "Project", tokens: 10 },
      { path: globalFile, type: "User", tokens: 10 },
      { path: RULES_FILE, type: "User", tokens: 10 },
      { path: autoMem, type: "AutoMem", tokens: 10 },
    ],
    files: {
      [PROJECT_FILE]: "PROJECT-MARK",
      [homeFile]: "HOMECLAUDE-MARK",
      [globalFile]: "GLOBAL-MARK",
      [RULES_FILE]: "RULES-MARK",
      [autoMem]: "AUTOMEM-MARK",
    },
  });

  await press($, DRAFT);

  const first = block(e, 0, 0);
  expect(first).toContain("PROJECT-MARK");
  expect(first).toContain("RULES-MARK");
  expect(first).not.toContain("AUTOMEM-MARK");
  expect(first).not.toContain("GLOBAL-MARK");
  expect(first).not.toContain("HOMECLAUDE-MARK");
  expect(first).not.toContain(autoMem);
  expect(first).not.toContain(globalFile);
});

test("conversation tail is absent by default", async ($, on) => {
  const e = engine(on, {
    messages: [
      { role: "user", text: "the login page logs me out" },
      { role: "assistant", text: "The session code lives in src/auth.ts." },
    ],
  });

  await press($, DRAFT);

  expect(e.calls).toHaveLength(1);
  expect(block(e, 0, 1)).not.toContain("<recent_conversation>");
});

test(
  "conversation tail is sent only when enabled",
  { options: { includeConversation: true, conversationMessages: 2 } },
  async ($, on) => {
    const e = engine(on, {
      messages: [
        { role: "user", text: "older message that falls outside the tail" },
        { role: "user", text: "the login page logs me out" },
        { role: "assistant", text: "The session code lives in src/auth.ts." },
      ],
    });

    await press($, DRAFT);

    const second = block(e, 0, 1);
    expect(second).toContain("<recent_conversation>");
    expect(second).toContain("user: the login page logs me out");
    expect(second).toContain(
      "assistant: The session code lives in src/auth.ts.",
    );
    expect(second).not.toContain("older message");
    expect(block(e, 0, 0)).not.toContain("<recent_conversation>");
  },
);

test("a draft naming a subproject adds its CLAUDE.md to the dynamic block", async ($, on) => {
  const draft = "fix the flag api in Tombstone please";
  const e = engine(on, {
    files: {
      [PROJECT_FILE]: PROJECT_TEXT,
      [RULES_FILE]: RULES_TEXT,
      [`${ROOT}/Tombstone/CLAUDE.md`]: "TOMB-MARK",
      [`${ROOT}/Other/CLAUDE.md`]: "OTHER-MARK",
    },
    replies: [
      answered(improve("Fix the flag API in Tombstone please and add a test")),
    ],
  });

  await press($, draft);

  const first = block(e, 0, 0);
  const second = block(e, 0, 1);
  expect(second).toContain("<subproject_instructions>");
  expect(second).toContain("TOMB-MARK");
  expect(second).toContain(`<source>${ROOT}/Tombstone/CLAUDE.md</source>`);
  expect(second).not.toContain("OTHER-MARK");
  expect(first).not.toContain("TOMB-MARK");
  expect(e.fills).toHaveLength(1);
});

test(
  "instruction files are capped at instructionFileMaxChars",
  { options: { instructionFileMaxChars: 50 } },
  async ($, on) => {
    const kept = "A".repeat(50);
    const e = engine(on, {
      files: {
        [PROJECT_FILE]: `${kept}ZZZTAIL`,
        [RULES_FILE]: RULES_TEXT,
      },
    });

    await press($, DRAFT);

    const first = block(e, 0, 0);
    expect(first).toContain(kept);
    expect(first).not.toContain("ZZZTAIL");
  },
);

test(
  "extraRules option changes static block hash and includes the rule",
  { options: { extraRules: "Prefer bun over npm" } },
  async ($, on) => {
    const e = engine(on, { files: { [RULES_FILE]: RULES_TEXT } });
    await press($, DRAFT);

    const first = block(e, 0, 0);
    expect(first).toContain(
      "11. Project preferences from the user: Prefer bun over npm",
    );
    expect(first).toContain("12. Answer with one JSON object");
  },
);

// R16: the "write a commit" example names /commit-commands:commit only when
// the session knows that skill, so the example never teaches an answer the
// guards then refuse ("added a command or link you did not write").

const COMMIT_DRAFT = "write a commit";

function commitPrompt(skills: ReadonlySet<string>): string {
  const pair = examplePairsFor(skills).find((p) => p.draft === COMMIT_DRAFT);
  if (!pair) {
    throw new Error("no built-in example for the draft 'write a commit'");
  }
  return pair.answer.prompt;
}

test("block 0 teaches the commit skill when the session has it", async ($, on) => {
  const e = engine(on);

  await press($, COMMIT_DRAFT);

  const first = block(e, 0, 0);
  expect(first).toContain(commitPrompt(new Set(["commit-commands:commit"])));
  expect(first).toContain("using the /commit-commands:commit skill");
});

test("block 0 shows a plain commit rewrite when the session lacks the skill", async ($, on) => {
  const e = engine(on, { skills: [], commands: [] });

  await press($, COMMIT_DRAFT);

  const first = block(e, 0, 0);
  expect(first).toContain(commitPrompt(new Set()));
  expect(first).not.toContain("/commit-commands:commit");
});

test("the plain commit example is not refused in a session without the skill", async ($, on) => {
  const e = engine(on, {
    skills: [],
    commands: [],
    replies: [answered(improve(commitPrompt(new Set())))],
  });

  await press($, COMMIT_DRAFT);

  expect(e.fills).toHaveLength(1);
  expect(e.toasts.join("\n")).not.toContain("you did not write");
});

test("the skill commit example is refused in a session without the skill", async ($, on) => {
  const skilled = commitPrompt(new Set(["commit-commands:commit"]));
  const e = engine(on, {
    skills: [],
    commands: [],
    replies: [answered(improve(skilled))],
  });

  await press($, COMMIT_DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts.join("\n")).toContain(
    "prompt-lift: added a command or link you did not write, kept your prompt",
  );
});
