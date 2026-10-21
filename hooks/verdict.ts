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
 * call was made: the toast names no cost and the verdict carries none.
 */
export type Stop = (
  kind: VerdictKind,
  toast: string,
  cost?: { usd: number | undefined },
) => void;

const PLUGIN_LEAD = "prompt-lift: ";
/** A cancel's own word, which its headline already says (`✗ Cancelled`). */
const CANCEL_LEAD = "cancelled, ";

/**
 * A toast's reason, less its lead: the plugin prefix for every kind, and the
 * cancel's word only for a cancel, so a refusal or failure whose own reason
 * begins `cancelled, ` keeps it.
 */
function reasonOf(kind: VerdictKind, toast: string): string {
  const reason = toast.startsWith(PLUGIN_LEAD)
    ? toast.slice(PLUGIN_LEAD.length)
    : toast;
  return kind === "cancelled" && reason.startsWith(CANCEL_LEAD)
    ? reason.slice(CANCEL_LEAD.length)
    : reason;
}

/**
 * The row's copy of a toast: its reason, one line and capped as the toast is,
 * less the lead and the cost the toast ends with. `usd` is what the press
 * cost: left out when no call was made (the row then shows no cost), null
 * when the model has no price (R3).
 */
export function verdictOf(
  kind: VerdictKind,
  toast: string,
  usd?: number | null,
): Verdict {
  const text = capToast(reasonOf(kind, toast));
  return usd === undefined ? { kind, text } : { kind, text, usd };
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
