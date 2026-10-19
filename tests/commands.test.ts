import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import type { ModelCompleteResult } from "claude-code";
import {
  answered,
  engine,
  BETTER,
  DRAFT,
  BEDROCK,
  FABLE,
  HAIKU,
  SONNET,
  ZERO_USAGE,
} from "./engine";
import { wordDiffLines } from "../hooks/diff";
import { probeText } from "../hooks/commands";
import { matchRungs } from "../hooks/gather";
import { HINT } from "../hooks/register";

// The sub-words of /prompt-lift beyond <text> and undo (spec §5.2, C18):
// model, status, diff and probe. None of them but probe calls a model.

const COMMAND = "prompt-lift";
const OPUS = "us.anthropic.claude-opus-4-1";
const MODEL_USAGE = "model <id|alias|reset>";
const NOTHING_TO_UNDO = "prompt-lift: nothing to undo";
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

function improve(prompt: string): string {
  return JSON.stringify({ verdict: "improve", prompt, why: "", applied: [] });
}

// --- model ---

test(
  "/prompt-lift model sonnet changes the first rung and reset restores it",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const set = await press($, "model sonnet");
    expect(set).toBe(
      `prompt-lift: first rung ${SONNET} · chain ${SONNET} → ${FABLE} → ${HAIKU}`,
    );
    expect(e.store.model).toBe(SONNET);
    await press($, DRAFT);
    expect(e.calls[0]?.model).toBe(SONNET);
    expect(e.calls[0]?.effort).toBe("low");
    expect(e.toasts[0]).toContain("prompt-lift: sonnet 5.5");
    expect(e.toasts[0]).toContain("$0.007");

    const reset = await press($, "model reset");
    expect(reset).toBe(
      `prompt-lift: first rung ${FABLE} · chain ${FABLE} → ${SONNET} → ${HAIKU}`,
    );
    expect(e.store.model).toBeUndefined();
    e.box.text = "";
    await press($, DRAFT);
    expect(e.calls[1]?.model).toBe(FABLE);
  },
);

test(
  "model Haiku names its rung whatever the case",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const text = await press($, "model Haiku");

    expect(text).toBe(
      `prompt-lift: first rung ${HAIKU} · chain ${HAIKU} → ${FABLE} → ${SONNET}`,
    );
    expect(e.store.model).toBe(HAIKU);
  },
);

test(
  "model with a word no rung carries stores nothing and says so",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const text = await press($, "model sonet");

    expect(text).toBe(
      `prompt-lift: sonet is neither a rung of ${FABLE} → ${SONNET} → ${HAIKU} nor a full model id · use /prompt-lift ${MODEL_USAGE}`,
    );
    expect(e.store.model).toBeUndefined();
    await press($, DRAFT);
    expect(e.calls[0]?.model).toBe(FABLE);
  },
);

test(
  "model with a word several rungs carry stores nothing",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const text = await press($, "model claude");

    expect(text).toBe(
      `prompt-lift: claude names several rungs (${FABLE}, ${SONNET}, ${HAIKU}) · use /prompt-lift ${MODEL_USAGE}`,
    );
    expect(e.store.model).toBeUndefined();
    expect(e.calls).toHaveLength(0);
  },
);

test(
  "model with a full id outside the chain pins it as given",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const text = await press($, `model ${OPUS}`);

    expect(text).toBe(
      `prompt-lift: first rung ${OPUS} · chain ${OPUS} → ${FABLE} → ${SONNET} → ${HAIKU}`,
    );
    expect(e.store.model).toBe(OPUS);
    await press($, DRAFT);
    expect(e.calls[0]?.model).toBe(OPUS);
  },
);

test(
  "an alias left in the store leads the chain as the rung it names",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.store.model = "haiku";

    await press($, DRAFT);

    expect(e.calls[0]?.model).toBe(HAIKU);
    expect(e.toasts[0]).toContain("prompt-lift: haiku 5.5");
  },
);

test("matchRungs takes the id spelled in full, else every id containing the word", () => {
  const ids = [FABLE, SONNET, HAIKU];

  expect(matchRungs("sonnet", ids)).toEqual([SONNET]);
  expect(matchRungs("HAIKU", ids)).toEqual([HAIKU]);
  expect(matchRungs(SONNET.toUpperCase(), ids)).toEqual([SONNET]);
  expect(matchRungs("5-5", ids)).toEqual([SONNET, HAIKU]);
  expect(matchRungs("opus", ids)).toEqual([]);
  expect(
    matchRungs("claude-sonnet-4-5", [
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-5",
    ]),
  ).toEqual(["claude-sonnet-4-5"]);
});

test(
  "a stored model that is already a rung is not repeated",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const text = await press($, `model ${SONNET}`);

    expect(text).toBe(
      `prompt-lift: first rung ${SONNET} · chain ${SONNET} → ${FABLE} → ${HAIKU}`,
    );
    expect(e.calls).toHaveLength(0);
  },
);

test(
  "/prompt-lift model alone names the first rung",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const text = await press($, "model");

    expect(text).toContain(FABLE);
    expect(text).toContain("model <id|alias|reset>");
    expect(e.store.model).toBeUndefined();
  },
);




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

test("/prompt-lift diff prints the word diff", async ($, on) => {
  const e = engine(on);

  expect(await press($, "diff")).toBe("prompt-lift: nothing to diff");

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
  ).toBe(`prompt-lift probe\n${FABLE}: ok\n${SONNET}: timeout`);
});

test(
  "/prompt-lift probe calls each rung once with 8 tokens and reports",
  { options: BEDROCK },
  async ($, on) => {
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
      `prompt-lift probe\n${FABLE}: ok\n${SONNET}: rate_limit\n${HAIKU}: ok`,
    );
    expect(e.fills).toHaveLength(0);
    expect(e.toasts).toHaveLength(0);
  },
);

test(
  "probe reports a rung whose call is refused",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, {
      replies: [
        answered("pong"),
        { deny: "blocked by policy" },
        answered("pong"),
      ],
    });

    const text = await press($, "probe");

    expect(text).toBe(
      `prompt-lift probe\n${FABLE}: ok\n${SONNET}: refused\n${HAIKU}: ok`,
    );
    expect(e.calls).toHaveLength(3);
    expect(e.logs).toHaveLength(1);
    expect(e.logs[0]).toContain("blocked by policy");
  },
);

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

test(
  "a draft that merely starts with a sub-word is enhanced",
  { options: BEDROCK },
  async ($, on) => {
    const drafts = [
      "undo the last migration",
      "status of the nightly build",
      "diff the two configs and explain",
      "probe the API for rate limits",
    ];
    const e = engine(on, {
      replies: drafts.map((d) => answered(improve(`${d} carefully`))),
    });

    for (const draft of drafts) {
      e.box.text = "";
      expect(await press($, draft)).toBeUndefined();
      expect(e.box.text).toBe(`${draft} carefully`);
    }

    expect(e.calls).toHaveLength(4);
    for (const call of e.calls) {
      expect(call.promptBlocks).toHaveLength(2);
      expect(call.maxTokens).toBe(2000);
    }
    expect(e.toasts).not.toContain(NOTHING_TO_UNDO);
    expect(
      e.toasts.every((t) => t.startsWith("prompt-lift: fable 5.1 ·")),
    ).toBe(true);
  },
);

test("sub-words match whatever the case and spacing", async ($, on) => {
  const e = engine(on);

  expect(await press($, "  Undo ")).toBeUndefined();
  expect(e.toasts).toEqual([NOTHING_TO_UNDO]);
  expect(await press($, "STATUS")).toContain("prompt-lift status");
  expect(await press($, "Diff")).toBe("prompt-lift: nothing to diff");
  expect(e.calls).toHaveLength(0);
});
