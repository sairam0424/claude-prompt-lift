import { atom, read, update } from "claude-code";
import type { EngineInterface, StateValue } from "claude-code";
import type { Config } from "./config";
import { SYSTEM } from "./rules";
import { postProcess, preGuard, type PostOk } from "./guards";
import { prepare, type Prepared } from "./prepare";
import {
  capToast,
  costText,
  cut,
  runChain,
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
  judgeCall,
  recordOrLog,
  recordSpend,
  type AnsweredCall,
} from "./stats";
import { holdPair, recordSuccess } from "./record";
import { capReachedToast, readCapStatus } from "./caps";

// The Enhance flow (spec §5.3 steps 1–9) and the session state it writes.
// Every atom this file reads or writes is declared here (the usage atoms live
// in stats.ts, the held pair's in record.ts): `read` and `update` only
// validate against an atom made in the file that calls them.

export const phase = atom(
  { plugin: "prompt-lift", key: "phase" } as const,
  "idle",
);
export const model = atom(
  { plugin: "prompt-lift", key: "model" } as const,
  "",
);
export const runningModel = atom(
  { plugin: "prompt-lift", key: "runningModel" } as const,
  "",
);
export const requestId = atom(
  { plugin: "prompt-lift", key: "requestId" } as const,
  0,
);

const TOAST_BUSY = "prompt-lift: already enhancing";
const TOAST_FINE = "prompt-lift: already specific, left as is";
const TOAST_DRAFT_CHANGED =
  "prompt-lift: draft changed while enhancing, left as is";
const TOAST_MISSING_PATH =
  "prompt-lift: named a file that does not exist, kept your prompt";
const TOAST_CANCELLED = "prompt-lift: cancelled, draft unchanged";
const TOAST_NO_MODELS = "prompt-lift: no models configured";
export const TOAST_NOT_TAKEN =
  "prompt-lift: the prompt box did not take the text";

export type EnhanceSource = { kind: "box" } | { kind: "args"; text: string };

type Phase = StateValue<"prompt-lift", "phase">;

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
 * and cleared once its phase has settled; the band and the resets ask.
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
    // A same-value write (over a stale `running`) still redraws the band
    await update($, phase, () => "running");
    const draft = await readDraft($, source);
    const rows = await $.session.messages();
    const guard = preGuard(draft, cfg, lastAssistantText(rows));
    if (!guard.ok) {
      $.ui.toast(guard.toast);
      return;
    }
    // R9: a window at its cap refuses the press the same way, before any call
    const capped = capReachedToast(await readCapStatus($, cfg));
    if (capped !== undefined) {
      $.ui.toast(capped);
      return;
    }
    const prepared = await prepare($, cfg, draft, rows);
    const run = await callChain($, cfg, prepared, abort.signal);
    if (!run.ok) {
      await reportFailure($, cfg, run);
      return;
    }
    // Judged now, written once the outcome is known: after the pair on a fill.
    // Owed from the answer on, so the read that judges the hash may throw.
    unrecorded = judgeCall(cfg, {
      run,
      staticBlock: prepared.staticBlock,
      relevantCount: prepared.relevantCount,
    });
    const call = await assessCall($, unrecorded);
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
    // A record that fails costs the bookkeeping, never the verdict's toast
    if (!post.ok) {
      unrecorded = undefined;
      await recordOrLog($, call);
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
      await recordOrLog($, call);
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
    $.ui.toast(capToast(`prompt-lift: enhance failed (${message})`));
    $.ui.log(`prompt-lift: enhance failed: ${String(err)}`, { to: "debug" });
  } finally {
    // In flight until the phase has settled: a command in that window must
    // not reset this press's phase, and a press then is rightly told "busy".
    try {
      await settle($, before);
    } finally {
      busy = false;
      controller = undefined;
    }
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
      $.ui.log(`prompt-lift: runningModel: ${errorMessage(err)}`, {
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
  $.ui.toast(withCost(`prompt-lift: no model answered · ${trail}`, usd));
  $.ui.log(`prompt-lift: enhance failed: ${trail}`);
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
    $.ui.log(`prompt-lift: could not reset the phase: ${errorMessage(err)}`, {
      to: "debug",
    });
  }
}
