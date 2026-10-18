import { atom, read, update } from "claude-code";
import type {
  EngineInterface,
  PromptDecoration,
  StateValue,
} from "claude-code";
import type { Config } from "./config";
import { SYSTEM } from "./rules";
import { postProcess, preGuard, type PostOk } from "./guards";
import { prepare, type Prepared } from "./prepare";
import {
  capToast,
  costText,
  cut,
  runChain,
  usageText,
  ERROR_MAX,
  type ChainFail,
  type ChainOk,
} from "./chain";
import {
  errorMessage,
  lastAssistantText,
  namedPathsExist,
  resolveChain,
} from "./gather";
import {
  assessCall,
  attemptsUsd,
  describeAttempt,
  recordCall,
  recordOrLog,
  recordSpend,
  type AnsweredCall,
} from "./stats";
import { disarmUndo } from "./arm";

// The Enhance flow (spec §5.3 steps 1–9) and the session state it writes.
// Every atom this file reads or writes is declared here (the usage atoms live
// in stats.ts): `read` and `update` only validate against an atom made in the
// file that calls them.

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
export const lastDecorations = atom(
  { plugin: "prompt-master", key: "lastDecorations" } as const,
  null,
);
export const model = atom(
  { plugin: "prompt-master", key: "model" } as const,
  "",
);
export const runningModel = atom(
  { plugin: "prompt-master", key: "runningModel" } as const,
  "",
);
export const requestId = atom(
  { plugin: "prompt-master", key: "requestId" } as const,
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
const TOAST_NOT_TAKEN = "prompt-master: the prompt box did not take the text";
const TOAST_RECORD_FAILED =
  "prompt-master: saved the result, but recording its cost failed";

export type EnhanceSource = { kind: "box" } | { kind: "args"; text: string };

type Phase = StateValue<"prompt-master", "phase">;

type Success = { run: ChainOk; post: PostOk; call: AnsweredCall };

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

/**
 * Whether a press is under way: its controller is set before its first write
 * and cleared in its `finally`; the band and the resets ask.
 */
export function isCallInFlight(): boolean {
  return controller !== undefined;
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
  // Paid for whatever comes after the answer (G5, C19): owed until a record
  // is attempted; a throw before that leaves it to the catch.
  let unrecorded: AnsweredCall | undefined;
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
      await reportFailure($, cfg, run);
      return;
    }
    // Judged now, written once the outcome is known: after the pair on a fill
    const call = await assessCall($, cfg, {
      run,
      staticBlock: prepared.staticBlock,
      relevantCount: prepared.relevantCount,
    });
    unrecorded = call;
    const post = postProcess({
      draft,
      reply: run.text,
      outputTokens: run.usage.output_tokens,
      cfg,
      knownSkills: prepared.knownSkills,
      listedSkills: prepared.listedSkills,
      descriptions: prepared.descriptions,
      documents: prepared.documentsText,
    });
    if (!post.ok) {
      unrecorded = undefined;
      await recordCall($, call);
      $.ui.toast(withCost("fine" in post ? TOAST_FINE : post.toast, call.usd));
      return;
    }
    const filledText = await verifyAndFill($, {
      source,
      draft,
      root: prepared.root,
      rootDirs: prepared.rootDirs,
      post,
      myId,
      usd: call.usd,
    });
    if (filledText === undefined) {
      unrecorded = undefined;
      await recordCall($, call);
      return;
    }
    await holdPair($, { draft, filledText, decorations: post.decorations });
    unrecorded = undefined;
    await recordSuccess($, { run, post, call });
  } catch (err) {
    if (unrecorded !== undefined) {
      await recordOrLog($, unrecorded);
    }
    // The message is cut where it is composed (R2); capToast makes it one line
    const message = cut(errorMessage(err), ERROR_MAX);
    $.ui.toast(capToast(`prompt-master: enhance failed (${message})`));
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

/**
 * C19: a toast that follows a model call ends with what the call cost, or
 * `$? · (no price)` when the model has no price (R3); one line, capped (R2).
 */
function withCost(toast: string, usd: number | undefined): string {
  return capToast(`${toast} · ${costText(usd)}`);
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

/**
 * A chain that answered nothing still paid for its rungs (G5): record that,
 * then say so.
 */
async function reportFailure(
  $: EngineInterface,
  cfg: Config,
  run: ChainFail,
): Promise<void> {
  if (run.attempts.length === 0) {
    $.ui.toast(TOAST_NO_MODELS);
    return;
  }
  const usd = attemptsUsd(run.attempts, cfg.prices);
  await recordSpend($, usd);
  if (run.cancelled) {
    $.ui.toast(withCost(TOAST_CANCELLED, usd));
    return;
  }
  const trail = run.attempts.map(describeAttempt).join(" → ");
  $.ui.toast(withCost(`prompt-master: no model answered · ${trail}`, usd));
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
    usd: number | undefined;
  },
): Promise<string | undefined> {
  const hasPaths = await namedPathsExist($, {
    root: a.root,
    draft: a.draft,
    result: a.post.text,
    rootDirs: a.rootDirs,
  });
  if (!hasPaths) {
    $.ui.toast(withCost(TOAST_MISSING_PATH, a.usd));
    return undefined;
  }
  if ((await read($, requestId)) !== a.myId) {
    return undefined;
  }
  if ((await $.prompt.read()).text !== expectedBoxText(a.source, a.draft)) {
    $.ui.toast(withCost(TOAST_DRAFT_CHANGED, a.usd));
    return undefined;
  }
  const filled = await $.prompt.fill({
    text: a.post.text,
    mode: "replace",
    decorations: a.post.decorations,
  });
  if (!filled.isFilled) {
    const cause = filled.refusal ?? "refused";
    $.ui.toast(withCost(`${TOAST_NOT_TAKEN} (${cause})`, a.usd));
    return undefined;
  }
  return filled.text;
}

/**
 * Step 9's first write, right after the fill: the pair Undo restores, held
 * before anything about the call is recorded (§5.3, §12).
 */
async function holdPair(
  $: EngineInterface,
  a: { draft: string; filledText: string; decorations: PromptDecoration[] },
): Promise<void> {
  const previousEnhanced = await read($, enhanced);
  if (previousEnhanced !== a.draft) {
    await update($, original, () => a.draft);
  }
  await update($, enhanced, () => a.filledText);
  await update($, isUndone, () => false);
  await update($, lastDecorations, () => a.decorations);
  // A pending Undo confirm referred to the pair this fill replaced (C13).
  disarmUndo();
}

/**
 * Step 9's rest: record, phase, toast. The pair is already held, so a record
 * that fails costs the bookkeeping, not the result: the phase still goes to
 * `done` (Send and Undo stay) and the toast says so, not the usage line.
 */
async function recordSuccess($: EngineInterface, a: Success): Promise<void> {
  const toast = await recordOrFail($, a);
  await update($, phase, () => "done");
  $.ui.toast(toast);
}

/** The usage line, or the failure line when the record could not be written. */
async function recordOrFail($: EngineInterface, a: Success): Promise<string> {
  if (!(await recordOrLog($, a.call, a.post))) {
    return TOAST_RECORD_FAILED;
  }
  return capToast(
    usageText({
      model: a.run.model,
      usage: a.run.usage,
      usd: a.call.usd,
      why: a.post.why,
      hashChanged: a.call.hashChanged,
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
