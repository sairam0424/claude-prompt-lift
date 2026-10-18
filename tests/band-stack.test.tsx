import { test, expect } from "claude-code/testing";
import { engine } from "./engine";

// The engine draws one band above the prompt for every mod; prompt-master
// stacks its row above whatever the hooks beneath draw. A blank row between
// the two keeps them readable as separate things.

const PLUGIN = "prompt-master";
const SURFACE = "terminal" as const;
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10 };

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
