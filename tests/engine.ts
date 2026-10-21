import { mock } from "claude-code/testing";
import type { Engine as Harness, MockClock } from "claude-code/testing";
import type {
  CommandInfo,
  CommandSource,
  ModelCompleteInput,
  ModelCompleteResult,
  ModelUsage,
  On,
  PromptFillArgs,
  PromptOrigin,
} from "claude-code";
import type { CommandEntry, MemoryFile, SkillEntry } from "../hooks/context";
import { childEntries, pathExists, statOf } from "./engine-fs";

// Shared stub engine for the prompt-lift tests, in the prompt-polish style:
// every noun the mod calls is answered from memory and recorded.

export const DRAFT = "fix the login bug in src/auth.ts please";
export const BETTER =
  "Fix the login bug in src/auth.ts where the session expires after sign-in; add a regression test first.";
export const GOOD = JSON.stringify({
  verdict: "improve",
  prompt: BETTER,
  why: "added symptom and test",
  applied: ["rule 1"],
});

export const HOME = "/Users/u";
export const ROOT = "/Users/u/Desktop/W";
export const PROJECT_FILE = `${ROOT}/CLAUDE.md`;
export const RULES_FILE = `${HOME}/.claude/rules/testing.md`;
export const PROJECT_TEXT = "Project rules: write the regression test first.";
export const RULES_TEXT = "Testing rules: cover the error path.";
export const FABLE = "us.anthropic.claude-fable-5-1";
export const SONNET = "us.anthropic.claude-sonnet-5-5";
export const HAIKU = "us.anthropic.claude-haiku-5-5";
/**
 * The Bedrock chain the mod shipped with before 0.2.0, for the tests that
 * assert full ids or the names `shortModel` gives them. The defaults are now
 * the aliases `fable,sonnet,haiku`; a Bedrock user pins these ids the same
 * way in `pluginConfigs` (README, "Bedrock users").
 */
export const BEDROCK = {
  models: `${FABLE},${SONNET},${HAIKU}`,
  effortModels: `${FABLE},${SONNET}`,
};
export const NOW_MS = Date.UTC(2026, 9, 16, 12, 0, 0);

/**
 * The `YYYY-MM-DD` a Date falls on in this machine's zone, from the Date API
 * rather than a literal: the stats day key is local (R6), so a literal would
 * hold in some zones only.
 */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The stats day key every press in these tests lands on. */
export const TODAY = localDay(new Date(NOW_MS));

export const USAGE: ModelUsage = {
  input_tokens: 1400,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 6800,
  output_tokens: 310,
};

export const ZERO_USAGE: ModelUsage = {
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
};

export function answered(
  text: string,
  usage: ModelUsage = USAGE,
): ModelCompleteResult {
  return { isAnswered: true, text, usage };
}

export type Message = { role: "user" | "assistant"; text: string };

/** A model reply, or a refusal that makes `$.model.complete` reject. */
export type Reply = ModelCompleteResult | { deny: string };

export type FillRefusal = {
  isFilled: false;
  refusal?: "dialog" | "no_composer";
};

export type EngineOptions = {
  replies?: Reply[];
  memoryFiles?: MemoryFile[];
  skills?: SkillEntry[];
  commands?: CommandEntry[];
  files?: Record<string, string>;
  messages?: Message[];
  model?: string;
  root?: string;
  home?: string;
  /** Hold every model reply until the test calls `release()`. */
  delay?: boolean;
  /** Make `prompt.fill` refuse instead of taking the text. */
  fill?: FillRefusal;
  /**
   * Make `prompt.fill` reject: the hook throws for this reason, so the kit
   * skips it and, nothing else answering, the call rejects — the box dropped
   * out from under a press after the model answered.
   */
  denyFill?: string;
  /** Make `session.messages` reject for this reason: enhance's failure path. */
  denyMessages?: string;
  /**
   * Make `store.set` of any key with this prefix reject for this reason: the
   * path where a ledger write fails. A whole key is its own prefix; the day
   * rows carry a writer id the test cannot know, so their prefix is given.
   */
  denyStoreSet?: { key: string; reason: string };
  /** Make `prompt.submit` refuse with this reason instead of taking the text. */
  drop?: string;
  /** Runs once the stub took a submit, before it answers: a person typing on. */
  onSubmit?: (box: { text: string }) => void;
  /** What `session.usage` counts as the skills included and in all. */
  skillCounts?: { included: number; total: number };
  /** What `session.usage` reports as the whole session's cost; absent, none. */
  sessionCostUsd?: number;
};

export type Engine = {
  box: { text: string };
  calls: ModelCompleteInput[];
  toasts: string[];
  logs: string[];
  submits: { text: string; asUser?: true; origin?: PromptOrigin }[];
  fills: PromptFillArgs[];
  store: Record<string, unknown>;
  /** Every path `$.fs.read` was asked for, in order. */
  reads: string[];
  /** Every path `$.fs.exists` probed, in order. */
  probes: string[];
  /** The mocked clock every `$.clock` call reads; `advance` moves it. */
  clock: MockClock;
  /** Resolves once the first model call has arrived at the stub. */
  modelCalled: Promise<void>;
  /** Lets held model replies go (see `delay`). */
  release: () => void;
};

const DEFAULT_MEMORY_FILES: MemoryFile[] = [
  { path: PROJECT_FILE, type: "Project", tokens: 100 },
  { path: RULES_FILE, type: "User", tokens: 50 },
];

const DEFAULT_FILES: Record<string, string> = {
  [PROJECT_FILE]: PROJECT_TEXT,
  [RULES_FILE]: RULES_TEXT,
  [`${ROOT}/src/auth.ts`]: "export const login = () => {};",
};

const DEFAULT_SKILLS: SkillEntry[] = [
  { name: "review", source: "built-in" },
  {
    name: "commit-commands:commit",
    source: "plugin",
    pluginName: "commit-commands",
  },
  { name: "sparc:x", source: "built-in" },
  { name: "mcp-skill", source: "mcp" },
];

const DEFAULT_COMMANDS: CommandEntry[] = [
  {
    name: "review",
    description: "Pre-landing PR review for safety and correctness",
    source: "plugin",
  },
  {
    name: "commit-commands:commit",
    description: "Write conventional commits with the WHY in the body",
    source: "plugin",
  },
  {
    name: "prompt-lift",
    description: "Enhance the prompt from the project instructions and skills",
    source: "plugin",
  },
];

export function engine(on: On, opts: EngineOptions = {}): Engine {
  const box = { text: "" };
  const calls: ModelCompleteInput[] = [];
  const toasts: string[] = [];
  const logs: string[] = [];
  const submits: { text: string; asUser?: true; origin?: PromptOrigin }[] = [];
  const fills: PromptFillArgs[] = [];
  const store: Record<string, unknown> = {};
  const reads: string[] = [];
  const probes: string[] = [];
  const replies = [...(opts.replies ?? [])];
  const files = opts.files ?? DEFAULT_FILES;
  const memoryFiles = opts.memoryFiles ?? DEFAULT_MEMORY_FILES;
  const skills = opts.skills ?? DEFAULT_SKILLS;
  const commands: CommandInfo[] = (opts.commands ?? DEFAULT_COMMANDS).map(
    (c) => ({ ...c, source: c.source as CommandSource }),
  );
  const messages = (opts.messages ?? []).map((m) => ({ ...m, toolUses: [] }));
  const root = opts.root ?? ROOT;
  const home = opts.home ?? HOME;

  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalCalled: () => void = () => undefined;
  const modelCalled = new Promise<void>((resolve) => {
    signalCalled = resolve;
  });

  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId ?? "test-session" }));
  on("classic.SessionStart", () => ({}));
  on("command.register", ($, e) => ({ value: { command: e.name } }));
  on("command.list", () => ({ value: commands }));
  on("prompt.read", () => ({
    value: { text: box.text, cursor: box.text.length },
  }));
  on("prompt.fill", ($, e) => {
    fills.push(e);
    if (opts.denyFill !== undefined) {
      throw new Error(opts.denyFill);
    }
    if (opts.fill) {
      return opts.fill;
    }
    box.text = e.text;
    return { isFilled: true };
  });
  on("prompt.submit", ($, e) => {
    const origin = e.origin as { asUser?: true } | undefined;
    submits.push({ text: e.text, asUser: origin?.asUser, origin: e.origin });
    if (opts.drop !== undefined) {
      return { drop: opts.drop };
    }
    opts.onSubmit?.(box);
    return { text: e.text };
  });
  on("model.complete", async ($, e) => {
    calls.push(e);
    signalCalled();
    if (opts.delay) {
      await gate;
    }
    const reply = replies.shift() ?? answered(GOOD);
    return "deny" in reply ? reply : { value: reply };
  });
  on("session.usage", () => ({
    value: {
      context: {
        breakdown: {
          memoryFiles,
          skills: {
            totalSkills: opts.skillCounts?.total ?? skills.length,
            includedSkills: opts.skillCounts?.included ?? skills.length,
            tokens: 0,
            skillFrontmatter: skills.map((s) => ({ ...s, tokens: 0 })),
          },
        },
      },
      ...(opts.sessionCostUsd === undefined
        ? {}
        : { cost: { usd: opts.sessionCostUsd } }),
    } as never,
  }));
  on("session.messages", () =>
    opts.denyMessages === undefined
      ? { value: messages as never }
      : { deny: opts.denyMessages },
  );
  on("session.model", () => ({ value: opts.model ?? FABLE }));
  on("session.root", () => ({ value: root }));
  on("fs.read", ($, e) => {
    reads.push(e.path);
    const text = files[e.path];
    return text === undefined ? { deny: `missing ${e.path}` } : { value: text };
  });
  on("fs.exists", ($, e) => {
    probes.push(e.path);
    return { value: pathExists(files, e.path) };
  });
  on("fs.list", ($, e) => ({ value: childEntries(files, e.path) }));
  on("fs.stat", ($, e) => ({ value: statOf(e.path, e.resolve) }));
  on("env.get", ($, e) => ({ value: e.name === "HOME" ? home : undefined }));
  on("ui.toast", ($, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.log", ($, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  on(
    "ui.render",
    () => ({ type: "Text", props: {}, children: ["lower"] }) as never,
  );
  on("store.get", ($, e) => ({ value: store[e.key] }));
  on("store.set", ($, e) => {
    const denied = opts.denyStoreSet;
    if (denied !== undefined && e.key.startsWith(denied.key)) {
      return { deny: denied.reason };
    }
    store[e.key] = e.value;
    return { value: undefined };
  });
  on("store.delete", ($, e) => {
    delete store[e.key];
    return { value: undefined };
  });
  on("store.keys", () => ({ value: Object.keys(store) }));
  const clock = mock.clock(on, { now: NOW_MS });

  return {
    box,
    calls,
    toasts,
    logs,
    submits,
    fills,
    store,
    reads,
    probes,
    clock,
    modelCalled,
    release: () => release(),
  };
}

/** `/prompt-lift <args>` through the registered command; the whole result. */
export function press($: Harness, args: string): Promise<unknown> {
  return $.command.run({ command: "prompt-lift", args } as never);
}

/** Prompt block `index` of model call `call`, or "" when there is none. */
export function block(e: Engine, call: number, index: number): string {
  return e.calls[call]?.promptBlocks?.[index]?.text ?? "";
}

/** An `improve` reply that carries `prompt`. */
export function improve(prompt: string): string {
  return JSON.stringify({
    verdict: "improve",
    prompt,
    why: "test",
    applied: [],
  });
}

/**
 * Every write of one prompt-lift state key, in order. The matcher narrows
 * `e` per key literal, so a key held in a variable takes the cast.
 */
export function watch(on: On, key: string): unknown[] {
  const values: unknown[] = [];
  on("state.set", { plugin: "prompt-lift", key } as never, ($, ev, next) => {
    values.push(ev.value);
    return next(ev);
  });
  return values;
}

/** Answers the next read of the phase with `value`, then steps aside. */
export function phaseOnce(on: On, value: string): void {
  let isPending = true;
  on("state.get", { plugin: "prompt-lift", key: "phase" }, ($, ev, next) => {
    if (!isPending) {
      return next(ev);
    }
    isPending = false;
    return { value: { value, version: 0 } };
  });
}
