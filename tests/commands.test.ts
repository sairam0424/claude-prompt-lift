import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import type { ModelCompleteResult } from "claude-code";
import {
  answered,
  engine,
  BETTER,
  DRAFT,
  FABLE,
  HOME,
  PROJECT_FILE,
  RULES_FILE,
  ZERO_USAGE,
} from "./engine";
import { wordDiffLines } from "../hooks/diff";
import { probeText } from "../hooks/commands";
import { statusText, type StatusInput } from "../hooks/status";
import { HINT } from "../hooks/register";

// The sub-words of /prompt-master beyond <text> and undo (spec §5.2, C18):
// model, status, diff and probe. None of them but probe calls a model.

const COMMAND = "prompt-master";
const SONNET = "us.anthropic.claude-sonnet-5-5";
const HAIKU = "us.anthropic.claude-haiku-5-5";
const MEMORY_FILE = `${HOME}/.claude/projects/x/memory/MEMORY.md`;
const NOTHING_TO_UNDO = "prompt-master: nothing to undo";
const RATE_LIMITED: ModelCompleteResult = {
  isAnswered: false,
  reason: "api-error",
  status: 429,
  error: "rate_limit",
  usage: ZERO_USAGE,
};

async function press($: Harness, args: string): Promise<string | undefined> {
  const r = await $.command.run({ command: COMMAND, args } as never);
  return (r as { text?: string }).text;
}

// --- model ---

test("/prompt-master model sonnet changes the first rung and reset restores it", async ($, on) => {
  const e = engine(on);

  const set = await press($, "model sonnet");
  expect(set).toContain("sonnet");
  expect(e.store.model).toBe("sonnet");
  await press($, DRAFT);
  expect(e.calls[0]?.model).toBe("sonnet");

  const reset = await press($, "model reset");
  expect(reset).toContain(FABLE);
  expect(e.store.model).toBeUndefined();
  e.box.text = "";
  await press($, DRAFT);
  expect(e.calls[1]?.model).toBe(FABLE);
});

test("a stored model that is already a rung is not repeated", async ($, on) => {
  const e = engine(on);

  const text = await press($, `model ${SONNET}`);

  expect(text).toBe(
    `prompt-master: first rung ${SONNET} · chain ${SONNET} → ${FABLE} → ${HAIKU}`,
  );
  expect(e.calls).toHaveLength(0);
});

test("/prompt-master model alone names the first rung", async ($, on) => {
  const e = engine(on);

  const text = await press($, "model");

  expect(text).toContain(FABLE);
  expect(text).toContain("model <id|alias|reset>");
  expect(e.store.model).toBeUndefined();
});

// --- status ---

test("/prompt-master status lists chain, last call and skills included", async ($, on) => {
  const e = engine(on, {
    skillCounts: { included: 2, total: 3 },
    memoryFiles: [
      { path: PROJECT_FILE, type: "Project", tokens: 100 },
      { path: RULES_FILE, type: "User", tokens: 50 },
      { path: MEMORY_FILE, type: "AutoMem", tokens: 6000 },
    ],
  });
  await press($, DRAFT);

  const text = await press($, "status");

  expect(text).toContain(`chain: ${FABLE} → ${SONNET} → ${HAIKU}`);
  expect(text).toContain(
    "last call: fable 5.1 · 6.8k cached · 1.4k in · 310 out · $",
  );
  expect(text).toContain("cache hit");
  expect(text).toContain("session: 1 press · $");
  expect(text).toContain("today: 1 press · $");
  expect(text).toContain("skills 2/3");
  expect(text).toContain(
    `included: ${PROJECT_FILE} (100 tokens), ${RULES_FILE} (50 tokens)`,
  );
  expect(text).toContain(`excluded: ${MEMORY_FILE} (6000 tokens)`);
  expect(text).toMatch(/static block: \d+ chars · hash [0-9a-f]+/);
  expect(e.calls).toHaveLength(1);
});

test("status before any press says so and calls no model", async ($, on) => {
  const e = engine(on);

  const text = await press($, "status");

  expect(text).toContain("last call: none yet");
  expect(text).toContain("session: 0 presses · $0.000");
  expect(text).toContain("skills 4/4");
  expect(e.calls).toHaveLength(0);
});

test("statusText lays the lines out", () => {
  const a: StatusInput = {
    chain: [FABLE, SONNET],
    last: {
      model: FABLE,
      input: 1400,
      cached: 6800,
      written: 0,
      output: 310,
      usd: 0.04027,
      attempts: ["fable 5.1: ok"],
      why: "added symptom and test",
      addedWords: 12,
      skills: 1,
      hashChanged: true,
    },
    session: { presses: 2, usd: 0.08 },
    today: { presses: 5, usd: 0.2 },
    staticChars: 5120,
    blockHash: "ab12cd34",
    skills: { included: 2, total: 3 },
    included: [{ path: PROJECT_FILE, type: "Project", tokens: 100 }],
    excluded: [{ path: MEMORY_FILE, type: "AutoMem", tokens: 6000 }],
  };

  expect(statusText(a)).toBe(
    [
      "prompt-master status",
      `chain: ${FABLE} → ${SONNET}`,
      "last call: fable 5.1 · 6.8k cached · 1.4k in · 310 out · $0.04 · cache hit · static block changed",
      "session: 2 presses · $0.08",
      "today: 5 presses · $0.20",
      "static block: 5120 chars · hash ab12cd34",
      "skills 2/3 (included/total)",
      `instruction files included: ${PROJECT_FILE} (100 tokens)`,
      `instruction files excluded: ${MEMORY_FILE} (6000 tokens)`,
    ].join("\n"),
  );
  expect(
    statusText({ ...a, last: null, included: [], excluded: [] }),
  ).toContain("last call: none yet");
  expect(
    statusText({
      ...a,
      last: { ...a.last!, cached: 0, written: 900, hashChanged: false },
    }),
  ).toContain("cache written · static block unchanged");
  expect(
    statusText({ ...a, last: { ...a.last!, cached: 0, written: 0 } }),
  ).toContain("cache miss");
});

// --- diff ---

test("wordDiffLines pairs removed and inserted runs", () => {
  expect(wordDiffLines("fix the bug", "fix the login bug in auth.ts")).toEqual([
    "+ login",
    "+ in auth.ts",
  ]);
  expect(wordDiffLines("a X b", "a Y b")).toEqual(["- X", "+ Y"]);
  expect(wordDiffLines("same words", "same words")).toEqual([]);
  expect(wordDiffLines("", "new")).toEqual(["+ new"]);
});

test("/prompt-master diff prints the word diff", async ($, on) => {
  const e = engine(on);

  expect(await press($, "diff")).toBe("prompt-master: nothing to diff");

  await press($, DRAFT);
  const text = await press($, "diff");

  expect(text).toBe(
    [
      "- fix",
      "+ Fix",
      "- please",
      "+ where the session expires after sign-in; add a regression test first.",
    ].join("\n"),
  );
  expect(e.box.text).toBe(BETTER);
  expect(e.calls).toHaveLength(1);
});

// --- probe ---

test("probeText lists one line per rung", () => {
  expect(
    probeText([
      { model: FABLE, outcome: "ok" },
      { model: SONNET, outcome: "timeout" },
    ]),
  ).toBe(`prompt-master probe\n${FABLE}: ok\n${SONNET}: timeout`);
});

test("/prompt-master probe calls each rung once with 8 tokens and reports", async ($, on) => {
  const e = engine(on, {
    replies: [answered("pong"), RATE_LIMITED, answered("pong")],
  });

  const text = await press($, "probe");

  expect(e.calls.map((c) => c.model)).toEqual([FABLE, SONNET, HAIKU]);
  for (const call of e.calls) {
    expect(call.prompt).toBe("ping");
    expect(call.maxTokens).toBe(8);
    expect(call.promptBlocks).toBeUndefined();
    expect(call.system).toBeUndefined();
    expect(call.effort).toBeUndefined();
  }
  expect(e.calls[0]?.timeoutMs).toBe(30000);
  expect(e.calls[1]?.timeoutMs).toBe(15000);
  expect(e.calls[2]?.timeoutMs).toBe(15000);
  expect(text).toBe(
    `prompt-master probe\n${FABLE}: ok\n${SONNET}: rate_limit\n${HAIKU}: ok`,
  );
  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toHaveLength(0);
});

test("probe reports a rung whose call is refused", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered("pong"),
      { deny: "blocked by policy" },
      answered("pong"),
    ],
  });

  const text = await press($, "probe");

  expect(text).toBe(
    `prompt-master probe\n${FABLE}: ok\n${SONNET}: refused\n${HAIKU}: ok`,
  );
  expect(e.calls).toHaveLength(3);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("blocked by policy");
});

// --- routing ---

test("bare, undo and text still route as before", async ($, on) => {
  const e = engine(on);

  expect(await press($, "")).toBe(HINT);
  expect(await press($, "undo")).toBeUndefined();
  expect(e.toasts).toEqual([NOTHING_TO_UNDO]);
  expect(await press($, DRAFT)).toBeUndefined();
  expect(e.box.text).toBe(BETTER);
  expect(e.calls).toHaveLength(1);
});

test("session.end for a clear or resume forgets the held pair", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);

  await $.session.end({ reason: "clear" } as never);
  await press($, "undo");

  expect(e.toasts[1]).toBe(NOTHING_TO_UNDO);
  expect(e.box.text).toBe(BETTER);
});

test("session.end for an exit keeps the held pair", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);

  await $.session.end({ reason: "prompt_input_exit" } as never);
  await press($, "undo");

  expect(e.box.text).toBe(DRAFT);
});
