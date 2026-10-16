import { atom, read, update } from "claude-code";
import type { EngineInterface, SessionMessage, StateValue } from "claude-code";
import type { Config } from "./config";
import { estimateUsd } from "./config";
import { rulesText, SYSTEM } from "./rules";
import { postProcess, preGuard, type PostOk } from "./guards";
import {
  buildDynamicBlock,
  buildStaticBlock,
  hashBlock,
  matchSkills,
} from "./context";
import { runChain, usageText, type ChainFail, type ChainOk } from "./chain";
import {
  basename,
  errorMessage,
  gatherContext,
  lastAssistantText,
  namedPathsExist,
  resolveChain,
} from "./gather";
import { describeAttempt, isUncached, recordPress, toLastUsage } from "./stats";
import { disarmUndo } from "./arm";

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
  rootDirs: string[];
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

// Cancel (spec §5.3, C3): the flag tells an `aborted` reply from a Cancel
// apart from a timeout, so the chain stops instead of falling back.
export function cancel(): void {
  if (controller === undefined) {
    return;
  }
  cancelled = true;
  controller.abort();
}

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
      rootDirs: prepared.rootDirs,
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

/** The one engine noun step 2 reads, so a test can hand it a stub box. */
export type DraftReader = { prompt: Pick<EngineInterface["prompt"], "read"> };

/** Step 2: the draft is the prompt box for the button, the args for the command. */
export async function readDraft(
  $: DraftReader,
  source: EnhanceSource,
): Promise<string> {
  return source.kind === "box" ? (await $.prompt.read()).text : source.text;
}

/**
 * Step 7's box re-read: the button path must still show the draft, the
 * command path an empty box; anything else means the person kept typing.
 */
export function expectedBoxText(source: EnhanceSource, draft: string): string {
  return source.kind === "box" ? draft : "";
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
    rootDirs: ctx.rootDirs,
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
    rootDirs: readonly string[];
    post: PostOk;
    myId: number;
  },
): Promise<string | undefined> {
  const hasPaths = await namedPathsExist($, {
    root: a.root,
    draft: a.draft,
    result: a.post.text,
    rootDirs: a.rootDirs,
  });
  if (!hasPaths) {
    $.ui.toast(TOAST_MISSING_PATH);
    return undefined;
  }
  if ((await read($, requestId)) !== a.myId) {
    return undefined;
  }
  if ((await $.prompt.read()).text !== expectedBoxText(a.source, a.draft)) {
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
  const hashChanged = previousHash !== "" && previousHash !== hash;
  const previousEnhanced = await read($, enhanced);
  if (previousEnhanced !== a.draft) {
    await update($, original, () => a.draft);
  }
  await update($, enhanced, () => a.filledText);
  await update($, isUndone, () => false);
  // A pending Undo confirm referred to the pair this fill replaced (C13).
  disarmUndo();
  await update($, lastUsage, () => toLastUsage(a, usd, hashChanged));
  await update($, blockHash, () => hash);
  await update($, staticChars, () => a.staticBlock.length);
  const uncached = isUncached(usage);
  await update($, noCacheStreak, (n) => (uncached ? n + 1 : 0));
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
      hashChanged,
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
