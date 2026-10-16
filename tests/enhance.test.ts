import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import {
  answered,
  engine,
  BETTER,
  DRAFT,
  FABLE,
  GOOD,
  HOME,
  PROJECT_FILE,
  PROJECT_TEXT,
  ROOT,
  RULES_FILE,
  RULES_TEXT,
  TODAY,
  USAGE,
  ZERO_USAGE,
  type Engine,
} from "./engine";
import { formatDollars } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import { expectedBoxText, readDraft, type DraftReader } from "../hooks/enhance";
import { SYSTEM } from "../hooks/rules";

const DRAFT_2 = "fix the login bug in src/auth.ts please now";
const COMMAND = "prompt-master";
const SONNET = "us.anthropic.claude-sonnet-5-5";
/** What a Fable press that answers with USAGE costs: on every toast (C19). */
const COST = formatDollars(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));
const FINE = "prompt-master: already specific, left as is";
type Stats = { byDay: Record<string, { presses: number; usd: number }> };

function press($: Harness, args: string): Promise<unknown> {
  return $.command.run({ command: COMMAND, args } as never);
}

function block(e: Engine, call: number, index: number): string {
  return e.calls[call]?.promptBlocks?.[index]?.text ?? "";
}

function improve(prompt: string): string {
  return JSON.stringify({
    verdict: "improve",
    prompt,
    why: "test",
    applied: [],
  });
}

test("Enhance replaces the draft, caches the static block first, and toasts dollars", async ($, on) => {
  const e = engine(on);
  const phases: unknown[] = [];
  on("state.set", { plugin: "prompt-master", key: "phase" }, ($, ev, next) => {
    phases.push(ev.value);
    return next(ev);
  });

  const r = await press($, DRAFT);

  expect((r as { text?: string }).text).toBeUndefined();
  expect(e.box.text).toBe(BETTER);
  expect(e.calls).toHaveLength(1);
  expect(e.calls[0]?.model).toBe(FABLE);
  expect(e.calls[0]?.system).toBe(SYSTEM);
  expect(e.calls[0]?.systemBlocks).toBeUndefined();
  expect(e.calls[0]?.promptBlocks).toHaveLength(2);
  expect(e.calls[0]?.promptBlocks?.[0]?.cache).toBe(true);
  expect(e.calls[0]?.promptBlocks?.[1]?.cache).toBeUndefined();
  expect(block(e, 0, 0).startsWith("<enhancer_rules>")).toBe(true);
  expect(block(e, 0, 0)).toContain(PROJECT_TEXT);
  expect(block(e, 0, 0)).toContain("<project>W</project>");
  expect(block(e, 0, 0)).toContain("commit-commands:commit\nreview\n");
  expect(block(e, 0, 0)).not.toContain(DRAFT);
  expect(block(e, 0, 1)).toContain(`<draft>${DRAFT}</draft>`);
  expect(e.fills).toHaveLength(1);
  expect(e.fills[0]?.mode).toBe("replace");
  expect(e.fills[0]?.decorations?.length ?? 0).toBeGreaterThan(0);
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.startsWith("prompt-master: fable 5.1 ·")).toBe(true);
  expect(e.toasts[0]).toContain("$");
  expect(e.toasts[0]).toContain("added symptom and test");
  expect(e.logs).toHaveLength(0);
  expect(phases).toEqual(["running", "done"]);
});

test("block 0 is identical across two different drafts", async ($, on) => {
  const e = engine(on);

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);

  expect(e.calls).toHaveLength(2);
  expect(block(e, 1, 0)).toBe(block(e, 0, 0));
  expect(block(e, 1, 1)).not.toBe(block(e, 0, 1));
  expect(e.toasts).toHaveLength(2);
  expect(e.toasts[1]).not.toContain("static block changed");
});

test("/prompt-master <text> enhances its args when the box is empty", async ($, on) => {
  const e = engine(on);

  await press($, `  ${DRAFT}  `);

  expect(e.fills).toHaveLength(1);
  expect(e.fills[0]?.text).toBe(BETTER);
  expect(block(e, 0, 1)).toContain(`<draft>${DRAFT}</draft>`);
});

test("a reply-like draft is refused before any model call", async ($, on) => {
  const e = engine(on);

  await press($, "ok do it now");

  expect(e.calls).toHaveLength(0);
  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([
    "prompt-master: that reads like an answer to Claude's question",
  ]);
});

test("command path refuses to fill when the box is no longer empty", async ($, on) => {
  const e = engine(on, { delay: true });

  const run = press($, DRAFT);
  await e.modelCalled;
  e.box.text = "typing";
  e.release();
  await run;

  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("typing");
  expect(e.toasts).toEqual([
    `prompt-master: draft changed while enhancing, left as is · ${COST}`,
  ]);
});

// The button path end to end (`enhance($, cfg, { kind: "box" })`) runs only
// with the mod's own `$`: a test's `$` carries the engine nouns alone (no fs,
// state, store, model), and an inline plugin may not hand its `$` to a function
// of the test file, so the band button (Task 10) drives it through `ui.press`.
// These two pin what the box source does at step 2 (read) and step 7 (re-read).
test("the draft is the prompt box for the button and the args for the command", async () => {
  const reads: string[] = [];
  const reader: DraftReader = {
    prompt: {
      read: async () => {
        reads.push("read");
        return { text: DRAFT, cursor: DRAFT.length };
      },
    },
  };

  expect(await readDraft(reader, { kind: "box" })).toBe(DRAFT);
  expect(reads).toHaveLength(1);
  expect(await readDraft(reader, { kind: "args", text: DRAFT_2 })).toBe(
    DRAFT_2,
  );
  expect(reads).toHaveLength(1);
});

test("the box re-read expects the draft for the button and nothing for the command", () => {
  expect(expectedBoxText({ kind: "box" }, DRAFT)).toBe(DRAFT);
  expect(expectedBoxText({ kind: "args", text: DRAFT }, DRAFT)).toBe("");
});

test("two presses in one tick make one call", async ($, on) => {
  const e = engine(on, { delay: true });

  const both = Promise.all([press($, DRAFT), press($, DRAFT)]);
  await e.modelCalled;
  e.release();
  await both;

  expect(e.calls).toHaveLength(1);
  expect(e.fills).toHaveLength(1);
  expect(e.toasts).toContain("prompt-master: already enhancing");
});

test("a stale reply is dropped", async ($, on) => {
  const e = engine(on, { delay: true });
  let isStale = false;
  on(
    "state.get",
    { plugin: "prompt-master", key: "requestId" },
    ($, ev, next) =>
      isStale ? { value: { value: 999, version: 99 } } : next(ev),
  );

  const run = press($, DRAFT);
  await e.modelCalled;
  isStale = true;
  e.release();
  await run;

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toHaveLength(0);
  expect(e.box.text).toBe("");
});

test("fill refused toasts the refusal", async ($, on) => {
  // Only the engine itself can name a cause (`dialog`, `no_composer`); the
  // site strips one a hook writes, so a stubbed refusal reaches the mod bare.
  const e = engine(on, { fill: { isFilled: false, refusal: "dialog" } });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(1);
  expect(e.box.text).toBe("");
  expect(e.toasts).toEqual([
    `prompt-master: the prompt box did not take the text (refused) · ${COST}`,
  ]);
});

test("model failure leaves the draft and names the attempts", async ($, on) => {
  const e = engine(on, {
    replies: [
      {
        isAnswered: false,
        reason: "api-error",
        status: 429,
        error: "rate_limit",
        usage: ZERO_USAGE,
      },
      { isAnswered: false, reason: "empty-reply", usage: ZERO_USAGE },
      { isAnswered: false, reason: "aborted", usage: ZERO_USAGE },
    ],
  });

  await press($, DRAFT);

  expect(e.calls).toHaveLength(3);
  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("");
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]).toContain("fable 5.1: rate_limit");
  expect(e.toasts[0]).toContain("sonnet 5.5: no text (possible refusal)");
  expect(e.toasts[0]).toContain("haiku 5.5: timeout");
  expect(e.toasts[0]?.endsWith(` · ${formatDollars(0)}`)).toBe(true);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("rate_limit");
  expect((e.store.stats as Stats).byDay[TODAY]).toEqual({ presses: 1, usd: 0 });
});

test("a chain that fails after a paid rung records the spend", async ($, on) => {
  const e = engine(on, {
    replies: [
      { isAnswered: false, reason: "empty-reply", usage: USAGE },
      {
        isAnswered: false,
        reason: "api-error",
        status: 429,
        error: "rate_limit",
        usage: ZERO_USAGE,
      },
      { isAnswered: false, reason: "aborted", usage: ZERO_USAGE },
    ],
  });
  const presses: unknown[] = [];
  on(
    "state.set",
    { plugin: "prompt-master", key: "sessionPresses" },
    ($, ev, next) => {
      presses.push(ev.value);
      return next(ev);
    },
  );

  await press($, DRAFT);

  const usd = estimateUsd(USAGE, FABLE, DEFAULT_PRICES);
  const day = (e.store.stats as Stats).byDay[TODAY];
  expect(day?.presses).toBe(1);
  expect(Math.abs((day?.usd ?? 0) - usd)).toBeLessThan(1e-9);
  expect(presses).toEqual([1]);
  expect(e.toasts[0]?.startsWith("prompt-master: no model answered ·")).toBe(
    true,
  );
  expect(e.toasts[0]?.endsWith(` · ${COST}`)).toBe(true);
});

test("a fine verdict toasts and does not fill", async ($, on) => {
  const e = engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([`${FINE} · ${COST}`]);
});

test("a fine verdict is paid for: stats, session totals and status say so", async ($, on) => {
  const e = engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
  });
  const presses: unknown[] = [];
  on(
    "state.set",
    { plugin: "prompt-master", key: "sessionPresses" },
    ($, ev, next) => {
      presses.push(ev.value);
      return next(ev);
    },
  );

  await press($, DRAFT);
  const status = ((await press($, "status")) as { text: string }).text;

  const day = (e.store.stats as Stats).byDay[TODAY];
  expect(day?.presses).toBe(1);
  expect(day?.usd ?? 0).toBeGreaterThan(0);
  expect(presses).toEqual([1]);
  expect(status).toContain(`session: 1 press · ${COST}`);
  expect(status).toContain(`today: 1 press · ${COST}`);
  expect(status).toContain(
    `last call: fable 5.1 · 6.8k cached · 1.4k in · 310 out · ${COST}`,
  );
  expect(status).toMatch(/static block: [1-9]\d* chars · hash [0-9a-f]+/);
});

test("status shows the last call, not the last success", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(GOOD),
      {
        isAnswered: false,
        reason: "api-error",
        status: 429,
        error: "rate_limit",
        usage: ZERO_USAGE,
      },
      answered(JSON.stringify({ verdict: "fine" })),
    ],
  });

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);
  const status = ((await press($, "status")) as { text: string }).text;

  expect(e.calls.map((c) => c.model)).toEqual([FABLE, FABLE, SONNET]);
  expect(e.fills).toHaveLength(1);
  expect(status).toContain("last call: sonnet 5.5 ·");
  expect(status).toContain("session: 2 presses · ");
  expect(e.toasts[1]).toBe(
    `${FINE} · ${formatDollars(estimateUsd(USAGE, SONNET, DEFAULT_PRICES))}`,
  );
});

test("a fine verdict after a success keeps the phase at done", async ($, on) => {
  const e = engine(on, {
    replies: [answered(GOOD), answered(JSON.stringify({ verdict: "fine" }))],
  });
  const phases: unknown[] = [];
  on("state.set", { plugin: "prompt-master", key: "phase" }, ($, ev, next) => {
    phases.push(ev.value);
    return next(ev);
  });

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);

  expect(e.fills).toHaveLength(1);
  expect(e.toasts[1]).toBe(`${FINE} · ${COST}`);
  expect(phases).toEqual(["running", "done", "running", "done"]);
});

test("a refused first press settles the phase back to idle", async ($, on) => {
  const e = engine(on);
  const phases: unknown[] = [];
  on("state.set", { plugin: "prompt-master", key: "phase" }, ($, ev, next) => {
    phases.push(ev.value);
    return next(ev);
  });

  await press($, "ok do it now");

  expect(e.calls).toHaveLength(0);
  expect(phases).toEqual(["running", "idle"]);
});

test("plain prose reply is filled", async ($, on) => {
  const e = engine(on, { replies: [answered(BETTER)] });

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(e.toasts[0]?.startsWith("prompt-master: fable 5.1 ·")).toBe(true);
});

test("a capped reply leaves the box untouched", async ($, on) => {
  const e = engine(on, {
    replies: [answered(GOOD, { ...USAGE, output_tokens: 2000 })],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("");
  expect(e.toasts).toEqual([
    `prompt-master: reply hit the token cap, kept your prompt · ${formatDollars(
      estimateUsd({ ...USAGE, output_tokens: 2000 }, FABLE, DEFAULT_PRICES),
    )}`,
  ]);
});

test("an invented path is refused", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(
        improve("Fix the login bug in src/auth.ts and in src/nope.ts please"),
      ),
    ],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([
    `prompt-master: named a file that does not exist, kept your prompt · ${COST}`,
  ]);
});

test("a path that exists in the project passes the path guard", async ($, on) => {
  const e = engine(on, {
    files: {
      [PROJECT_FILE]: PROJECT_TEXT,
      [RULES_FILE]: RULES_TEXT,
      [`${ROOT}/src/session.ts`]: "export const session = 1;",
    },
    replies: [
      answered(
        improve("Fix the login bug in src/auth.ts and src/session.ts please"),
      ),
    ],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(1);
  expect(e.box.text).toContain("src/session.ts");
});

test("prose with a slash such as CI/CD is not checked as a path", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(
        improve(
          "Fix the CI/CD pipeline and the and/or logic for the login flow please",
        ),
      ),
    ],
  });

  await press($, "fix the ci pipeline for the login flow please");

  expect(e.fills).toHaveLength(1);
  expect(e.box.text).toContain("CI/CD");
  expect(e.toasts[0]?.startsWith("prompt-master: fable 5.1 ·")).toBe(true);
});

test("a path under a root directory that does not exist is refused", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(improve("Fix the login bug in src/auth.ts and src/session please")),
    ],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts[0]).toContain(
    "prompt-master: named a file that does not exist, kept your prompt",
  );
});

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

test("stats accumulate presses and dollars by day", async ($, on) => {
  const e = engine(on);
  const presses: unknown[] = [];
  on(
    "state.set",
    { plugin: "prompt-master", key: "sessionPresses" },
    ($, ev, next) => {
      presses.push(ev.value);
      return next(ev);
    },
  );

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);

  const usd = estimateUsd(USAGE, FABLE, DEFAULT_PRICES);
  const stats = e.store.stats as {
    byDay: Record<string, { presses: number; usd: number }>;
  };
  expect(stats.byDay[TODAY]?.presses).toBe(2);
  expect(Math.abs((stats.byDay[TODAY]?.usd ?? 0) - 2 * usd)).toBeLessThan(1e-9);
  expect(usd).toBeGreaterThan(0);
  expect(presses).toEqual([1, 2]);
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
