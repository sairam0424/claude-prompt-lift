import type { EngineInterface, SessionMessage } from "claude-code";
import type { Config } from "./config";
import {
  capText,
  selectInstructionFiles,
  selectSkillNames,
  subprojectDir,
  type CommandEntry,
  type MemoryFile,
} from "./context";
import { pathTokens } from "./guards";

// Reads what an Enhance press needs from the engine: the instruction files the
// session loaded, the skill listing, the command list, an optional subproject
// CLAUDE.md and the conversation tail. No state lives here.

const SESSION_MODEL_TOKEN = "session";
const SUBPROJECT_MAX_CHARS = 12_000;
const CONVERSATION_MESSAGE_MAX_CHARS = 600;
const EDGE_PUNCTUATION = /^[("'`]+|[.,;:!?)"'`]+$/g;

export type Document = { path: string; text: string };

export type Gathered = {
  root: string;
  documents: Document[];
  documentsText: string;
  skillNames: string[];
  commands: CommandEntry[];
  descriptions: Map<string, string>;
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

/** `$.store` key of the first rung `/prompt-master model` chose (spec §5.2). */
export const MODEL_STORE_KEY = "model";

/**
 * The configured chain with the `session` token resolved, led by the stored
 * choice when there is one, without repeats.
 */
export async function resolveChain(
  $: EngineInterface,
  cfg: Config,
): Promise<string[]> {
  const stored = await $.store.get(MODEL_STORE_KEY);
  const chosen = typeof stored === "string" && stored !== "" ? [stored] : [];
  const needsSession = cfg.models.includes(SESSION_MODEL_TOKEN);
  const sessionModel = needsSession ? await $.session.model() : "";
  const ids = cfg.models
    .map((id) => (id === SESSION_MODEL_TOKEN ? sessionModel : id))
    .filter((id) => id.length > 0);
  return [...new Set([...chosen, ...ids])];
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
          `prompt-master: could not read ${file.path}: ${errorMessage(err)}`,
          { to: "debug" },
        );
        return undefined;
      }
    }),
  );
  return docs.filter((doc): doc is Document => doc !== undefined);
}

async function readSubproject(
  $: EngineInterface,
  root: string,
  draft: string,
): Promise<Document | undefined> {
  try {
    const entries = await $.fs.list(root);
    const dirs = entries
      .filter((entry) => entry.kind === "dir")
      .map((entry) => entry.name);
    const dir = subprojectDir(draft, dirs);
    if (dir === undefined) {
      return undefined;
    }
    const path = `${root}/${dir}/CLAUDE.md`;
    if (!(await $.fs.exists(path))) {
      return undefined;
    }
    const text = await $.fs.read(path);
    return { path, text: capText(text, SUBPROJECT_MAX_CHARS) };
  } catch (err) {
    $.ui.log(`prompt-master: subproject lookup failed: ${errorMessage(err)}`, {
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
  const subproject = await readSubproject($, root, draft);
  const conversation = cfg.includeConversation
    ? conversationTail(rows, cfg.conversationMessages)
    : undefined;
  return {
    root,
    documents,
    documentsText: documents.map((doc) => doc.text).join("\n"),
    skillNames,
    commands,
    descriptions: new Map(commands.map((c) => [c.name, c.description])),
    subproject,
    conversation,
  };
}

function stripEdges(token: string): string {
  return token.replace(EDGE_PUNCTUATION, "");
}

/** Spec §9.11: every path the result names that the draft did not must exist. */
export async function namedPathsExist(
  $: EngineInterface,
  root: string,
  draft: string,
  result: string,
): Promise<boolean> {
  const inDraft = new Set(pathTokens(draft).map(stripEdges));
  const fresh = [...new Set(pathTokens(result).map(stripEdges))].filter(
    (token) => token.length > 0 && !inDraft.has(token),
  );
  const found = await Promise.all(
    fresh.map((token) =>
      $.fs.exists(token.startsWith("/") ? token : `${root}/${token}`),
    ),
  );
  return found.every((exists) => exists);
}
