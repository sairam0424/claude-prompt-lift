import { expect, test } from "claude-code/testing";
import type { EngineInterface } from "claude-code";
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

// A HOME of `/` (root in a container). Joined to a child path the root must
// read as the empty string, or the rules prefix is `//.claude/rules/` and
// `~/CLAUDE.md` expands to `//CLAUDE.md`, which no real path matches. Unset
// HOME stays `[]`, a different answer from the root's `[""]`.

const ROOT_RULES = "/.claude/rules/testing.md";
const ROOT_GLOBAL = "/CLAUDE.md";
const GLOBAL_MARK = "GLOBAL-MARK";
const LINKED_ROOT = "/mnt/root";
const REPLY = answered(improve("Fix the flag API in Tombstone please"));

// --- homeSpellings and resolveHome, against a `$` that answers what they touch ---

type Probe = {
  $: EngineInterface;
  asked: string[];
  logs: string[];
};

/** `stat` is what `$.fs.stat` answers: a path to land at, nothing, or a throw. */
function probe(
  home: string | undefined,
  stat: { realPath?: string } | Error,
): Probe {
  const asked: string[] = [];
  const logs: string[] = [];
  const $ = {
    env: { get: async () => home },
    fs: {
      stat: async (path: string) => {
        asked.push(path);
        if (stat instanceof Error) {
          throw stat;
        }
        return { kind: "dir", size: 0, mtimeMs: 0, isLink: true, ...stat };
      },
    },
    ui: {
      log: (text: string) => {
        logs.push(text);
      },
    },
  } as unknown as EngineInterface;
  return { $, asked, logs };
}

test("homeSpellings spells a HOME of / as the empty string, and stats /", async () => {
  const p = probe("/", { realPath: "/" });

  expect(await homeSpellings(p.$)).toEqual([""]);
  expect(p.asked).toEqual(["/"]);
  expect(p.logs).toEqual([]);
});

test("homeSpellings spells every all-slash HOME as the empty string", async () => {
  for (const home of ["//", "///"]) {
    expect(await homeSpellings(probe(home, { realPath: "/" }).$)).toEqual([""]);
  }
});

test("homeSpellings keeps a HOME that leads to / as two spellings", async () => {
  expect(await homeSpellings(probe(LINKED_ROOT, { realPath: "/" }).$)).toEqual([
    LINKED_ROOT,
    "",
  ]);
  expect(
    await homeSpellings(probe("/", { realPath: "/private/root" }).$),
  ).toEqual(["", "/private/root"]);
});

test('homeSpellings is [] for an unset HOME, which is not the root\'s [""]', async () => {
  for (const home of [undefined, ""]) {
    const p = probe(home, { realPath: "/" });
    const spellings = await homeSpellings(p.$);

    expect(spellings).toEqual([]);
    expect(spellings).not.toEqual([""]);
    expect(p.asked).toEqual([]);
  }
});

test("resolveHome has nothing unresolved for a HOME of / that resolves to itself", async () => {
  expect(await resolveHome(probe("/", { realPath: "/" }).$)).toEqual({
    spellings: [""],
  });
});

test("resolveHome shows / for the root where it says HOME is unresolved", async () => {
  const refused = probe("/", new Error("EACCES: denied"));
  const noPath = probe("/", {});

  const a = await resolveHome(refused.$);
  const b = await resolveHome(noPath.$);

  expect(a.spellings).toEqual([""]);
  expect(a.unresolved).toEqual({
    home: "/",
    reason: "stat failed: EACCES: denied",
  });
  expect(refused.logs).toEqual([
    "prompt-lift: could not resolve /: Error: EACCES: denied",
  ]);
  expect(b.spellings).toEqual([""]);
  expect(b.unresolved).toEqual({
    home: "/",
    reason: "the engine reported no real path",
  });
  expect(noPath.logs).toEqual([
    "prompt-lift: / has no real path, used as given",
  ]);
});

// --- selectInstructionFiles, expandHome and isExcluded, for the root's [""] ---

const user = (path: string): MemoryFile => ({ path, type: "User", tokens: 10 });
const cfg = parseOptions({});

test("selectInstructionFiles keeps a rules file under the root and drops a User file outside it", () => {
  const rules = user("/.claude/rules/a.md");

  expect(selectInstructionFiles([rules], cfg, [""])).toEqual([rules]);
  expect(
    selectInstructionFiles(
      [
        user("/.claude/CLAUDE.md"),
        user("/.claude/rules-old/a.md"),
        user("/notes/.claude/rules/a.md"),
        user("/rules/a.md"),
      ],
      cfg,
      [""],
    ),
  ).toEqual([]);
  // The control: no HOME at all keeps no rules file
  expect(selectInstructionFiles([rules], cfg, [])).toEqual([]);
});

test("selectInstructionFiles drops a root rules file its pattern excludes", () => {
  const files = [user("/.claude/rules/a.md"), user("/.claude/rules/secret.md")];
  const excluding = parseOptions({
    instructionExclude: "~/.claude/rules/secret.md",
  });

  expect(selectInstructionFiles(files, excluding, [""])).toEqual([files[0]]);
});

test("expandHome expands a tilde pattern against the root as /path", () => {
  expect(expandHome("~/a/b.md", [""])).toEqual(["/a/b.md"]);
  expect(expandHome("~/a/b.md", [LINKED_ROOT, ""])).toEqual([
    `${LINKED_ROOT}/a/b.md`,
    "/a/b.md",
  ]);
});

test("isExcluded matches ~/CLAUDE.md to /CLAUDE.md under the root", () => {
  const patterns = ["~/CLAUDE.md", "~/.claude/CLAUDE.md"];

  expect(isExcluded(ROOT_GLOBAL, patterns, [""])).toBe(true);
  expect(isExcluded("/.claude/CLAUDE.md", patterns, [""])).toBe(true);
  expect(isExcluded("/Other/CLAUDE.md", patterns, [""])).toBe(false);
  expect(isExcluded("/x/CLAUDE.md", patterns, [""])).toBe(false);
  expect(isExcluded("//CLAUDE.md", patterns, [""])).toBe(false);
  expect(isExcluded(ROOT_GLOBAL, [], [""])).toBe(false);
});

// --- Presses through the engine, with HOME the root ---

const MEMORY: MemoryFile[] = [
  { path: PROJECT_FILE, type: "Project", tokens: 100 },
  { path: ROOT_RULES, type: "User", tokens: 50 },
  { path: ROOT_GLOBAL, type: "Project", tokens: 10 },
];
const FILES = {
  [PROJECT_FILE]: PROJECT_TEXT,
  [ROOT_RULES]: RULES_TEXT,
  [ROOT_GLOBAL]: GLOBAL_MARK,
};

function rooted(
  on: Parameters<typeof engine>[0],
  home: string,
  opts: EngineOptions = {},
): Engine {
  return engine(on, { home, memoryFiles: MEMORY, files: FILES, ...opts });
}

test("a press with HOME / sends the root rules file and not the excluded ~/CLAUDE.md", async ($, on) => {
  const e = rooted(on, "/", { replies: [REPLY] });

  await press($, "fix the flag api please");

  expect(block(e, 0, 0)).toContain(PROJECT_TEXT);
  expect(block(e, 0, 0)).toContain(RULES_TEXT);
  expect(block(e, 0, 0)).not.toContain(GLOBAL_MARK);
  expect(e.reads).toContain(ROOT_RULES);
  expect(e.reads).not.toContain(ROOT_GLOBAL);
});

test("a press with HOME unset sends no rules file: unset is not the root", async ($, on) => {
  const e = rooted(on, "", { replies: [REPLY] });

  await press($, "fix the flag api please");

  expect(block(e, 0, 0)).toContain(PROJECT_TEXT);
  expect(block(e, 0, 0)).not.toContain(RULES_TEXT);
  expect(e.reads).not.toContain(ROOT_RULES);
});

/** The paths a `instruction files <which>:` status row lists, in order. */
function listed(text: string | undefined, which: string): string[] {
  const prefix = `instruction files ${which}: `;
  const row = (text ?? "").split("\n").find((l) => l.startsWith(prefix));
  return (row ?? "")
    .slice(prefix.length)
    .split(", ")
    .map((entry) => entry.split(" (")[0] ?? "");
}

test("status with HOME / lists the root rules file as included and ~/CLAUDE.md as excluded, with no home row", async ($, on) => {
  rooted(on, "/");

  const r = (await press($, "status")) as { text?: string };

  expect(listed(r.text, "included")).toEqual([PROJECT_FILE, ROOT_RULES]);
  expect(listed(r.text, "excluded")).toEqual([ROOT_GLOBAL]);
  expect((r.text ?? "").split("\n").some((l) => l.startsWith("home:"))).toBe(
    false,
  );
});

test("status shows / for the root HOME when the stat is refused", async ($, on) => {
  on("fs.stat", { path: "/" } as never, () => ({ deny: "EACCES" }));
  rooted(on, "/");

  const r = (await press($, "status")) as { text?: string };

  const row = (r.text ?? "").split("\n").find((l) => l.startsWith("home:"));
  expect(row).toMatch(/^home: \/ unresolved \(stat failed: .*EACCES/);
  expect(row).not.toContain("home:  ");
});
