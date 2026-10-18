import { expect, test } from "claude-code/testing";
import { engine, press, BEDROCK, FABLE } from "./engine";

// What enhance.ts leans on when it writes `running` over a stale `running`
// (one a hot reload left behind): the kit redraws a drawing on every write of
// a value it read, a write of the same value included. Each band draw reads
// the phase once and a command reads it once (resetStuckPhase), so the reads
// tell a redraw apart from the command that caused it.

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
};

test("a write of the value the band already shows still redraws it", { options: BEDROCK }, async ($, on) => {
  const e = engine(on);
  let phaseReads = 0;
  const modelWrites: unknown[] = [];
  on("state.get", { plugin: "prompt-master", key: "phase" }, ($, ev, next) => {
    phaseReads += 1;
    return next(ev);
  });
  on("state.set", { plugin: "prompt-master", key: "model" }, ($, ev, next) => {
    modelWrites.push(ev.value);
    return next(ev);
  });
  const ui = await $.ui.mount({
    plugin: "prompt-master",
    surface: "terminal",
    component: "AbovePrompt",
    props: PROPS,
  });
  await ui.drawn();
  const drawn = phaseReads;

  // model "" → FABLE: a change; the command's read and a redraw
  await press($, "model reset");
  await ui.drawn();
  expect(phaseReads).toBe(drawn + 2);

  // FABLE → FABLE: the same value; the same two reads, so no dedupe
  await press($, "model reset");
  await ui.drawn();
  expect(phaseReads).toBe(drawn + 4);

  // A command that writes nothing: the command's read alone
  await press($, "");
  await ui.drawn();
  expect(phaseReads).toBe(drawn + 5);

  expect(modelWrites).toEqual([FABLE, FABLE]);
  expect(e.calls).toHaveLength(0);
});
