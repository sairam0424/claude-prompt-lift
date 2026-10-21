import { expect, test } from "claude-code/testing";
import type { FoundElement } from "claude-code/testing";
import type { ModelCompleteResult, On } from "claude-code";
import {
  answered,
  engine,
  BEDROCK,
  DRAFT,
  FABLE,
  GOOD,
  SONNET,
  ZERO_USAGE,
} from "./engine";
import {
  detailsOf,
  detailsText,
  headlineText,
  keys,
  mount,
  stripRuns,
} from "./band-helpers";
import { runningRowText } from "../hooks/band-row";

// R25, the working state: while the chain runs, the details are a rung strip
// built from the chain and the rung running now, and the headline counts the
// rungs. Nothing ticks: each rung's `runningModel` write redraws the band, so
// the strip moves exactly when the chain does. The done row then says which
// rung answered and how long the press took, from two reads of the clock.

const RATE_LIMITED: ModelCompleteResult = {
  isAnswered: false,
  reason: "api-error",
  error: "rate_limit",
  status: 429,
  usage: ZERO_USAGE,
};

type Held = {
  /** Resolves once the rung's model call has arrived at the stub. */
  arrived: Promise<void>;
  /** Lets the rung's call go on to its reply. */
  release: () => void;
};

/**
 * Holds the call to one rung until the test lets it go, so every frame of
 * the strip can be read: the engine's own `delay` has one gate for them all.
 * A matched registration on the rung's id, chained to the stub's reply.
 */
function holdRung(on: On, model: string): Held {
  let release: () => void = () => undefined;
  let signal: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    signal = resolve;
  });
  on("model.complete", { model }, async ($, e, next) => {
    signal();
    await gate;
    return next(e);
  });
  return { arrived, release: () => release() };
}

function runsByState(runs: FoundElement[]): {
  struck: string[];
  active: string[];
  pending: string[];
} {
  const struck = runs.filter((r) => r.props.strikethrough === true);
  const active = runs.filter(
    (r) => r.props.bold === true && r.props.color === "warning",
  );
  const pending = runs.filter(
    (r) =>
      r.props.strikethrough !== true &&
      r.props.bold !== true &&
      r.props.dimColor === true,
  );
  return {
    struck: struck.map((r) => r.text),
    active: active.map((r) => r.text),
    pending: pending.map((r) => r.text),
  };
}

test(
  "three rungs: the strip strikes the failed rung, the counter follows, the done row names the answering rung",
  { options: BEDROCK },
  async ($, on) => {
    const fable = holdRung(on, FABLE);
    const sonnet = holdRung(on, SONNET);
    const e = engine(on, { replies: [RATE_LIMITED, answered(GOOD)] });
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "enhance" });
    await fable.arrived;
    await ui.drawn();

    // frame 1: fable runs, nothing has failed yet
    expect(await keys(ui)).toEqual(["cancel"]);
    expect(await headlineText(ui)).toBe("↻ Enhancing 1 of 3");
    expect(await detailsText(ui)).toBe("fable 5.1 › sonnet 5.5 › haiku 5.5");
    expect(runsByState(await stripRuns(ui))).toEqual({
      struck: [],
      active: ["fable 5.1"],
      pending: ["sonnet 5.5", "haiku 5.5"],
    });
    const details = await detailsOf(ui);
    expect(details?.props.dimColor).toBe(true);
    expect(details?.props.wrap).toBe("truncate-end");
    for (const struck of (await stripRuns(ui)).filter(
      (r) => r.props.strikethrough === true,
    )) {
      expect(struck.props.dimColor).toBe(true);
    }

    // frame 2: fable was rate-limited, sonnet runs
    fable.release();
    await sonnet.arrived;
    await ui.drawn();
    expect(await headlineText(ui)).toBe("↻ Enhancing 2 of 3");
    expect(runsByState(await stripRuns(ui))).toEqual({
      struck: ["fable 5.1"],
      active: ["sonnet 5.5"],
      pending: ["haiku 5.5"],
    });
    const struckRun = (await stripRuns(ui))[0];
    expect(struckRun?.props.strikethrough).toBe(true);
    expect(struckRun?.props.dimColor).toBe(true);

    sonnet.release();
    await run;
    await ui.drawn();

    expect(e.calls).toHaveLength(2);
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
    expect(await stripRuns(ui)).toEqual([]);
    expect(e.store.model).toBeUndefined();
  },
);

test(
  "one rung: the counter says 1 of 1 and the strip is that rung alone",
  { options: { models: FABLE } },
  async ($, on) => {
    const e = engine(on, { delay: true });
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "enhance" });
    await e.modelCalled;
    await ui.drawn();

    expect(await headlineText(ui)).toBe("↻ Enhancing 1 of 1");
    expect(await detailsText(ui)).toBe("fable 5.1");
    expect(runsByState(await stripRuns(ui))).toEqual({
      struck: [],
      active: ["fable 5.1"],
      pending: [],
    });

    e.release();
    await run;
  },
);

test(
  "a running rung the chain does not name falls back to the plain running text",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true });
    // A stored alias that matched nothing: the band's read says a rung the
    // resolved chain does not hold
    on("state.get", { plugin: "prompt-lift", key: "runningModel" }, () => ({
      value: { value: "us.anthropic.claude-opus-4-1", version: 0 },
    }));
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "enhance" });
    await e.modelCalled;
    await ui.drawn();

    expect(await headlineText(ui)).toBe("↻ Enhancing");
    expect(await detailsText(ui)).toBe(
      runningRowText("us.anthropic.claude-opus-4-1"),
    );
    expect(await stripRuns(ui)).toEqual([]);

    e.release();
    await run;
  },
);
