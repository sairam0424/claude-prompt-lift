import { expect, test } from "claude-code/testing";
import { parseOptions } from "../hooks/config";
import { engine } from "./engine";

const cfg = parseOptions({});

test("/prompt-lift preview <draft> shows dynamic and static block with no model call", async ($, on) => {
  const e = engine(on, {});

  const result = (await $.command.run({
    command: "prompt-lift",
    args: "preview write a commit",
  } as never)) as { text?: string };

  expect(result.text).toBeDefined();
  expect(result.text!).toContain("--- dynamic block (sent uncached) ---");
  expect(result.text!).toContain("--- static block:");
  expect(result.text!).toContain("chars · hash");
  expect(result.text!).toContain("write a commit");

  // No model calls
  expect(e.calls.length).toBe(0);

  // No fills
  expect(e.fills.length).toBe(0);

  // No state changes (sessionPresses should still be 0)
  const status = (await $.command.run({
    command: "prompt-lift",
    args: "status",
  } as never)) as { text?: string };
  expect(status.text).toContain("session: 0 presses");
});

test("/prompt-lift preview refuses reply-like drafts", async ($, on) => {
  const e = engine(on, {
    messages: [
      {
        role: "assistant",
        text: "Should I proceed with option A or option B?",
      },
    ],
  });

  const result = (await $.command.run({
    command: "prompt-lift",
    args: "preview yes go ahead",
  } as never)) as { text?: string };

  expect(result.text).toBeDefined();
  expect(result.text!).toContain("reads like an answer to Claude's question");

  // No model calls
  expect(e.calls.length).toBe(0);
});

test("/prompt-lift preview alone shows usage", async ($, on) => {
  const e = engine(on, {});

  const result = (await $.command.run({
    command: "prompt-lift",
    args: "preview",
  } as never)) as { text?: string };

  expect(result.text).toBeDefined();
  expect(result.text!).toContain("prompt-lift: preview takes a draft");
  expect(result.text!).toContain("e.g. /prompt-lift preview write a commit");

  // No model calls
  expect(e.calls.length).toBe(0);
});
