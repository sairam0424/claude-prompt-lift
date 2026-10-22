import { expect, test } from "claude-code/testing";
import type { EngineInterface } from "claude-code";
import * as api from "../hooks/api";
import {
  ask,
  cmds,
  epochMs,
  fillBox,
  fsHas,
  fsList,
  fsRead,
  fsStat,
  getHome,
  history,
  kvDel,
  kvGet,
  kvKeys,
  kvSet,
  log,
  notify,
  readBox,
  redraw,
  rootDir,
  sessMod,
  submit,
  surface,
  usageOf,
} from "../hooks/api";

// R29: hooks/api.ts is the one place the mod calls the engine's `$.<noun>.<fn>`,
// through one short forwarding wrapper per API, so the validator's `calls` line
// lists each API once with one short `via` label. A wrapper only forwards, and
// these tests pin that: it calls exactly the intended engine method, hands over
// the arguments (options objects included) as given, and returns, or rejects
// with, whatever the engine did. They run against a recording `$`, not the kit
// stub, so a wrapper that reached for a sibling method, reordered or dropped an
// argument, or wrapped its answer shows here and nowhere else.

type Call = { method: string; args: readonly unknown[] };

type Recorder = {
  $: EngineInterface;
  calls: Call[];
  /** The one value each method answers with, by `noun.fn`. */
  answers: Record<string, unknown>;
};

const PATH = "/Users/u/Desktop/W/CLAUDE.md";
const KEY = "prompt-lift.model";
const STAT_OPTIONS = { resolve: true } as const;
const LOG_OPTIONS = { to: "debug" } as const;
const TOAST_OPTIONS = { timeoutMs: 2500 } as const;
const REQUEST = { model: "haiku", prompt: "improve this" } as const;
const MODEL_OPTIONS = { signal: new AbortController().signal } as const;
const FILL = { text: "better", mode: "replace" } as const;
const SUBMIT = { text: "go", asUser: true } as const;
const USAGE_ARGS = { breakdown: "summary" } as const;
const RENDER_INPUT = { surface: "terminal", component: "AbovePrompt" } as const;

type Row = {
  /** The wrapper's name in hooks/api.ts. */
  wrapper: string;
  /** The engine method it must reach, `noun.fn`. */
  method: string;
  /** The arguments after `$`, handed to the wrapper as given. */
  args: readonly unknown[];
  /** What the engine must receive: `args`, unless the wrapper fixes one. */
  reaches: readonly unknown[];
  /** Calls the wrapper on a `$` with exactly `args`. */
  run: ($: EngineInterface) => unknown;
};

function row<const A extends readonly unknown[]>(
  wrapper: string,
  method: string,
  args: A,
  call: ($: EngineInterface, args: A) => unknown,
  reaches: readonly unknown[] = args,
): Row {
  return { wrapper, method, args, reaches, run: ($) => call($, args) };
}

// Every wrapper once, and a second row where an optional argument can be
// left out: the arguments after `$` must reach the engine as given, none added.
const ROWS: readonly Row[] = [
  row("epochMs", "clock.now", [], ($) => epochMs($)),
  row("cmds", "command.list", [], ($) => cmds($)),
  // The engine reads a module's variables off a literal name, so this one
  // fixes HOME itself and takes nothing: the engine must still get ["HOME"]
  row("getHome", "env.get", [], ($) => getHome($), ["HOME"]),
  row("fsHas", "fs.exists", [PATH], ($, a) => fsHas($, ...a)),
  row("fsList", "fs.list", [PATH], ($, a) => fsList($, ...a)),
  row("fsList", "fs.list", [], ($) => fsList($)),
  row("fsRead", "fs.read", [PATH], ($, a) => fsRead($, ...a)),
  row("fsStat", "fs.stat", [PATH, STAT_OPTIONS], ($, a) => fsStat($, ...a)),
  row("fsStat", "fs.stat", [PATH], ($, a) => fsStat($, ...a)),
  row("ask", "model.complete", [REQUEST, MODEL_OPTIONS], ($, a) =>
    ask($, ...a),
  ),
  row("ask", "model.complete", [REQUEST], ($, a) => ask($, ...a)),
  row("fillBox", "prompt.fill", [FILL], ($, a) => fillBox($, ...a)),
  row("readBox", "prompt.read", [], ($) => readBox($)),
  row("submit", "prompt.submit", [SUBMIT], ($, a) => submit($, ...a)),
  row("history", "session.messages", [], ($) => history($)),
  row("sessMod", "session.model", [], ($) => sessMod($)),
  row("rootDir", "session.root", [], ($) => rootDir($)),
  row("usageOf", "session.usage", [USAGE_ARGS], ($, a) => usageOf($, ...a)),
  row("usageOf", "session.usage", [], ($) => usageOf($)),
  row("kvGet", "store.get", [KEY], ($, a) => kvGet($, ...a)),
  row("kvSet", "store.set", [KEY, { id: "sonnet" }], ($, a) => kvSet($, ...a)),
  row("kvDel", "store.delete", [KEY], ($, a) => kvDel($, ...a)),
  row("kvKeys", "store.keys", [], ($) => kvKeys($)),
  row("redraw", "ui.invalidate", ["ui.render"], ($, a) => redraw($, ...a)),
  row("log", "ui.log", ["prompt-lift: a line", LOG_OPTIONS], ($, a) =>
    log($, ...a),
  ),
  row("log", "ui.log", ["prompt-lift: a line"], ($, a) => log($, ...a)),
  row("notify", "ui.toast", ["prompt-lift: done", TOAST_OPTIONS], ($, a) =>
    notify($, ...a),
  ),
  row("notify", "ui.toast", ["prompt-lift: done"], ($, a) => notify($, ...a)),
  row("surface", "ui.resolve", [RENDER_INPUT], ($, a) => surface($, ...a)),
];

/** The engine methods the table reaches, each once. */
const METHODS: readonly string[] = [...new Set(ROWS.map((r) => r.method))];

/**
 * A `$` with every method of the table, each recording its call and answering
 * its own value, so a wrapper that reaches a sibling method is seen to.
 */
function recorder(
  behave: (method: string, answer: unknown) => unknown = (_, answer) => answer,
): Recorder {
  const calls: Call[] = [];
  const answers: Record<string, unknown> = {};
  const nouns: Record<
    string,
    Record<string, (...args: unknown[]) => unknown>
  > = {};
  for (const method of METHODS) {
    const [noun = "", fn = ""] = method.split(".");
    answers[method] = { answerOf: method };
    nouns[noun] = {
      ...nouns[noun],
      [fn]: (...args: unknown[]) => {
        calls.push({ method, args });
        return behave(method, answers[method]);
      },
    };
  }
  return { $: nouns as unknown as EngineInterface, calls, answers };
}

for (const r of ROWS) {
  const label = `${r.wrapper}(${r.args.length} args) -> $.${r.method}`;

  test(`${label} calls that method alone, with the arguments as given`, () => {
    const rec = recorder();
    r.run(rec.$);
    expect(rec.calls.map((c) => c.method)).toEqual([r.method]);
    const forwarded = rec.calls[0]?.args ?? [];
    // Same count (none added, none dropped) and the same objects, in order
    expect(forwarded).toHaveLength(r.reaches.length);
    r.reaches.forEach((arg, i) => expect(forwarded[i]).toBe(arg));
  });

  test(`${label} returns the engine's own answer untouched`, () => {
    const rec = recorder();
    expect(r.run(rec.$)).toBe(rec.answers[r.method]);
  });
}

test("an async wrapper hands back the engine's promise, and its rejection with it", async () => {
  const rec = recorder((method, answer) =>
    method === "store.set"
      ? Promise.reject(new Error("store is read-only"))
      : answer,
  );
  const pending = kvSet(rec.$, KEY, "v");
  await expect(pending).rejects.toThrow("store is read-only");
  expect(rec.calls.map((c) => c.method)).toEqual(["store.set"]);

  const resolved = recorder((method) =>
    method === "fs.read" ? Promise.resolve("file text") : undefined,
  );
  await expect(fsRead(resolved.$, PATH)).resolves.toBe("file text");
});

test("a method that throws throws through its wrapper", () => {
  const rec = recorder((method, answer) => {
    if (method === "ui.toast") {
      throw new Error("no surface to draw on");
    }
    return answer;
  });
  expect(() => notify(rec.$, "prompt-lift: x")).toThrow(
    "no surface to draw on",
  );
});

test("a wrapper calls its method on the noun, so the engine keeps its `this`", () => {
  const seen: unknown[] = [];
  const store = {
    get(this: unknown, key: string) {
      seen.push(this);
      return Promise.resolve(key);
    },
  };
  const $ = { store } as unknown as EngineInterface;
  void kvGet($, KEY);
  expect(seen).toEqual([store]);
  expect(seen[0]).toBe(store);
});

test("the table covers every wrapper hooks/api.ts exports, and no other", () => {
  const exported = Object.keys(api).sort();
  const tabled = [...new Set(ROWS.map((r) => r.wrapper))].sort();
  expect(exported).toEqual(tabled);
});

// The validator prints `via <name>` for every function that reaches an API
// directly; a long wrapper name pushes the `calls` line back over its cap.
test("every wrapper name stays short enough to keep the label short", () => {
  for (const name of Object.keys(api)) {
    expect(name.length).toBeLessThanOrEqual(7);
  }
});
