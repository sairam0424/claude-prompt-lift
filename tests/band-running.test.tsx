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
  HAIKU,
  SONNET,
  USAGE,
  ZERO_USAGE,
} from "./engine";
import {
  detailsOf,
  detailsText,
  headlineText,
  keys,
  mount,
  stripRuns,
  type Band,
} from "./band-helpers";
import { runningRowText } from "../hooks/band-row";
import { costText } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";

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
/** What the three-rung press costs: fable's refusal carried no tokens. */
const SONNET_COST = costText(estimateUsd(USAGE, SONNET, DEFAULT_PRICES));
/** A reply the guards read as "already specific": the press ends without a fill. */
const FINE = answered(JSON.stringify({ verdict: "fine" }));
/**
 * Full ids `shortModel` leaves whole, as a chain pinned to older models has
 * them: three of them joined are wider than the band at any tier.
 */
const OPUS = "us.anthropic.claude-opus-4-1-20250805-v1:0";
const LONG_CHAIN = [
  OPUS,
  "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "us.anthropic.claude-3-5-haiku-20241022-v1:0",
];

type Held = {
  /** Resolves once the rung's model call has arrived at the stub. */
  arrived: Promise<void>;
  /** Lets the rung's call go on to its reply. */
  release: () => void;
};

/**
 * The gate every hold shares. The held call awaits `hold()`, which says it
 * has arrived and then parks until the test calls `release()`; the test reads
 * `arrived` and `release` and never sees `hold`.
 */
function held(): Held & { hold: () => Promise<void> } {
  let release: () => void = () => undefined;
  let signal: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    signal = resolve;
  });
  return {
    arrived,
    release: () => release(),
    hold: () => {
      signal();
      return gate;
    },
  };
}

/**
 * Holds the call to one rung until the test lets it go, so every frame of
 * the strip can be read: the engine's own `delay` has one gate for them all.
 * A matched registration on the rung's id, chained to the stub's reply.
 */
function holdRung(on: On, model: string): Held {
  const { hold, ...rung } = held();
  on("model.complete", { model }, async ($, e, next) => {
    await hold();
    return next(e);
  });
  return rung;
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

    // 2.3 s pass before sonnet answers: the press is timed by two clock reads
    await e.clock.advance(2300);
    sonnet.release();
    await run;
    await ui.drawn();

    expect(e.calls).toHaveLength(2);
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
    expect(SONNET_COST).toMatch(/^\$0\.0\d\d?$/);
    expect(await headlineText(ui)).toBe(`✓ Enhanced ${SONNET_COST}`);
    const done = await detailsText(ui);
    expect(
      done.startsWith(
        "sonnet 5.5 · 2 of 3 · 2.3s · 6.8k cached · 1.4k in · 310 out · +",
      ),
    ).toBe(true);
    expect(done).toMatch(/ · \+\d+ words? · \d+ skills?$/);
    expect(await stripRuns(ui)).toEqual([]);
    expect(e.store.model).toBeUndefined();
  },
);

test(
  "three holds: frame 3 counts 3 of 3 with two struck rungs and the last active",
  { options: BEDROCK },
  async ($, on) => {
    const fable = holdRung(on, FABLE);
    const sonnet = holdRung(on, SONNET);
    const haiku = holdRung(on, HAIKU);
    const e = engine(on, {
      replies: [RATE_LIMITED, RATE_LIMITED, answered(GOOD)],
    });
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "enhance" });
    await fable.arrived;
    fable.release();
    await sonnet.arrived;
    sonnet.release();
    await haiku.arrived;
    await ui.drawn();

    expect(await headlineText(ui)).toBe("↻ Enhancing 3 of 3");
    expect(runsByState(await stripRuns(ui))).toEqual({
      struck: ["fable 5.1", "sonnet 5.5"],
      active: ["haiku 5.5"],
      pending: [],
    });

    haiku.release();
    await run;

    expect(e.calls).toHaveLength(3);
    expect(await headlineText(ui)).toMatch(/^✓ Enhanced \$/);
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

    // the clock did not move: the press took 0.0s
    expect(await detailsText(ui)).toContain("fable 5.1 · 1 of 1 · 0.0s · ");
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

/** Holds the first write of one state key until the test lets it land. */
function holdWrite(on: On, key: string): Held {
  const { hold, ...write } = held();
  let isFirst = true;
  on(
    "state.set",
    { plugin: "prompt-lift", key } as never,
    async ($, ev, next) => {
      if (isFirst) {
        isFirst = false;
        await hold();
      }
      return next(ev);
    },
  );
  return write;
}

test(
  "right after the press, before the first rung's write, the row draws the chain's first rung",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true });
    const first = holdWrite(on, "runningModel");
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "enhance" });
    await first.arrived;
    await ui.drawn();

    // phase is running, runningModel still "": the strip and counter are drawn
    expect(await keys(ui)).toEqual(["cancel"]);
    expect(await headlineText(ui)).toBe("↻ Enhancing 1 of 3");
    expect(await detailsText(ui)).toBe("fable 5.1 › sonnet 5.5 › haiku 5.5");
    expect(runsByState(await stripRuns(ui))).toEqual({
      struck: [],
      active: ["fable 5.1"],
      pending: ["sonnet 5.5", "haiku 5.5"],
    });

    first.release();
    e.release();
    await run;
  },
);

test(
  "a press that ends without a fill settles its verdict and phase before it clears the rung",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { replies: [RATE_LIMITED, FINE] });
    // The frame on screen just before each of settle's three writes lands
    const frames: string[] = [];
    let ui: Band | undefined;
    const isSettling = (key: string, value: unknown): boolean =>
      (key === "lastVerdict" && value !== null) ||
      (key === "phase" && value === "idle") ||
      (key === "runningModel" && value === "");
    for (const key of ["phase", "runningModel", "lastVerdict"]) {
      on(
        "state.set",
        { plugin: "prompt-lift", key } as never,
        async (_, ev, next) => {
          if (ui !== undefined && isSettling(key, ev.value)) {
            await ui.drawn();
            frames.push(`${await headlineText(ui)} | ${key}`);
          }
          return next(ev);
        },
      );
    }
    e.box.text = DRAFT;
    ui = await mount($);

    await ui.press({ key: "enhance" });

    expect(e.calls).toHaveLength(2);
    // The chain ended on rung 2. Until the verdict and the phase have landed
    // the row stays on "2 of 3"; the rung is cleared last, under the settled
    // row, so no frame draws rung 1 or an "Enhancing" with no strip.
    expect(frames).toEqual([
      "↻ Enhancing 2 of 3 | lastVerdict",
      "↻ Enhancing 2 of 3 | phase",
      "✗ Kept as is | runningModel",
    ]);
    expect(await headlineText(ui)).toBe("✗ Kept as is");
  },
);

test(
  "rungs too long to fit beside the headline and Cancel collapse to the active rung",
  { options: { models: LONG_CHAIN.join(",") } },
  async ($, on) => {
    const e = engine(on, { delay: true });
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "enhance" });
    await e.modelCalled;
    await ui.drawn();

    // 120 columns is the full tier, yet three full ids do not fit: only the
    // active rung is drawn, and the counter still counts all three
    expect(await headlineText(ui)).toBe("↻ Enhancing 1 of 3");
    expect(await detailsText(ui)).toBe(OPUS);
    expect(runsByState(await stripRuns(ui))).toEqual({
      struck: [],
      active: [OPUS],
      pending: [],
    });

    e.release();
    await run;
  },
);
