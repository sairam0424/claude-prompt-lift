import { atom, read, update } from "claude-code";
import type { EngineInterface, StateDollar } from "claude-code";
import type { Verdict } from "../types";
import { capToast } from "./chain";
import { errorMessage } from "./gather";

// The verdict row's state (R25): why the last press ended without a fill,
// kept in `lastVerdict` until the next action. `settle` writes it; a press,
// Enter, any /prompt-lift command, session.start and the Undo button write it
// away. Nothing times it out. The atom is declared here as well as in
// band.tsx, which reads it: `read` and `update` validate against an atom made
// in the calling file, and the same plugin and key name the same value.

const lastVerdict = atom(
  { plugin: "prompt-lift", key: "lastVerdict" } as const,
  null,
);

type VerdictKind = Verdict["kind"];

/**
 * How a press that fills nothing ends (R25): the toast now, and the verdict
 * for the row. `cost` is given when a call was made and ends the toast with
 * its dollars (`usd` undefined: the model has no price, R3); with none, no
 * call was made and the verdict's dollars are 0.
 */
export type Stop = (
  kind: VerdictKind,
  toast: string,
  cost?: { usd: number | undefined },
) => void;

/**
 * A toast's lead: the plugin prefix, and a cancel's own word, which the
 * headline already says (`✗ Cancelled`, then `draft unchanged`).
 */
const LEAD = /^prompt-lift: (?:cancelled, )?/;

/**
 * The row's copy of a toast: its reason, one line and capped as the toast is,
 * less the lead and the cost the toast ends with. `usd` is what the press
 * cost: 0 when no call was made, null when the model has no price (R3).
 */
export function verdictOf(
  kind: VerdictKind,
  toast: string,
  usd: number | null,
): Verdict {
  return { kind, text: capToast(toast.replace(LEAD, "")), usd };
}

/**
 * Keeps `verdict` for the row. A write that fails costs the row its reason,
 * never the press its phase: it is logged, and the toast has said it.
 */
export async function keepVerdict(
  $: EngineInterface,
  verdict: Verdict | undefined,
): Promise<void> {
  if (verdict === undefined) {
    return;
  }
  try {
    await update($, lastVerdict, () => verdict);
  } catch (err) {
    $.ui.log(`prompt-lift: could not keep the verdict: ${errorMessage(err)}`, {
      to: "debug",
    });
  }
}

/**
 * The next action ends the verdict. Every Enter comes through here, so with
 * none held nothing is written.
 */
export async function clearVerdict($: StateDollar): Promise<void> {
  if ((await read($, lastVerdict)) !== null) {
    await update($, lastVerdict, () => null);
  }
}
