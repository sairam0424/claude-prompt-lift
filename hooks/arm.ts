// When the last Undo press armed the C13 confirm window (spec §10 module
// state). Its own module because actions.ts arms and reads it while
// enhance.ts disarms it on every successful fill, and enhance.ts cannot
// import actions.ts (which imports enhance.ts).

let armedAt: number | undefined;

/** The clock reading of the Undo press that armed the window, if any. */
export function undoArmedAt(): number | undefined {
  return armedAt;
}

export function armUndo(now: number): void {
  armedAt = now;
}

/** A new pair, a fill or a reset: the window no longer refers to this box. */
export function disarmUndo(): void {
  armedAt = undefined;
}
