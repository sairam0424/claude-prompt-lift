import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import { engine } from "./engine";
import { parseModelArg, parseTailArg } from "../hooks/subcommands";

const COMMAND = "prompt-lift";

async function press($: Harness, args: string): Promise<string | undefined> {
  const r = await $.command.run({ command: COMMAND, args } as never);
  return (r as { text?: string }).text;
}

// --- parseModelArg ---

test("parseModelArg classifies reset, aliases, ids, junk and prose", () => {
  expect(parseModelArg("model reset")).toEqual({ kind: "reset" });
  expect(parseModelArg("model sonnet")).toEqual({
    kind: "set",
    model: "sonnet",
  });
  expect(parseModelArg("model us.anthropic.claude-haiku-5-5")).toEqual({
    kind: "set",
    model: "us.anthropic.claude-haiku-5-5",
  });
  expect(parseModelArg("model the")).toEqual({ kind: "set", model: "the" });
  expect(parseModelArg("model the auth flow as a state machine")).toEqual({
    kind: "not-a-model-command",
  });
  expect(parseModelArg("model")).toEqual({
    kind: "invalid",
    reason: "prompt-lift: usage: /prompt-lift model <id|alias|reset>",
  });
  expect(parseModelArg("model bad id!")).toEqual({
    kind: "not-a-model-command",
  });
  expect(parseModelArg('model "x"')).toEqual({
    kind: "invalid",
    reason: 'prompt-lift: ""x"" is not a model id or alias',
  });
  expect(parseModelArg("fix the model loader")).toEqual({
    kind: "not-a-model-command",
  });
});

// --- /prompt-lift model with prose is a draft, not a model command ---

test("/prompt-lift model with prose enhances instead of storing a model", async ($, on) => {
  const e = engine(on);

  await press($, "model the auth flow as a state machine");

  expect(e.calls).toHaveLength(1);
  expect(e.calls[0]?.prompt).toContain(
    "model the auth flow as a state machine",
  );
  expect(e.store.model).toBeUndefined();
});

test("/prompt-lift model with an invalid token answers the reason and writes nothing", async ($, on) => {
  const e = engine(on);

  const text = await press($, 'model "x"');

  expect(text).toBe('prompt-lift: "\"x\"" is not a model id or alias');
  expect(e.store.model).toBeUndefined();
  expect(e.calls).toHaveLength(0);
});


// --- parseTailArg: a count is plain digits, like parseCapArg's plain decimals ---

test("parseTailArg takes on, off, a plain count 1-50, and nothing else", () => {
  expect(parseTailArg("tail")).toEqual({ kind: "show" });
  expect(parseTailArg("TAIL On")).toEqual({ kind: "on" });
  expect(parseTailArg("tail off")).toEqual({ kind: "off" });
  expect(parseTailArg("tail 6")).toEqual({ kind: "set", count: 6 });
  expect(parseTailArg("tail 06")).toEqual({ kind: "set", count: 6 });
  expect(parseTailArg("tail 50")).toEqual({ kind: "set", count: 50 });
  expect(parseTailArg("tail 1")).toEqual({ kind: "set", count: 1 });
  expect(parseTailArg("tail the auth flow")).toEqual({ kind: "prose" });
  expect(parseTailArg("fix the tail")).toEqual({ kind: "prose" });
});

test("parseTailArg refuses every number spelling but plain digits", () => {
  const refused = [
    "0x6",
    "1e1",
    "6.0",
    "+6",
    "-6",
    "6.",
    ".6",
    "0",
    "51",
    "99999999999999999999",
    "six",
    "6a",
  ];
  for (const word of refused) {
    expect({ word, parsed: parseTailArg(`tail ${word}`) }).toEqual({
      word,
      parsed: { kind: "invalid" },
    });
  }
});
