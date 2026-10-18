import { expect, test } from "claude-code/testing";
import { HINT, register } from "../hooks/register";
import { engine, ROOT } from "./engine";

test("bare /prompt-master answers the hint and calls no model", async ($, on) => {
  const calls: unknown[] = [];
  on("command.register", ($, e) => ({ value: { command: e.name } }));
  on("model.complete", ($, e) => {
    calls.push(e);
    return { value: { isAnswered: false, reason: "empty-reply" } };
  });
  const r = await $.command.run({
    command: "prompt-master",
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
      "prompt-master: prices option ignored: invalid JSON",
    );
  },
);
