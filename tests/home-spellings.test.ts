import { expect, test } from "claude-code/testing";
import type { EngineInterface, On } from "claude-code";
import {
  answered,
  block,
  engine,
  improve,
  press,
  PROJECT_FILE,
  PROJECT_TEXT,
  RULES_TEXT,
  type Engine,
  type EngineOptions,
} from "./engine";
import { parseOptions } from "../hooks/config";
import {
  expandHome,
  isExcluded,
  selectInstructionFiles,
  type MemoryFile,
} from "../hooks/context";
import { homeSpellings, resolveHome } from "../hooks/home";

// R26: the engine reports real paths for the memory files while HOME can be a
// spelling that goes through a symlink (macOS `/tmp` leads to `/private/tmp`).
// HOME is therefore asked for under every spelling, and a match on any one of
// them counts: the rules files stay in, and a `~/…` entry of
// `instructionExclude` keeps matching its file, so an excluded file is never
// sent for want of a matching spelling.

const LINK = "/tmp/u";
const REAL = "/private/tmp/u";
const BOTH = [LINK, REAL];
const RULES_REAL = `${REAL}/.claude/rules/testing.md`;
const RULES_LINK = `${LINK}/.claude/rules/testing.md`;
const GLOBAL_REAL = `${REAL}/CLAUDE.md`;
const GLOBAL_MARK = "GLOBAL-MARK";
const REAL_ROOT = `${REAL}/Desktop/W`;
const TOMB_REAL = `${REAL_ROOT}/Tombstone/CLAUDE.md`;
const REPLY = answered(improve("Fix the flag API in Tombstone please"));

// --- homeSpellings, against a `$` that answers the three nouns it touches ---

type Asked = { path: string; resolve: boolean | undefined };
type Probe = {
  $: EngineInterface;
  asked: Asked[];
  logs: { text: string; to: string | undefined }[];
};

/** `stat` is what `$.fs.stat` answers: a path to land at, nothing, or a throw. */
function probe(
  home: string | undefined,
  stat: { realPath?: string } | Error,
): Probe {
  const asked: Asked[] = [];
  const logs: Probe["logs"] = [];
  const $ = {
    env: { get: async () => home },
    fs: {
      stat: async (path: string, options?: { resolve: boolean }) => {
        asked.push({ path, resolve: options?.resolve });
        if (stat instanceof Error) {
          throw stat;
        }
        return { kind: "dir", size: 0, mtimeMs: 0, isLink: true, ...stat };
      },
    },
    ui: {
      log: (text: string, options?: { to?: string }) => {
        logs.push({ text, to: options?.to });
      },
    },
  } as unknown as EngineInterface;
  return { $, asked, logs };
}

test("homeSpellings is HOME alone when stat answers the same path", async () => {
  const p = probe(LINK, { realPath: LINK });

  expect(await homeSpellings(p.$)).toEqual([LINK]);
  expect(p.asked).toEqual([{ path: LINK, resolve: true }]);
  expect(p.logs).toEqual([]);
});

test("homeSpellings adds the real path when it differs", async () => {
  const p = probe(LINK, { realPath: REAL });

  expect(await homeSpellings(p.$)).toEqual(BOTH);
  expect(p.logs).toEqual([]);
});

test("homeSpellings drops a trailing slash from either spelling", async () => {
  expect(await homeSpellings(probe(LINK, { realPath: `${REAL}/` }).$)).toEqual(
    BOTH,
  );
  // A real path that is HOME but for the slash is no second spelling
  expect(await homeSpellings(probe(LINK, { realPath: `${LINK}/` }).$)).toEqual([
    LINK,
  ]);
  expect(await homeSpellings(probe(`${LINK}/`, { realPath: REAL }).$)).toEqual(
    BOTH,
  );
});

test("homeSpellings falls back to HOME with a debug log when stat rejects", async () => {
  const p = probe(LINK, new Error("ENOENT: no such file"));

  expect(await homeSpellings(p.$)).toEqual([LINK]);
  expect(p.logs).toHaveLength(1);
  expect(p.logs[0]?.to).toBe("debug");
  expect(p.logs[0]?.text).toContain(LINK);
  expect(p.logs[0]?.text).toContain("ENOENT");
});

test("homeSpellings falls back to HOME with a debug log when stat answers no realPath", async () => {
  for (const answer of [{}, { realPath: "" }]) {
    const p = probe(LINK, answer);

    expect(await homeSpellings(p.$)).toEqual([LINK]);
    expect(p.logs).toHaveLength(1);
    expect(p.logs[0]?.to).toBe("debug");
    expect(p.logs[0]?.text).toContain(LINK);
  }
});

test("homeSpellings is empty, and asks nothing, when HOME is unset", async () => {
  for (const home of [undefined, ""]) {
    const p = probe(home, { realPath: REAL });

    expect(await homeSpellings(p.$)).toEqual([]);
    expect(p.asked).toEqual([]);
    expect(p.logs).toEqual([]);
  }
});

test("resolveHome says why HOME is unresolved when stat rejects", async () => {
  const r = await resolveHome(probe(LINK, new Error("ENOENT: no such file")).$);

  expect(r.spellings).toEqual([LINK]);
  expect(r.unresolved).toEqual({
    home: LINK,
    reason: "stat failed: ENOENT: no such file",
  });
});

test("resolveHome says why HOME is unresolved when stat answers no realPath", async () => {
  for (const answer of [{}, { realPath: "" }]) {
    const r = await resolveHome(probe(LINK, answer).$);

    expect(r.spellings).toEqual([LINK]);
    expect(r.unresolved).toEqual({
      home: LINK,
      reason: "the engine reported no real path",
    });
  }
});

test("resolveHome has nothing unresolved when HOME resolves, to itself or elsewhere, or is unset", async () => {
  const same = await resolveHome(probe(LINK, { realPath: LINK }).$);
  const moved = await resolveHome(probe(LINK, { realPath: REAL }).$);
  const unset = await resolveHome(probe(undefined, { realPath: REAL }).$);

  expect(same).toEqual({ spellings: [LINK] });
  expect(moved).toEqual({ spellings: BOTH });
  expect(unset).toEqual({ spellings: [] });
});

// --- selectInstructionFiles ---

const user = (path: string): MemoryFile => ({ path, type: "User", tokens: 10 });
const cfg = parseOptions({});

test("selectInstructionFiles keeps a rules file under either spelling of HOME", () => {
  const files = [user(RULES_REAL), user(RULES_LINK)];

  expect(selectInstructionFiles(files, cfg, BOTH)).toEqual(files);
  expect(selectInstructionFiles(files, cfg, [REAL, LINK])).toEqual(files);
  // The control: HOME's own spelling alone reads the resolved one as foreign
  expect(selectInstructionFiles(files, cfg, [LINK])).toEqual([
    user(RULES_LINK),
  ]);
  expect(selectInstructionFiles(files, cfg, [REAL])).toEqual([
    user(RULES_REAL),
  ]);
});

test("selectInstructionFiles still drops a User file outside the rules directory", () => {
  const files = [
    user(`${REAL}/.claude/CLAUDE.md`),
    user(`${REAL}/.claude/rules-old/a.md`),
    user(`${REAL}/notes/.claude/rules/a.md`),
    user(`${REAL}x/.claude/rules/a.md`),
    user("/other/.claude/rules/a.md"),
  ];

  expect(selectInstructionFiles(files, cfg, BOTH)).toEqual([]);
  expect(selectInstructionFiles([user(RULES_REAL)], cfg, [])).toEqual([]);
});

test("selectInstructionFiles drops a rules file its pattern excludes under the other spelling", () => {
  const files = [user(RULES_REAL), user(`${REAL}/.claude/rules/secret.md`)];
  const excluding = parseOptions({
    instructionExclude: "~/.claude/rules/secret.md",
  });

  expect(selectInstructionFiles(files, excluding, BOTH)).toEqual([files[0]]);
});

// --- expandHome and isExcluded ---

test("expandHome expands a tilde pattern against every spelling", () => {
  expect(expandHome("~/a/b.md", BOTH)).toEqual([
    `${LINK}/a/b.md`,
    `${REAL}/a/b.md`,
  ]);
  expect(expandHome("/abs/b.md", BOTH)).toEqual(["/abs/b.md"]);
  expect(expandHome("rel/b.md", BOTH)).toEqual(["rel/b.md"]);
  expect(expandHome("~/a/b.md", [])).toEqual([]);
});

test("isExcluded matches a tilde pattern to a file reported under the resolved spelling", () => {
  const patterns = ["~/CLAUDE.md", "~/.claude/CLAUDE.md"];

  expect(isExcluded(GLOBAL_REAL, patterns, BOTH)).toBe(true);
  expect(isExcluded(`${LINK}/CLAUDE.md`, patterns, BOTH)).toBe(true);
  expect(isExcluded(`${REAL}/.claude/CLAUDE.md`, patterns, BOTH)).toBe(true);
  // The control: HOME's own spelling alone lets the resolved file through
  expect(isExcluded(GLOBAL_REAL, patterns, [LINK])).toBe(false);
});

test("isExcluded does not over-match an unrelated path", () => {
  const patterns = ["~/CLAUDE.md", "~/Desktop/W/Tombstone/*"];

  expect(isExcluded(`${REAL}/Other/CLAUDE.md`, patterns, BOTH)).toBe(false);
  expect(isExcluded(`${REAL}x/CLAUDE.md`, patterns, BOTH)).toBe(false);
  expect(isExcluded("/private/tmp/CLAUDE.md", patterns, BOTH)).toBe(false);
  expect(isExcluded(`${REAL_ROOT}/Other/CLAUDE.md`, patterns, BOTH)).toBe(
    false,
  );
  expect(isExcluded(GLOBAL_REAL, [], BOTH)).toBe(false);
  // An absolute pattern and a glob need no HOME at all
  expect(isExcluded(GLOBAL_REAL, [GLOBAL_REAL], [])).toBe(true);
  expect(isExcluded(GLOBAL_REAL, ["*/u/CLAUDE.md"], [])).toBe(true);
});

// --- Presses through the engine, with HOME a symlink to the real path ---

/**
 * A stub engine whose HOME is the symlink spelling: `$.fs.stat` of it lands at
 * REAL. The hook goes in before the stub's own default answer, which would
 * take it first (an `on` of the same event runs in registration order).
 */
function linked(
  on: On,
  opts: EngineOptions,
  stat: "lands at REAL" | "is refused" | "names no path" = "lands at REAL",
): { e: Engine; asked: Asked[] } {
  const asked: Asked[] = [];
  on("fs.stat", { path: LINK } as never, ($, e) => {
    asked.push({ path: e.path, resolve: e.resolve });
    if (stat === "is refused") {
      return { deny: "EACCES" };
    }
    const base = { kind: "dir", size: 0, mtimeMs: 0, isLink: true };
    return {
      value: stat === "names no path" ? base : { ...base, realPath: REAL },
    } as never;
  });
  return { e: engine(on, { home: LINK, ...opts }), asked };
}

const MEMORY: MemoryFile[] = [
  { path: PROJECT_FILE, type: "Project", tokens: 100 },
  { path: RULES_REAL, type: "User", tokens: 50 },
  { path: GLOBAL_REAL, type: "Project", tokens: 10 },
];
const FILES = {
  [PROJECT_FILE]: PROJECT_TEXT,
  [RULES_REAL]: RULES_TEXT,
  [GLOBAL_REAL]: GLOBAL_MARK,
};
// The project root is under the real path too, and Tombstone is a subproject
const SUBPROJECT: EngineOptions = {
  root: REAL_ROOT,
  memoryFiles: [],
  files: { [`${REAL_ROOT}/CLAUDE.md`]: PROJECT_TEXT, [TOMB_REAL]: "TOMB-MARK" },
  replies: [REPLY],
};

test("a press with a symlinked HOME sends the rules file and not the excluded global one", async ($, on) => {
  const { e, asked } = linked(on, {
    memoryFiles: MEMORY,
    files: FILES,
    replies: [REPLY],
  });

  await press($, "fix the flag api please");

  expect(asked).toEqual([{ path: LINK, resolve: true }]);
  expect(block(e, 0, 0)).toContain(PROJECT_TEXT);
  expect(block(e, 0, 0)).toContain(RULES_TEXT);
  expect(block(e, 0, 0)).not.toContain(GLOBAL_MARK);
  expect(e.reads).toContain(RULES_REAL);
  expect(e.reads).not.toContain(GLOBAL_REAL);
  expect(e.fills).toHaveLength(1);
});

test(
  "a symlinked HOME keeps an instructionExclude entry matching a subproject file under the real root",
  { options: { instructionExclude: "~/Desktop/W/Tombstone/CLAUDE.md" } },
  async ($, on) => {
    const { e } = linked(on, SUBPROJECT);

    await press($, "fix the flag api in Tombstone please");

    expect(block(e, 0, 1)).not.toContain("TOMB-MARK");
    expect(e.reads).not.toContain(TOMB_REAL);
    expect(e.probes).not.toContain(TOMB_REAL);
    expect(e.logs).toContain(
      `prompt-lift: subproject ${TOMB_REAL} left out by instructionExclude`,
    );
  },
);

test("the same subproject file is read when nothing excludes it", async ($, on) => {
  const { e } = linked(on, SUBPROJECT);

  await press($, "fix the flag api in Tombstone please");

  expect(block(e, 0, 1)).toContain("TOMB-MARK");
  expect(e.reads).toContain(TOMB_REAL);
});

test("status with a symlinked HOME lists the rules file as included and the global one as excluded", async ($, on) => {
  linked(on, { memoryFiles: MEMORY, files: FILES });

  const r = (await press($, "status")) as { text?: string };

  const lines = (r.text ?? "").split("\n");
  const included = lines.find((l) =>
    l.startsWith("instruction files included:"),
  );
  const excluded = lines.find((l) =>
    l.startsWith("instruction files excluded:"),
  );
  expect(included).toContain(RULES_REAL);
  expect(included).toContain(PROJECT_FILE);
  expect(included).not.toContain(GLOBAL_REAL);
  expect(excluded).toContain(GLOBAL_REAL);
  expect(excluded).not.toContain(RULES_REAL);
});

test("a press whose HOME cannot be resolved still runs, on HOME's own spelling, and says why in the debug log", async ($, on) => {
  const { e } = linked(
    on,
    { memoryFiles: MEMORY, files: FILES, replies: [REPLY] },
    "is refused",
  );

  await press($, "fix the flag api please");

  expect(e.fills).toHaveLength(1);
  expect(block(e, 0, 0)).toContain(PROJECT_TEXT);
  expect(e.logs.filter((l) => l.includes("could not resolve"))).toHaveLength(1);
});

// --- status says so when HOME cannot be resolved (spec C6: the starred default
// exclusions ride on HOME; a fallback that stays silent leaves them to miss) ---

/** The `home:` row of a status press, or undefined when it has none. */
async function homeRow(
  $: Parameters<typeof press>[0],
): Promise<string | undefined> {
  const r = (await press($, "status")) as { text?: string };
  return (r.text ?? "").split("\n").find((l) => l.startsWith("home:"));
}

test("status says HOME is unresolved, and why, when the stat is refused", async ($, on) => {
  linked(on, { memoryFiles: MEMORY, files: FILES }, "is refused");

  const row = await homeRow($);

  expect(row).toContain(LINK);
  expect(row).toContain("unresolved");
  expect(row).toContain("stat failed");
  expect(row).toContain("EACCES");
  expect(row).toContain("~/ exclusions");
});

test("status says HOME is unresolved when the stat names no real path", async ($, on) => {
  linked(on, { memoryFiles: MEMORY, files: FILES }, "names no path");

  const row = await homeRow($);

  expect(row).toContain(LINK);
  expect(row).toContain("unresolved");
  expect(row).toContain("the engine reported no real path");
});

test("status has no home row when HOME resolves, through a symlink or not", async ($, on) => {
  linked(on, { memoryFiles: MEMORY, files: FILES });
  expect(await homeRow($)).toBeUndefined();
});

test("status has no home row on the default HOME", async ($, on) => {
  engine(on);
  expect(await homeRow($)).toBeUndefined();
});
