import { atom, read } from "claude-code";
import type { EngineInterface } from "claude-code";
import type { Config } from "./config";
import { spentUsd } from "./stats";

// Spend caps (R9): a press is refused before any model call once the mod's
// own ledger — never the account's rate limits — shows a window at its cap,
// and the rows show what is left under the tighter one. The arithmetic and
// the texts are pure over the numbers; `readCapStatus` is the one engine
// read. The override atom is declared here as well as in commands.ts, which
// writes it: `read` validates against an atom made in the calling file.

const capOverride = atom(
  { plugin: "prompt-lift", key: "capOverride" } as const,
  null,
);

/** One window's cap and what is left under it, never below zero. */
export type CapWindow = { cap: number; left: number };

/**
 * The caps as they stand: each active window (cap > 0) with what is left,
 * and which a press would hit now, the session's named first.
 */
export type CapStatus = {
  session?: CapWindow;
  day?: CapWindow;
  reached?: "session" | "day";
};

/** What the two windows have spent in priced dollars (unpriced presses add nothing). */
export type Spent = { session: number; day: number };

export type CapArg =
  | { kind: "show" }
  | { kind: "set"; usd: number }
  | { kind: "invalid" }
  | { kind: "prose" };

export const CAP_USAGE =
  "prompt-lift: cap takes dollars, e.g. /prompt-lift cap 2.50";

/**
 * The session cap in force: the `cap` command's override when it set one
 * (0 = off for this session), else the option. The day cap has no override.
 */
export function sessionCap(cfg: Config, override: number | null): number {
  return override === null ? cfg.sessionCapUsd : Math.max(0, override);
}

function windowOf(cap: number, spent: number): CapWindow | undefined {
  return cap > 0 ? { cap, left: Math.max(0, cap - spent) } : undefined;
}

export function capStatus(
  spent: Spent,
  override: number | null,
  cfg: Config,
): CapStatus {
  const session = windowOf(sessionCap(cfg, override), spent.session);
  const day = windowOf(cfg.dayCapUsd, spent.day);
  // Reached once the recorded spend meets the cap, not before
  const reached =
    session !== undefined && spent.session >= session.cap
      ? "session"
      : day !== undefined && spent.day >= day.cap
        ? "day"
        : undefined;
  return {
    ...(session === undefined ? {} : { session }),
    ...(day === undefined ? {} : { day }),
    ...(reached === undefined ? {} : { reached }),
  };
}

/** The caps now, from the ledger and the override. */
export async function readCapStatus(
  $: EngineInterface,
  cfg: Config,
): Promise<CapStatus> {
  return capStatus(await spentUsd($), await read($, capOverride), cfg);
}

/** Dollars as the caps show them: to the cent, always (`$0.10`). */
export function capDollars(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** The refusal for the window a press would hit; undefined when none would. */
export function capReachedToast(status: CapStatus): string | undefined {
  if (status.reached === "session" && status.session !== undefined) {
    return `prompt-lift: session cap ${capDollars(status.session.cap)} reached · /prompt-lift cap off`;
  }
  if (status.reached === "day" && status.day !== undefined) {
    return `prompt-lift: day cap ${capDollars(status.day.cap)} reached`;
  }
  return undefined;
}

/**
 * The rows' remaining budget: the session's, or the day's marked `(day)`
 * when that window is the tighter (or the only) one; nothing with no cap.
 */
export function leftText(status: CapStatus): string | undefined {
  const { session, day } = status;
  if (day !== undefined && (session === undefined || day.left < session.left)) {
    return `${capDollars(day.left)} left (day)`;
  }
  return session === undefined ? undefined : `${capDollars(session.left)} left`;
}

function windowText(name: string, w: CapWindow): string {
  return `${name} ${capDollars(w.cap)} (${capDollars(w.left)} left)`;
}

/** The `caps:` line `status` and `cap` print: `off`, or each active window. */
export function capsLine(status: CapStatus): string {
  const windows = [
    ...(status.session === undefined
      ? []
      : [windowText("session", status.session)]),
    ...(status.day === undefined ? [] : [windowText("day", status.day)]),
  ];
  return `caps: ${windows.length === 0 ? "off" : windows.join(" · ")}`;
}

/**
 * `cap`, `cap <usd>` and `cap off` by the `model` rule: the word alone shows
 * the caps, exactly one more token sets the session's (`off` and `0` both
 * turn it off), anything longer is a draft.
 */
export function parseCapArg(args: string): CapArg {
  const tokens = args.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() !== "cap" || tokens.length > 2) {
    return { kind: "prose" };
  }
  const value = tokens[1];
  if (value === undefined) {
    return { kind: "show" };
  }
  if (value.toLowerCase() === "off") {
    return { kind: "set", usd: 0 };
  }
  const usd = Number(value);
  return Number.isFinite(usd) && usd >= 0
    ? { kind: "set", usd }
    : { kind: "invalid" };
}
