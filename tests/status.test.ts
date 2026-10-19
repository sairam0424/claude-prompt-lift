import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import {
  engine,
  BEDROCK,
  DRAFT,
  FABLE,
  HAIKU,
  HOME,
  PROJECT_FILE,
  RULES_FILE,
  SONNET,
} from "./engine";
import { statusText, type StatusInput } from "../hooks/status";
import type { LastUsage } from "../types";

const COMMAND = "prompt-lift";
const MEMORY_FILE = `${HOME}/.claude/projects/x/memory/MEMORY.md`;

async function press($: Harness, args: string): Promise<string | undefined> {
  const r = await $.command.run({ command: COMMAND, args } as never);
  return (r as { text?: string }).text;
}

// --- status ---

test(
  "/prompt-lift status lists chain, last call and skills included",
  { options: BEDROCK },
  async ($, on) => {
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
  },
);

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
    session: { presses: 2, usd: 0.08, unpriced: 0 },
    today: { presses: 5, usd: 0.2, unpriced: 0 },
    caps: {},
    staticChars: 5120,
    blockHash: "ab12cd34",
    skills: { included: 2, total: 3 },
    included: [{ path: PROJECT_FILE, type: "Project", tokens: 100 }],
    excluded: [{ path: MEMORY_FILE, type: "AutoMem", tokens: 6000 }],
    tail: 0,
  };

  expect(statusText(a)).toBe(
    [
      "prompt-lift status",
      `chain: ${FABLE} → ${SONNET}`,
      "last call: fable 5.1 · 6.8k cached · 1.4k in · 310 out · $0.04 · cache hit · static block changed",
      "session: 2 presses · $0.08",
      "today: 5 presses · $0.20",
      "caps: off",
      "conversation: off",
      "static block: 5120 chars · hash ab12cd34",
      "skills 2/3 (included/total)",
      `instruction files included: ${PROJECT_FILE} (100 tokens)`,
      `instruction files excluded: ${MEMORY_FILE} (6000 tokens)`,
    ].join("\n"),
  );
  const call = (patch: Partial<LastUsage>) =>
    statusText({ ...a, last: { ...a.last!, ...patch } });
  expect(
    statusText({ ...a, last: null, included: [], excluded: [] }),
  ).toContain("last call: none yet");
  expect(call({ cached: 0, written: 900, hashChanged: false })).toContain(
    "cache written · static block unchanged",
  );
  expect(call({ cached: 0, written: 0 })).toContain("cache miss");
  // R3: unpriced calls are named only when there were some
  expect(
    statusText({ ...a, session: { ...a.session, unpriced: 3 } }),
  ).toContain(
    "session: 2 presses · $0.08 · unpriced calls: 3\ntoday: 5 presses · $0.20\n",
  );
  expect(call({ usd: null })).toContain(
    "last call: fable 5.1 · 6.8k cached · 1.4k in · 310 out · $? · (no price) · cache hit",
  );
});
