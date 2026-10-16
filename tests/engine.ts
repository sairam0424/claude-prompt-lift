import { mock } from "claude-code/testing";
import type {
  CommandInfo,
  CommandSource,
  FsEntry,
  ModelCompleteInput,
  ModelCompleteResult,
  ModelUsage,
  On,
  PromptFillArgs,
} from "claude-code";
import type { CommandEntry, MemoryFile, SkillEntry } from "../hooks/context";

// Shared stub engine for the prompt-master tests, in the prompt-polish style:
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
export const NOW_MS = Date.UTC(2026, 9, 16, 12, 0, 0);
export const TODAY = "2026-10-16";

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

export type FillRefusal = {
  isFilled: false;
  refusal?: "dialog" | "no_composer";
};

export type EngineOptions = {
  replies?: ModelCompleteResult[];
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
};

export type Engine = {
  box: { text: string };
  calls: ModelCompleteInput[];
  toasts: string[];
  logs: string[];
  submits: { text: string }[];
  fills: PromptFillArgs[];
  store: Record<string, unknown>;
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
    name: "prompt-master",
    description: "Enhance the prompt from the project instructions and skills",
    source: "plugin",
  },
];

function childEntries(files: Record<string, string>, dir: string): FsEntry[] {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  const seen = new Map<string, FsEntry>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : rest.slice(0, slash);
    const kind = slash === -1 ? "file" : "dir";
    if (!seen.has(name)) {
      seen.set(name, { name, kind, size: 0, mtimeMs: 0, isLink: false });
    }
  }
  return [...seen.values()];
}

function pathExists(files: Record<string, string>, path: string): boolean {
  return (
    path in files || Object.keys(files).some((p) => p.startsWith(`${path}/`))
  );
}

export function engine(on: On, opts: EngineOptions = {}): Engine {
  const box = { text: "" };
  const calls: ModelCompleteInput[] = [];
  const toasts: string[] = [];
  const logs: string[] = [];
  const submits: { text: string }[] = [];
  const fills: PromptFillArgs[] = [];
  const store: Record<string, unknown> = {};
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

  on("command.register", ($, e) => ({ value: { command: e.name } }));
  on("command.list", () => ({ value: commands }));
  on("prompt.read", () => ({
    value: { text: box.text, cursor: box.text.length },
  }));
  on("prompt.fill", ($, e) => {
    fills.push(e);
    if (opts.fill) {
      return opts.fill;
    }
    box.text = e.text;
    return { isFilled: true };
  });
  on("prompt.submit", ($, e) => {
    submits.push({ text: e.text });
    return { text: e.text };
  });
  on("model.complete", async ($, e) => {
    calls.push(e);
    signalCalled();
    if (opts.delay) {
      await gate;
    }
    return { value: replies.shift() ?? answered(GOOD) };
  });
  on("session.usage", () => ({
    value: {
      context: {
        breakdown: {
          memoryFiles,
          skills: {
            totalSkills: skills.length,
            includedSkills: skills.length,
            tokens: 0,
            skillFrontmatter: skills.map((s) => ({ ...s, tokens: 0 })),
          },
        },
      },
    } as never,
  }));
  on("session.messages", () => ({ value: messages as never }));
  on("session.model", () => ({ value: opts.model ?? FABLE }));
  on("session.root", () => ({ value: root }));
  on("fs.read", ($, e) => {
    const text = files[e.path];
    return text === undefined ? { deny: `missing ${e.path}` } : { value: text };
  });
  on("fs.exists", ($, e) => ({ value: pathExists(files, e.path) }));
  on("fs.list", ($, e) => ({ value: childEntries(files, e.path) }));
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
    store[e.key] = e.value;
    return { value: undefined };
  });
  mock.clock(on, { now: NOW_MS });

  return {
    box,
    calls,
    toasts,
    logs,
    submits,
    fills,
    store,
    modelCalled,
    release: () => release(),
  };
}
