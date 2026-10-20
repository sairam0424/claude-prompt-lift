import type { EngineInterface, SessionMessage } from "claude-code";
import type { Config } from "./config";
import {
  capText,
  isExcluded,
  selectInstructionFiles,
  selectSkillNames,
  subprojectDir,
  type CommandEntry,
  type MemoryFile,
} from "./context";
import { isFileLike, pathTokens } from "./tokens";
import { readTailCount } from "./tail";

// Reads what an Enhance press needs from the engine: the instruction files the
// session loaded (minus `instructionExclude`), the skill listing, the command
// list, the root's directories, an optional subproject CLAUDE.md (left unread
// when `instructionExclude` matches it) and the conversation tail. No state
// lives here.

const SESSION_MODEL_TOKEN = "session";
const SUBPROJECT_MAX_CHARS = 12_000;
const CONVERSATION_MESSAGE_MAX_CHARS = 600;

export type Document = { path: string; text: string };

export type Gathered = {
  root: string;
  documents: Document[];
  documentsText: string;
  skillNames: string[];
  commands: CommandEntry[];
  descriptions: Map<string, string>;
  /** The project root's directories, for the subproject and path guards. */
  rootDirs: string[];
  subproject: Document | undefined;
  conversation: string[] | undefined;
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function basename(path: string): string {
  return (
    path
      .split("/")
      .filter((part) => part.length > 0)
      .at(-1) ?? path
  );
}

export function lastAssistantText(
  rows: readonly SessionMessage[],
): string | undefined {
  return rows.findLast((row) => row.role === "assistant")?.text;
}

export function conversationTail(
  rows: readonly SessionMessage[],
  count: number,
): string[] {
  if (count <= 0) {
    return [];
  }
  return rows
    .slice(-count)
    .map(
      (row) =>
        `${row.role}: ${capText(row.text, CONVERSATION_MESSAGE_MAX_CHARS)}`,
    );
}

/** `$.store` key of the first rung `/prompt-lift model` chose (spec §5.2). */
export const MODEL_STORE_KEY = "model";

/** The configured ids with the `session` token resolved, in order. */
export async function configuredIds(
  $: EngineInterface,
  cfg: Config,
): Promise<string[]> {
  const needsSession = cfg.models.includes(SESSION_MODEL_TOKEN);
  const sessionModel = needsSession ? await $.session.model() : "";
  return cfg.models
    .map((id) => (id === SESSION_MODEL_TOKEN ? sessionModel : id))
    .filter((id) => id.length > 0);
}

/**
 * The configured ids a choice names, case-insensitively: the id spelled in
 * full when there is one, else every id containing the choice (`sonnet` →
 * `us.anthropic.claude-sonnet-5-5`). The engine takes an alias, but the mod
 * prices, dedupes and picks `effort` by the pinned id, so the pinned id is
 * what gets stored and called.
 */
export function matchRungs(choice: string, ids: readonly string[]): string[] {
  const wanted = choice.toLowerCase();
  const exact = ids.filter((id) => id.toLowerCase() === wanted);
  if (exact.length > 0) {
    return exact;
  }
  return ids.filter((id) => id.toLowerCase().includes(wanted));
}

/**
 * The configured chain with the `session` token resolved, led by the stored
 * choice when there is one, without repeats. A stored alias (an older store)
 * leads as the rung it names when it names exactly one.
 */
export async function resolveChain(
  $: EngineInterface,
  cfg: Config,
): Promise<string[]> {
  const ids = await configuredIds($, cfg);
  const stored = await $.store.get(MODEL_STORE_KEY);
  if (typeof stored !== "string" || stored === "") {
    return [...new Set(ids)];
  }
  const matched = matchRungs(stored, ids);
  const lead = matched.length === 1 ? (matched[0] ?? stored) : stored;
  return [...new Set([lead, ...ids])];
}

async function readDocuments(
  $: EngineInterface,
  files: readonly MemoryFile[],
  maxChars: number,
): Promise<Document[]> {
  const docs = await Promise.all(
    files.map(async (file): Promise<Document | undefined> => {
      try {
        const text = await $.fs.read(file.path);
        return { path: file.path, text: capText(text, maxChars) };
      } catch (err) {
        $.ui.log(
          `prompt-lift: could not read ${file.path}: ${errorMessage(err)}`,
          { to: "debug" },
        );
        return undefined;
      }
    }),
  );
  return docs.filter((doc): doc is Document => doc !== undefined);
}

async function listRootDirs(
  $: EngineInterface,
  root: string,
): Promise<string[]> {
  try {
    const entries = await $.fs.list(root);
    return entries
      .filter((entry) => entry.kind === "dir")
      .map((entry) => entry.name);
  } catch (err) {
    $.ui.log(`prompt-lift: could not list ${root}: ${errorMessage(err)}`, {
      to: "debug",
    });
    return [];
  }
}

async function readSubproject(
  $: EngineInterface,
  root: string,
  draft: string,
  dirs: readonly string[],
  patterns: readonly string[],
  home: string,
): Promise<Document | undefined> {
  const dir = subprojectDir(draft, dirs);
  if (dir === undefined) {
    return undefined;
  }
  const path = `${root}/${dir}/CLAUDE.md`;
  // R17: `instructionExclude` covers this file as it covers the loaded
  // instruction files, decided before any `$.fs` call, so an excluded file is
  // neither probed nor read; the block then shows no subproject section, as
  // for an absent file.
  if (isExcluded(path, patterns, home)) {
    $.ui.log(`prompt-lift: subproject ${path} left out by instructionExclude`, {
      to: "debug",
    });
    return undefined;
  }
  try {
    if (!(await $.fs.exists(path))) {
      return undefined;
    }
    const text = await $.fs.read(path);
    return { path, text: capText(text, SUBPROJECT_MAX_CHARS) };
  } catch (err) {
    $.ui.log(`prompt-lift: subproject lookup failed: ${errorMessage(err)}`, {
      to: "debug",
    });
    return undefined;
  }
}

export async function gatherContext(
  $: EngineInterface,
  cfg: Config,
  draft: string,
  rows: readonly SessionMessage[],
): Promise<Gathered> {
  const usage = await $.session.usage({ breakdown: "summary" });
  const breakdown = usage.context.breakdown;
  const home = (await $.env.get("HOME")) ?? "";
  const files = selectInstructionFiles(breakdown?.memoryFiles ?? [], cfg, home);
  const documents = await readDocuments($, files, cfg.instructionFileMaxChars);
  const skillNames = selectSkillNames(
    breakdown?.skills?.skillFrontmatter ?? [],
    cfg,
  );
  const commands: CommandEntry[] = (await $.command.list()).map((c) => ({
    name: c.name,
    description: c.description,
    source: c.source,
  }));
  const root = await $.session.root();
  const rootDirs = await listRootDirs($, root);
  const subproject = await readSubproject(
    $,
    root,
    draft,
    rootDirs,
    cfg.instructionExclude,
    home,
  );
  const count = await readTailCount($, cfg);
  const conversation = count > 0 ? conversationTail(rows, count) : undefined;
  return {
    root,
    documents,
    documentsText: documents.map((doc) => doc.text).join("\n"),
    skillNames,
    commands,
    descriptions: new Map(commands.map((c) => [c.name, c.description])),
    rootDirs,
    subproject,
    conversation,
  };
}

/**
 * Spec §9.11: every file the result names that the draft (or the person's own
 * `extraRules`) did not must exist.
 * Only file-looking tokens are asked of the filesystem (`isFileLike`), so
 * prose such as `CI/CD` or `and/or` is not refused as a missing file.
 */
export async function namedPathsExist(
  $: EngineInterface,
  a: {
    root: string;
    draft: string;
    userRules: string;
    result: string;
    rootDirs: readonly string[];
  },
): Promise<boolean> {
  const dirs = new Set(a.rootDirs);
  // A path in the person's own `extraRules` is theirs as much as the draft's
  const inDraft = new Set(pathTokens(`${a.draft}\n${a.userRules}`));
  const fresh = [...new Set(pathTokens(a.result))].filter(
    (token) => !inDraft.has(token) && isFileLike(token, dirs),
  );
  const found = await Promise.all(
    fresh.map((token) =>
      $.fs.exists(token.startsWith("/") ? token : `${a.root}/${token}`),
    ),
  );
  return found.every((exists) => exists);
}
