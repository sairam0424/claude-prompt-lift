import { atom, read, update } from "claude-code";
import type { EngineInterface, StateDollar } from "claude-code";
import { armUndo, disarmUndo, undoArmedAt } from "./arm";
import { capToast } from "./chain";
import { cancel, TOAST_NOT_TAKEN, type DraftReader } from "./enhance";

// Send, Undo/Redo, Cancel and the resets (spec §5.3; C3, C11, C13, C14).
// The atoms are declared here as well as in enhance.ts: `read` and `update`
// only validate against an atom made in the calling file, and the same
// plugin and key name the same value.

const phase = atom({ plugin: "prompt-lift", key: "phase" } as const, "idle");
const original = atom(
  { plugin: "prompt-lift", key: "original" } as const,
  null,
);
const enhanced = atom(
  { plugin: "prompt-lift", key: "enhanced" } as const,
  null,
);
const isUndone = atom(
  { plugin: "prompt-lift", key: "isUndone" } as const,
  false,
);
const lastDecorations = atom(
  { plugin: "prompt-lift", key: "lastDecorations" } as const,
  null,
);

export { cancel };

/** How long a second Undo press has to confirm discarding an edit (C13). */
export const UNDO_REARM_MS = 10_000;

const TOAST_NOTHING_TO_SEND = "prompt-lift: nothing to send";
const TOAST_ENTER_ONLY =
  "prompt-lift: press Enter to send; @files and images only travel with Enter";
const TOAST_NOTHING_TO_UNDO = "prompt-lift: nothing to undo";
const TOAST_UNDO_ARM =
  "prompt-lift: box edited since Enhance; press Undo again within 10 s to discard";
const TOAST_RESTORED = "prompt-lift: restored your draft";
const TOAST_REAPPLIED = "prompt-lift: re-applied the enhanced prompt";

/**
 * `@file` mentions (`@src/a.ts`, `@~/notes.md`, an MCP `@server:resource`)
 * and pasted images travel only with Enter (C10, C11); the anchor keeps an
 * email's `@` out of it.
 */
const ENTER_ONLY = /(^|\s)@[\w./~:-]+|\[Image #\d+\]/;

/**
 * The prompt noun as Send drives it before it touches state, so a test's `$`
 * can stand in; the box is read through a DraftReader, which a test stubs.
 */
export type SendIo = {
  prompt: Pick<EngineInterface["prompt"], "submit" | "fill">;
};

/** What `submitDraft` came to; `send` toasts, logs and clears from it. */
export type SendStep =
  | { outcome: "refused"; toast: string }
  | { outcome: "dropped"; reason: string }
  | { outcome: "sent"; box: "cleared" | "changed" | "kept" };

/** C11: the toast Send answers instead of submitting, or undefined to go on. */
export function sendRefusal(boxText: string): string | undefined {
  if (boxText.trim() === "") {
    return TOAST_NOTHING_TO_SEND;
  }
  if (ENTER_ONLY.test(boxText)) {
    return TOAST_ENTER_ONLY;
  }
  return undefined;
}

/**
 * Send's steps 1–3 up to the box: submit the box as the person's own words
 * and clear it only while it still holds what was sent (C11). The engine
 * queues the prompt while a turn runs. No toast and no state here.
 */
export async function submitDraft(
  $: SendIo,
  box: DraftReader,
): Promise<SendStep> {
  const text = (await box.prompt.read()).text;
  const refusal = sendRefusal(text);
  if (refusal !== undefined) {
    return { outcome: "refused", toast: refusal };
  }
  const entered = await $.prompt.submit({ text, asUser: true });
  if (entered.drop !== undefined) {
    return { outcome: "dropped", reason: entered.drop };
  }
  if ((await box.prompt.read()).text !== text) {
    return { outcome: "sent", box: "changed" };
  }
  const cleared = await $.prompt.fill({ text: "", mode: "replace" });
  return { outcome: "sent", box: cleared.isFilled ? "cleared" : "kept" };
}

/** Send (spec §5.3): the band button's path; Enter is the other one. */
export async function send($: EngineInterface): Promise<void> {
  const step = await submitDraft($, $);
  if (step.outcome === "refused") {
    $.ui.toast(step.toast);
    return;
  }
  if (step.outcome === "dropped") {
    // The engine shows a hook's reason itself; the draft stays, Undo with it.
    $.ui.log(`prompt-lift: send dropped: ${step.reason}`, { to: "debug" });
    return;
  }
  if (step.box === "kept") {
    $.ui.log("prompt-lift: the box kept the sent text", { to: "debug" });
  }
  await clearHeld($);
}

export type UndoDecision =
  | { kind: "nothing" }
  | { kind: "arm" }
  | { kind: "undo"; text: string }
  | { kind: "redo"; text: string };

/**
 * C13: Undo acts only while the box still shows what the mod last put there
 * (or is empty); an edited box takes a second press within the window. With
 * `isUndone` the same press is Redo, guarded the same way.
 */
export function decideUndo(a: {
  boxText: string;
  original: string | null;
  enhanced: string | null;
  isUndone: boolean;
  armedAt: number | undefined;
  now: number;
}): UndoDecision {
  if (a.original === null) {
    return { kind: "nothing" };
  }
  // The `enhanced` write can fail after `original` was held (§12): Undo then
  // restores the draft alone, and there is nothing to redo.
  const target: UndoDecision = a.isUndone
    ? a.enhanced === null
      ? { kind: "nothing" }
      : { kind: "redo", text: a.enhanced }
    : { kind: "undo", text: a.original };
  if (target.kind === "nothing") {
    return target;
  }
  const shown = a.isUndone ? a.original : a.enhanced;
  const isClean = a.boxText === "" || a.boxText === shown;
  const isArmed = a.armedAt !== undefined && a.now - a.armedAt <= UNDO_REARM_MS;
  return !isClean && !isArmed ? { kind: "arm" } : target;
}

/** Undo / Redo (spec §5.3): the band button and `/prompt-lift undo`. */
export async function undo($: EngineInterface): Promise<void> {
  const now = await $.clock.now();
  const decision = decideUndo({
    boxText: (await $.prompt.read()).text,
    original: await read($, original),
    enhanced: await read($, enhanced),
    isUndone: await read($, isUndone),
    armedAt: undoArmedAt(),
    now,
  });
  if (decision.kind === "nothing") {
    $.ui.toast(TOAST_NOTHING_TO_UNDO);
    return;
  }
  if (decision.kind === "arm") {
    armUndo(now);
    $.ui.toast(TOAST_UNDO_ARM);
    return;
  }
  disarmUndo();
  const isRedo = decision.kind === "redo";
  const decorations = isRedo ? await read($, lastDecorations) : null;
  const filled = await $.prompt.fill({
    text: decision.text,
    mode: "replace",
    ...(decorations && { decorations }),
  });
  if (!filled.isFilled) {
    const cause = filled.refusal ?? "refused";
    $.ui.toast(capToast(`${TOAST_NOT_TAKEN} (${cause})`));
    return;
  }
  await update($, isUndone, () => !isRedo);
  $.ui.toast(isRedo ? TOAST_REAPPLIED : TOAST_RESTORED);
}

/**
 * What Send, Enter, /clear and a resume forget: the pair and the phase. Every
 * Enter comes through here, so nothing held and an idle phase write nothing.
 */
export async function clearHeld($: EngineInterface): Promise<void> {
  disarmUndo();
  const isHeld = (await read($, original)) !== null;
  const isIdle = (await read($, phase)) === "idle";
  if (!isHeld && isIdle) {
    return;
  }
  await update($, original, () => null);
  await update($, enhanced, () => null);
  await update($, isUndone, () => false);
  await update($, lastDecorations, () => null);
  await update($, phase, () => "idle");
}

/**
 * A phase a dropped environment left at `running` is reset at session.start
 * and when a command runs (§5.3 resets). With a pair held (this press's or an
 * earlier one's) the phase goes to `done`, so the Send/Undo row returns after
 * a hot reload; otherwise to `idle`. The caller hands in how to ask whether a
 * call is in flight (enhance.ts owns that; importing it here would make a
 * cycle), asked after the reads: a live call's phase is never reset, not
 * even one that began while the phase was being read.
 */
export async function resetStuckPhase(
  $: StateDollar,
  isInFlight: () => boolean,
): Promise<void> {
  if ((await read($, phase)) !== "running") {
    return;
  }
  const isHeld = (await read($, original)) !== null;
  if (isInFlight()) {
    return;
  }
  await update($, phase, () => (isHeld ? "done" : "idle"));
}
