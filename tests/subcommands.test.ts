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
  HOME,
  PROJECT_FILE,
  RULES_FILE,
  SONNET,
  ZERO_USAGE,
} from "./engine";
import { wordDiffLines } from "../hooks/diff";
import { parseModelArg } from "../hooks/subcommands";
import { probeText } from "../hooks/commands";
import { matchRungs } from "../hooks/gather";
import { statusText, type StatusInput } from "../hooks/status";
import type { LastUsage } from "../types";
import { HINT } from "../hooks/register";


const COMMAND = "prompt-lift";
const OPUS = "us.anthropic.claude-opus-4-1";
const MODEL_USAGE = "model <id|alias|reset>";
const MEMORY_FILE = `${HOME}/.claude/projects/x/memory/MEMORY.md`;
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

// --- parseModelArg (Task 10b) ---

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

