import { atom, read, update } from "claude-code";
import type { EngineInterface, PromptDecoration } from "claude-code";
import { disarmUndo } from "./arm";
import { capToast, usageText, type ChainOk } from "./chain";
import type { PostOk } from "./guards";
import { recordOrLog, type AnsweredCall } from "./stats";

// Step 9 of the Enhance flow (spec §5.3, §12): the pair Undo restores, held
// right after the fill, then the record, the phase and the toast. The atoms
// are declared here as well as in enhance.ts and actions.ts: `read` and
// `update` validate against an atom made in the calling file, and the same
// plugin and key name the same value.

const phase = atom({ plugin: "prompt-master", key: "phase" } as const, "idle");
const original = atom(
  { plugin: "prompt-master", key: "original" } as const,
  null,
);
const enhanced = atom(
  { plugin: "prompt-master", key: "enhanced" } as const,
  null,
);
const isUndone = atom(
  { plugin: "prompt-master", key: "isUndone" } as const,
  false,
);
const lastDecorations = atom(
  { plugin: "prompt-master", key: "lastDecorations" } as const,
  null,
);

const TOAST_RECORD_FAILED =
  "prompt-master: saved the result, but recording its cost failed";

/** A press the box took: the chain's reply, the rewrite and the judged call. */
export type Success = { run: ChainOk; post: PostOk; call: AnsweredCall };

/**
 * Step 9's first write, right after the fill: the pair Undo restores, held
 * before anything about the call is recorded (§5.3, §12).
 */
export async function holdPair(
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
export async function recordSuccess(
  $: EngineInterface,
  a: Success,
): Promise<void> {
  const toast = await recordOrFail($, a);
  await update($, phase, () => "done");
  $.ui.toast(toast);
}

/** The usage line, or the failure line when the record could not be written. */
async function recordOrFail($: EngineInterface, a: Success): Promise<string> {
  const rewrite = { why: a.post.why, addedWords: a.post.addedWords };
  if (!(await recordOrLog($, a.call, rewrite))) {
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
