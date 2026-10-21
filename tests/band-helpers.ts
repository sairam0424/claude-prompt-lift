import type {
  Engine as Harness,
  FoundElement,
  Mounted,
} from "claude-code/testing";

// The band tests' shared scaffolding: the mount and the selectors that read
// the row as drawn. The headline is the bold Text, the details the dim one;
// the running state's rung strip nests Text runs inside the details Text, so
// the selectors take the OUTER node (first in document order) and never join
// the runs into it.

export const PLUGIN = "prompt-lift";
export const SURFACE = "terminal" as const;
export const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
};
export type Props = typeof PROPS;
export type Band = Mounted<typeof SURFACE, "AbovePrompt">;

export function mount($: Harness, extra: Partial<Props> = {}): Promise<Band> {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: SURFACE,
    component: "AbovePrompt",
    props: { ...PROPS, ...extra },
  });
}

/** The engine's redraw with the band `bodyColumns` wide. */
export function widen(ui: Band, bodyColumns: number): Promise<void> {
  return ui.redraw({ ...PROPS, bodyColumns });
}

/** The row's Texts in document order, the drawing beneath left out. */
export async function rowTexts(ui: Band): Promise<FoundElement[]> {
  return (await ui.findAll({ type: "Text" })).filter((t) => t.text !== "lower");
}

/**
 * The headline: the first bold Text; undefined when the row draws none. The
 * strip's active rung is bold too, but it comes after the details node.
 */
export async function headlineOf(ui: Band): Promise<FoundElement | undefined> {
  return (await rowTexts(ui)).find((t) => t.props.bold === true);
}

/** The headline's text, or undefined when the row draws none. */
export async function headlineText(ui: Band): Promise<string | undefined> {
  return (await headlineOf(ui))?.text;
}

/** The details: the outer dim Text, the one with `wrap`; its nested runs are not it. */
export async function detailsOf(ui: Band): Promise<FoundElement | undefined> {
  return (await rowTexts(ui)).find((t) => t.props.dimColor === true);
}

/** The details' text alone; "" when the row draws none. */
export async function detailsText(ui: Band): Promise<string> {
  return (await detailsOf(ui))?.text ?? "";
}

/**
 * The rung strip's runs: the Texts nested in the details node, in chain
 * order; empty when the details carry plain text.
 */
export async function stripRuns(ui: Band): Promise<FoundElement[]> {
  const texts = await rowTexts(ui);
  const details = texts.findIndex((t) => t.props.dimColor === true);
  return details === -1 ? [] : texts.slice(details + 1);
}

export async function keys(ui: Band): Promise<(string | undefined)[]> {
  return (await ui.findAll({ type: "Button" })).map((b) => b.key);
}

export async function label(ui: Band, key: string): Promise<unknown> {
  return (await ui.find({ type: "Button", key }))?.props.label;
}

export async function variantOf(ui: Band, key: string): Promise<unknown> {
  return (await ui.find({ type: "Button", key }))?.props.variant;
}
