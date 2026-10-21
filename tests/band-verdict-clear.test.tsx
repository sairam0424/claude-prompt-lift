import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import type { On } from "claude-code";
import { engine, press, watch, BETTER, DRAFT, ROOT } from "./engine";
import { headlineText, keys, mount } from "./band-helpers";

// R25, what ends a verdict beyond a press and Enter (tests/band-verdict.test.tsx):
// Send, a /clear or a resume (session.end, classic.SessionStart), and the
// guard that a state failure while clearing costs the row its clearing and
// never a command or the session start.

const GUARD_REASON = "commands and shell lines are sent as typed";
/** A box line the guards refuse before any call: it starts with a slash. */
const COMMAND_LINE = "/clear the screen and start over please";

/** The row after a refusal before any call, from a fresh engine. */
async function refusedRow($: Harness, on: On) {
  const e = engine(on);
  const verdicts = watch(on, "lastVerdict");
  e.box.text = COMMAND_LINE;
  const ui = await mount($);
  await ui.press({ key: "enhance" });
  return { e, verdicts, ui };
}

test("Send is the next action: it clears the verdict a refusal left", async ($, on) => {
  const e = engine(on);
  const verdicts = watch(on, "lastVerdict");
  e.box.text = DRAFT;
  const ui = await mount($);
  await ui.press({ key: "enhance" });
  e.box.text = COMMAND_LINE;
  await ui.press({ key: "enhance" });
  expect(await headlineText(ui)).toBe("✗ Kept as is");
  expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
  // the box shows the enhanced text again, which Send can take
  e.box.text = BETTER;

  await ui.press({ key: "send" });

  expect(e.submits).toHaveLength(1);
  expect(verdicts).toStrictEqual([
    { kind: "refused", text: GUARD_REASON },
    null,
  ]);
  expect(await headlineText(ui)).toBe("↥ Ready");
  expect(await keys(ui)).toEqual(["enhance"]);
});

test("a /clear (session.end with reason clear) clears the verdict", async ($, on) => {
  const { verdicts, ui } = await refusedRow($, on);
  expect(await headlineText(ui)).toBe("✗ Kept as is");

  await $.session.end({ reason: "clear" } as never);

  expect(verdicts).toStrictEqual([
    { kind: "refused", text: GUARD_REASON },
    null,
  ]);
  expect(await headlineText(ui)).toBe("↥ Ready");
});

test("a session.end that is an exit leaves the verdict in the row", async ($, on) => {
  const { verdicts, ui } = await refusedRow($, on);

  await $.session.end({ reason: "prompt_input_exit" } as never);

  expect(verdicts).toHaveLength(1);
  expect(await headlineText(ui)).toBe("✗ Kept as is");
});

test("classic SessionStart for a clear clears the verdict", async ($, on) => {
  const { verdicts, ui } = await refusedRow($, on);
  expect(await headlineText(ui)).toBe("✗ Kept as is");

  await $.classic.SessionStart({ source: "clear" });

  expect(verdicts).toStrictEqual([
    { kind: "refused", text: GUARD_REASON },
    null,
  ]);
  expect(await headlineText(ui)).toBe("↥ Ready");
});

test("classic SessionStart for a startup leaves the verdict in the row", async ($, on) => {
  const { verdicts, ui } = await refusedRow($, on);

  await $.classic.SessionStart({ source: "startup" });

  expect(verdicts).toHaveLength(1);
  expect(await headlineText(ui)).toBe("✗ Kept as is");
});

// A state failure while a verdict is cleared costs the row its clearing,
// never the command or the session start: it is logged for the debug view.

/** An engine whose write of a null `lastVerdict` (the clear) is refused. */
function withFailingClear(on: On) {
  const e = engine(on);
  on(
    "state.set",
    { plugin: "prompt-lift", key: "lastVerdict" } as never,
    (_, ev, next) => (ev.value === null ? { deny: "state gone" } : next(ev)),
  );
  e.box.text = COMMAND_LINE;
  return e;
}

const clearLogs = (logs: string[]): string[] =>
  logs.filter((line) => line.includes("could not clear the verdict"));

test("a /prompt-lift command still answers when clearing the verdict fails", async ($, on) => {
  const e = withFailingClear(on);
  const ui = await mount($);
  await ui.press({ key: "enhance" });
  expect(await headlineText(ui)).toBe("✗ Kept as is");

  const result = await press($, "status");

  expect((result as { text?: string }).text).toContain("prompt-lift status");
  expect(clearLogs(e.logs)).toHaveLength(1);
  expect(clearLogs(e.logs)[0]).toContain("state gone");
  // the clear did not land: the row keeps its reason
  expect(await headlineText(ui)).toBe("✗ Kept as is");
});

test("session.start still completes when clearing the verdict fails", async ($, on) => {
  const e = withFailingClear(on);
  const ui = await mount($);
  await ui.press({ key: "enhance" });

  await $.session.start({
    cwd: ROOT,
    surface: "terminal",
    isInteractive: true,
  } as never);

  expect(clearLogs(e.logs)).toHaveLength(1);
  expect(await headlineText(ui)).toBe("✗ Kept as is");
});
