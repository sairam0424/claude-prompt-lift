import { atom, read, update } from "claude-code";
import type { EngineInterface, SessionMessage, StateValue } from "claude-code";
import type { LastUsage } from "../types";
import type { Config } from "./config";
import { estimateUsd, shortModel } from "./config";
import { rulesText, SYSTEM } from "./rules";
import { postProcess, preGuard, type PostOk } from "./guards";
import {
  buildDynamicBlock,
  buildStaticBlock,
  hashBlock,
  matchSkills,
} from "./context";
import {
  runChain,
  usageText,
  type Attempt,
  type ChainFail,
  type ChainOk,
} from "./chain";
import {
  basename,
  errorMessage,
  gatherContext,
  lastAssistantText,
  namedPathsExist,
  resolveChain,
} from "./gather";
import { recordPress } from "./stats";

// The Enhance flow (spec §5.3 steps 1–9) and the session state it writes.
// Every atom is declared in this file: `read` and `update` only validate
// against an atom made in the file that calls them.

export const phase = atom(
  { plugin: "prompt-master", key: "phase" } as const,
  "idle",
);
export const original = atom(
  { plugin: "prompt-master", key: "original" } as const,
  null,
);
export const enhanced = atom(
  { plugin: "prompt-master", key: "enhanced" } as const,
  null,
);
export const isUndone = atom(
  { plugin: "prompt-master", key: "isUndone" } as const,
  false,
);
export const model = atom(
  { plugin: "prompt-master", key: "model" } as const,
  "",
);
export const runningModel = atom(
  { plugin: "prompt-master", key: "runningModel" } as const,
  "",
);
export const lastUsage = atom(
  { plugin: "prompt-master", key: "lastUsage" } as const,
  null,
);
export const blockHash = atom(
  { plugin: "prompt-master", key: "blockHash" } as const,
  "",
);
export const staticChars = atom(
  { plugin: "prompt-master", key: "staticChars" } as const,
  0,
);
export const requestId = atom(
  { plugin: "prompt-master", key: "requestId" } as const,
  0,
);
export const noCacheStreak = atom(
  { plugin: "prompt-master", key: "noCacheStreak" } as const,
  0,
);
export const sessionPresses = atom(
  { plugin: "prompt-master", key: "sessionPresses" } as const,
  0,
);
export const sessionUsd = atom(
  { plugin: "prompt-master", key: "sessionUsd" } as const,
  0,
);

const TOAST_BUSY = "prompt-master: already enhancing";
const TOAST_FINE = "prompt-master: already specific, left as is";
const TOAST_DRAFT_CHANGED =
  "prompt-master: draft changed while enhancing, left as is";
const TOAST_MISSING_PATH =
  "prompt-master: named a file that does not exist, kept your prompt";
const TOAST_CANCELLED = "prompt-master: cancelled, draft unchanged";
const TOAST_NO_MODELS = "prompt-master: no models configured";

export type EnhanceSource = { kind: "box" } | { kind: "args"; text: string };

type Phase = StateValue<"prompt-master", "phase">;

type Prepared = {
  root: string;
  staticBlock: string;
  dynamicBlock: string;
  relevantCount: number;
  knownSkills: Set<string>;
  descriptions: Map<string, string>;
  documentsText: string;
};

type Success = {
  draft: string;
  filledText: string;
  run: ChainOk;
  post: PostOk;
  staticBlock: string;
  relevantCount: number;
};

let busy = false;
let cancelled = false;
let controller: AbortController | undefined;
let pendingNote: Promise<void> = Promise.resolve();

export async function enhance(
  $: EngineInterface,
  cfg: Config,
  source: EnhanceSource,
): Promise<void> {
  if (busy) {
    $.ui.toast(TOAST_BUSY);
    return;
  }
  busy = true;
  cancelled = false;
  const abort = new AbortController();
  controller = abort;
  // Where the phase stood before this press: a refused or failed press goes
  // back there, so a held result keeps its Send and Undo (§5.1, C13).
  let before: Phase = "idle";
  try {
    before = await read($, phase);
    const myId = await update($, requestId, (n) => n + 1);
    await update($, phase, () => "running");
    const draft = await readDraft($, source);
    const rows = await $.session.messages();
    const guard = preGuard(draft, cfg, lastAssistantText(rows));
    if (!guard.ok) {
      $.ui.toast(guard.toast);
      return;
    }
    const prepared = await prepare($, cfg, draft, rows);
    const run = await callChain($, cfg, prepared, abort.signal);
    if (!run.ok) {
      reportFailure($, run);
      return;
    }
    const post = postProcess({
      draft,
      reply: run.text,
      outputTokens: run.usage.output_tokens,
      cfg,
      knownSkills: prepared.knownSkills,
      descriptions: prepared.descriptions,
      documents: prepared.documentsText,
    });
    if (!post.ok) {
      $.ui.toast("fine" in post ? TOAST_FINE : post.toast);
      return;
    }
    const filledText = await verifyAndFill($, {
      source,
      draft,
      root: prepared.root,
      post,
      myId,
    });
    if (filledText === undefined) {
      return;
    }
    await recordSuccess($, cfg, {
      draft,
      filledText,
      run,
      post,
      staticBlock: prepared.staticBlock,
      relevantCount: prepared.relevantCount,
    });
  } catch (err) {
    $.ui.toast(`prompt-master: enhance failed (${errorMessage(err)})`);
    $.ui.log(`prompt-master: enhance failed: ${String(err)}`, { to: "debug" });
  } finally {
    busy = false;
    controller = undefined;
    await settle($, before);
  }
}

async function readDraft(
  $: EngineInterface,
  source: EnhanceSource,
): Promise<string> {
  return source.kind === "box" ? (await $.prompt.read()).text : source.text;
}

async function prepare(
  $: EngineInterface,
  cfg: Config,
  draft: string,
  rows: readonly SessionMessage[],
): Promise<Prepared> {
  const ctx = await gatherContext($, cfg, draft, rows);
  const staticBlock = buildStaticBlock({
    rules: rulesText(cfg.filePrefix),
    project: basename(ctx.root),
    documents: ctx.documents,
    skillNames: ctx.skillNames,
  });
  const relevant = matchSkills(
    draft,
    ctx.commands,
    new Set(ctx.skillNames),
    cfg.relevantSkills,
  );
  const dynamicBlock = buildDynamicBlock({
    relevant,
    subproject: ctx.subproject,
    conversation: ctx.conversation,
    draft,
  });
  return {
    root: ctx.root,
    staticBlock,
    dynamicBlock,
    relevantCount: relevant.length,
    knownSkills: new Set([
      ...ctx.skillNames,
      ...ctx.commands.map((c) => c.name),
    ]),
    descriptions: ctx.descriptions,
    documentsText: ctx.documentsText,
  };
}

async function callChain(
  $: EngineInterface,
  cfg: Config,
  prepared: Prepared,
  signal: AbortSignal,
): Promise<ChainOk | ChainFail> {
  const chain = await resolveChain($, cfg);
  await update($, model, () => chain[0] ?? "");
  return runChain({
    complete: (req, o) => $.model.complete(req, o),
    chain,
    cfg,
    system: SYSTEM,
    blocks: [
      { text: prepared.staticBlock, cache: true },
      { text: prepared.dynamicBlock },
    ],
    signal,
    isCancelled: () => cancelled,
    onAttempt: (id) => noteRunningModel($, id),
  });
}

/** `runChain` reports each rung synchronously; the write is awaited by `settle`. */
function noteRunningModel($: EngineInterface, id: string): void {
  pendingNote = update($, runningModel, () => id)
    .then(() => undefined)
    .catch((err: unknown) => {
      $.ui.log(`prompt-master: runningModel: ${errorMessage(err)}`, {
        to: "debug",
      });
    });
}

function describeAttempt(attempt: Attempt): string {
  return `${shortModel(attempt.model)}: ${attempt.outcome}`;
}

function reportFailure($: EngineInterface, run: ChainFail): void {
  if (run.cancelled) {
    $.ui.toast(TOAST_CANCELLED);
    return;
  }
  if (run.attempts.length === 0) {
    $.ui.toast(TOAST_NO_MODELS);
    return;
  }
  const trail = run.attempts.map(describeAttempt).join(" → ");
  $.ui.toast(`prompt-master: no model answered · ${trail}`);
  $.ui.log(`prompt-master: enhance failed: ${trail}`);
}

/** Steps 7 and 8: path guard, stale check, box re-read, fill. */
async function verifyAndFill(
  $: EngineInterface,
  a: {
    source: EnhanceSource;
    draft: string;
    root: string;
    post: PostOk;
    myId: number;
  },
): Promise<string | undefined> {
  if (!(await namedPathsExist($, a.root, a.draft, a.post.text))) {
    $.ui.toast(TOAST_MISSING_PATH);
    return undefined;
  }
  if ((await read($, requestId)) !== a.myId) {
    return undefined;
  }
  const expected = a.source.kind === "box" ? a.draft : "";
  if ((await $.prompt.read()).text !== expected) {
    $.ui.toast(TOAST_DRAFT_CHANGED);
    return undefined;
  }
  const filled = await $.prompt.fill({
    text: a.post.text,
    mode: "replace",
    decorations: a.post.decorations,
  });
  if (!filled.isFilled) {
    const cause = filled.refusal ?? "refused";
    $.ui.toast(
      `prompt-master: the prompt box did not take the text (${cause})`,
    );
    return undefined;
  }
  return filled.text;
}

function toLastUsage(a: Success, usd: number): LastUsage {
  const usage = a.run.usage;
  return {
    model: a.run.model,
    input: usage.input_tokens,
    cached: usage.cache_read_input_tokens,
    written: usage.cache_creation_input_tokens,
    output: usage.output_tokens,
    usd,
    attempts: a.run.attempts.map(describeAttempt),
    why: a.post.why,
    addedWords: a.post.addedWords,
    skills: a.relevantCount,
  };
}

/** Step 9: state, stats and the usage toast. */
async function recordSuccess(
  $: EngineInterface,
  cfg: Config,
  a: Success,
): Promise<void> {
  const usage = a.run.usage;
  const usd = estimateUsd(usage, a.run.model, cfg.prices);
  const hash = hashBlock(a.staticBlock);
  const previousHash = await read($, blockHash);
  const previousEnhanced = await read($, enhanced);
  if (previousEnhanced !== a.draft) {
    await update($, original, () => a.draft);
  }
  await update($, enhanced, () => a.filledText);
  await update($, isUndone, () => false);
  await update($, lastUsage, () => toLastUsage(a, usd));
  await update($, blockHash, () => hash);
  await update($, staticChars, () => a.staticBlock.length);
  const isUncached =
    usage.cache_read_input_tokens === 0 &&
    usage.cache_creation_input_tokens === 0;
  await update($, noCacheStreak, (n) => (isUncached ? n + 1 : 0));
  await update($, sessionPresses, (n) => n + 1);
  await update($, sessionUsd, (n) => n + usd);
  await update($, phase, () => "done");
  await recordPress($, usd);
  $.ui.toast(
    usageText({
      model: a.run.model,
      usage,
      usd,
      why: a.post.why,
      hashChanged: previousHash !== "" && previousHash !== hash,
      attempts: a.run.attempts,
    }),
  );
}

/**
 * Never leaves the phase at `running` once a press has settled: `done` stays
 * `done` when a later press is refused, anything else returns to `idle`.
 */
async function settle($: EngineInterface, before: Phase): Promise<void> {
  try {
    await pendingNote;
    await update($, runningModel, () => "");
    if ((await read($, phase)) === "running") {
      await update($, phase, () => (before === "done" ? "done" : "idle"));
    }
  } catch (err) {
    $.ui.log(`prompt-master: could not reset the phase: ${errorMessage(err)}`, {
      to: "debug",
    });
  }
}
