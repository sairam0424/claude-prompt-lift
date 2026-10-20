import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  block,
  improve,
  press,
  HOME,
  PROJECT_FILE,
  PROJECT_TEXT,
  ROOT,
  RULES_FILE,
  RULES_TEXT,
} from "./engine";
import { isExcluded } from "../hooks/context";

// R17 (catalogue review of seed PR #341, finding 1): `instructionExclude`
// covers the named subproject's CLAUDE.md as well as the loaded instruction
// files. An excluded subproject file is neither read nor sent — the check runs
// before any `$.fs` call — and the press logs one debug line naming the path.

const DRAFT = "fix the flag api in Tombstone please";
const TOMB_FILE = `${ROOT}/Tombstone/CLAUDE.md`;
const OTHER_FILE = `${ROOT}/Other/CLAUDE.md`;
const LEFT_OUT = `prompt-lift: subproject ${TOMB_FILE} left out by instructionExclude`;
const REPLY = answered(
  improve("Fix the flag API in Tombstone please and add a test"),
);

const FILES = {
  [PROJECT_FILE]: PROJECT_TEXT,
  [RULES_FILE]: RULES_TEXT,
  [TOMB_FILE]: "TOMB-MARK",
  [OTHER_FILE]: "OTHER-MARK",
};

test(
  "an excluded subproject CLAUDE.md is neither read nor sent",
  {
    options: {
      instructionExclude:
        "~/.claude/CLAUDE.md,~/CLAUDE.md,~/Desktop/W/Tombstone/CLAUDE.md",
    },
  },
  async ($, on) => {
    const e = engine(on, { files: FILES, replies: [REPLY] });

    await press($, DRAFT);

    const second = block(e, 0, 1);
    expect(second).not.toContain("<subproject_instructions>");
    expect(second).not.toContain("TOMB-MARK");
    expect(e.reads).not.toContain(TOMB_FILE);
    expect(e.probes).not.toContain(TOMB_FILE);
    // The project file is not excluded: it still reaches block 0
    expect(block(e, 0, 0)).toContain(PROJECT_TEXT);
    expect(e.fills).toHaveLength(1);
    const leftOut = e.logs.filter((line) => line.includes("left out by"));
    expect(leftOut).toEqual([LEFT_OUT]);
  },
);

test(
  "a glob in instructionExclude excludes the subproject file the same way",
  { options: { instructionExclude: "*/Tombstone/*" } },
  async ($, on) => {
    const e = engine(on, { files: FILES, replies: [REPLY] });

    await press($, DRAFT);

    const second = block(e, 0, 1);
    expect(second).not.toContain("<subproject_instructions>");
    expect(second).not.toContain("TOMB-MARK");
    expect(e.reads).not.toContain(TOMB_FILE);
    expect(e.probes).not.toContain(TOMB_FILE);
    expect(e.fills).toHaveLength(1);
    expect(e.logs).toContain(LEFT_OUT);
  },
);

test("with the default exclusions the subproject file is still read once and sent", async ($, on) => {
  const e = engine(on, { files: FILES, replies: [REPLY] });

  await press($, DRAFT);

  const second = block(e, 0, 1);
  expect(second).toContain("<subproject_instructions>");
  expect(second).toContain("TOMB-MARK");
  expect(second).not.toContain("OTHER-MARK");
  expect(e.reads.filter((path) => path === TOMB_FILE)).toHaveLength(1);
  expect(e.fills).toHaveLength(1);
  expect(e.logs.some((line) => line.includes("left out by"))).toBe(false);
});

test("isExcluded matches ~-expanded and glob patterns, not a sibling", () => {
  const tilde = ["~/Desktop/W/Tombstone/CLAUDE.md"];
  const glob = ["*/Tombstone/*"];
  const defaults = ["~/.claude/CLAUDE.md", "~/CLAUDE.md"];

  expect(isExcluded(TOMB_FILE, tilde, HOME)).toBe(true);
  expect(isExcluded(TOMB_FILE, glob, HOME)).toBe(true);
  expect(isExcluded(OTHER_FILE, tilde, HOME)).toBe(false);
  expect(isExcluded(OTHER_FILE, glob, HOME)).toBe(false);
  expect(isExcluded(TOMB_FILE, defaults, HOME)).toBe(false);
  expect(isExcluded(TOMB_FILE, [], HOME)).toBe(false);
});
