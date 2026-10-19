import { expect, test } from "claude-code/testing";
import { HINT, register } from "../hooks/register";
import { engine, ROOT, ZERO_USAGE } from "./engine";

test("bare /prompt-lift answers the hint and calls no model", async ($, on) => {
  const calls: unknown[] = [];
  on("command.register", ($, e) => ({ value: { command: e.name } }));
  on("model.complete", ($, e) => {
    calls.push(e);
    return {
      value: { isAnswered: false, reason: "empty-reply", usage: ZERO_USAGE },
    };
  });
  const r = await $.command.run({
    command: "prompt-lift",
    args: "",
  } as never);
  expect((r as { text?: string }).text).toBe(HINT);
  expect(calls).toHaveLength(0);
});

test(
  "session.start logs prices issue when invalid JSON is provided",
  { options: { prices: "{invalid}" } },
  async ($, on) => {
    const e = engine(on);

    // Manually trigger session.start
    await $.session.start({
      cwd: ROOT,
      surface: "terminal",
      isInteractive: true,
    } as never);

    // The pricesIssue should have been logged via $.ui.log during session.start
    expect(e.logs.length).toBeGreaterThan(0);
    expect(e.logs[0]).toBe(
      "prompt-lift: prices option ignored: invalid JSON",
    );
  },
);

test("the slash menu hint lists every sub-word, tail and preview included", async ($, on) => {
  const hints: (string | undefined)[] = [];
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("command.register", ($, e) => {
    hints.push(e.argumentHint);
    return { value: { command: e.name } };
  });

  await $.session.start({
    cwd: ROOT,
    surface: "terminal",
    isInteractive: true,
  } as never);

  expect(hints).toHaveLength(1);
  const hint = hints[0] ?? "";
  for (const word of [
    "undo",
    "model <id>",
    "cap <usd|off>",
    "tail <on|off|N>",
    "preview <draft>",
    "status",
    "diff",
    "probe",
  ]) {
    expect(hint).toContain(word);
  }
});
