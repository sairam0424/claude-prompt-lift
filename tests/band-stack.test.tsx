import { test, expect } from "claude-code/testing";
import { engine } from "./engine";

// The engine draws one band above the prompt for every mod; prompt-lift
// stacks its row above whatever the hooks beneath draw. A blank row between
// the two keeps them readable as separate things.

const PLUGIN = "prompt-lift";
const SURFACE = "terminal" as const;
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
};

test("the band keeps one blank row above the drawing beneath", async ($, on) => {
  engine(on, {});
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: SURFACE,
    component: "AbovePrompt",
    props: PROPS,
  });
  const column = await ui.find({ type: "Box" });
  expect(column?.props.flexDirection).toBe("column");
  expect(column?.props.rowGap).toBe(1);
  // the drawing beneath (the stub's "lower") is still there, under the gap
  const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text);
  expect(texts).toContain("lower");
});
