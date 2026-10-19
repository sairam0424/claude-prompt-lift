import { expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import { capPreviewBlock, PREVIEW_MAX_CHARS } from "../hooks/subcommands";
import {
  block,
  engine,
  press,
  PROJECT_FILE,
  PROJECT_TEXT,
  ROOT,
  RULES_FILE,
  RULES_TEXT,
} from "./engine";

const DYNAMIC_HEADER = "--- dynamic block (sent uncached) ---\n";
const STATIC_LINE = /\n\n--- static block: \d+ chars · hash [0-9a-f]+ ---$/;
const MORE_LINE = /\n… (\d+) more characters \((\d+) total\)/;

/** Every `state.set` of any prompt-lift key, in order, as `key=value`. */
function watchEveryWrite(on: On): string[] {
  const writes: string[] = [];
  on("state.set", { plugin: "prompt-lift" } as never, ($, ev, next) => {
    const { key, value } = ev as unknown as { key: string; value: unknown };
    writes.push(`${key}=${JSON.stringify(value)}`);
    return next(ev);
  });
  return writes;
}

/** Returns a function that makes the next read of the phase say `running`. */
function stickPhaseOnArm(on: On): () => void {
  let isArmed = false;
  on("state.get", { plugin: "prompt-lift", key: "phase" }, ($, ev, next) => {
    if (!isArmed) {
      return next(ev);
    }
    isArmed = false;
    return { value: { value: "running", version: 0 } };
  });
  return () => {
    isArmed = true;
  };
}

/** A project with a subproject CLAUDE.md of 12,000 characters, head to tail. */
function longSubprojectFiles(): Record<string, string> {
  const body = `HEAD-MARK ${"x".repeat(11_980)} TAIL-MARK`;
  return {
    [PROJECT_FILE]: PROJECT_TEXT,
    [RULES_FILE]: RULES_TEXT,
    [`${ROOT}/Tombstone/CLAUDE.md`]: body,
  };
}

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

  // A short block is printed whole: no cut, no `more` line
  expect(result.text!).toContain("<draft>write a commit</draft>");
  expect(result.text!).not.toContain("more characters");

  // No state changes (sessionPresses should still be 0)
  const status = (await $.command.run({
    command: "prompt-lift",
    args: "status",
  } as never)) as { text?: string };
  expect(status.text).toContain("session: 0 presses");
});

test("/prompt-lift preview writes no state beyond what every command's phase reset does", async ($, on) => {
  engine(on, {});
  const writes = watchEveryWrite(on);

  await press($, "status");
  const afterStatus = writes.length;
  await press($, "preview write a commit");

  // Nothing is stuck, so `status` writes nothing and neither does `preview`
  expect(writes.slice(0, afterStatus)).toEqual([]);
  expect(writes.slice(afterStatus)).toEqual([]);
});

test("/prompt-lift preview over a stuck phase writes what status writes, no more", async ($, on) => {
  engine(on, {});
  const writes = watchEveryWrite(on);
  const stickPhase = stickPhaseOnArm(on);

  stickPhase();
  await press($, "status");
  const statusWrites = writes.slice();
  expect(statusWrites).toEqual(['phase="idle"']);

  stickPhase();
  await press($, "preview write a commit");
  expect(writes.slice(statusWrites.length)).toEqual(statusWrites);
});

test("/prompt-lift preview cuts a long dynamic block to 2,000 characters", async ($, on) => {
  const e = engine(on, { files: longSubprojectFiles() });
  const draft = "fix the flag api in Tombstone please";

  // What a press would send as block 1: the counts the trailer must report
  await press($, draft);
  const sent = block(e, 0, 1);
  expect(sent.length).toBeGreaterThan(12_000);
  const callsBefore = e.calls.length;

  const result = (await press($, `preview ${draft}`)) as { text?: string };
  const text = result.text ?? "";

  expect(text.startsWith(DYNAMIC_HEADER)).toBe(true);
  const [shown = "", ...rest] = text
    .slice(DYNAMIC_HEADER.length)
    .split(MORE_LINE);
  expect(shown).toBe(sent.slice(0, PREVIEW_MAX_CHARS));
  const [cut = "", total = "", tail = ""] = rest;
  expect(Number(total)).toBe(sent.length);
  expect(Number(cut)).toBe(sent.length - PREVIEW_MAX_CHARS);
  expect(tail).toMatch(STATIC_LINE);

  // The head is shown, the tail never leaves the mod, no extra call is made
  expect(text).toContain("HEAD-MARK");
  expect(text).not.toContain("TAIL-MARK");
  expect(text.length).toBeLessThan(PREVIEW_MAX_CHARS + 200);
  expect(e.calls).toHaveLength(callsBefore);
});

test("capPreviewBlock keeps a block of 2,000 characters whole and cuts one more", () => {
  const whole = "x".repeat(PREVIEW_MAX_CHARS);
  expect(capPreviewBlock(whole)).toBe(whole);
  expect(capPreviewBlock("")).toBe("");
  expect(capPreviewBlock(`${whole}y`)).toBe(
    `${whole}\n… 1 more characters (2001 total)`,
  );
});

test("capPreviewBlock counts characters, not UTF-16 units", () => {
  const emoji = "\u{1F600}";
  const capped = capPreviewBlock(emoji.repeat(PREVIEW_MAX_CHARS + 5));
  expect(capped).toBe(
    `${emoji.repeat(PREVIEW_MAX_CHARS)}\n… 5 more characters (2005 total)`,
  );
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
