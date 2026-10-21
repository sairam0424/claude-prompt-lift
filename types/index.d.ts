export type LastUsage = {
  model: string;
  input: number;
  cached: number;
  written: number;
  output: number;
  /** Dollars by the price table; null when the model has no row there. */
  usd: number | null;
  attempts: string[];
  why: string;
  addedWords: number;
  skills: number;
  hashChanged: boolean;
  /**
   * How many rungs the chain had at the press; the one that answered is
   * `attempts.length`, so the row says `N of M` (R25). Absent on a row a
   * 0.5.0 session wrote: the row omits it then.
   */
  rungs?: number;
  /**
   * From the press to the record, in milliseconds: two reads of `$.clock`,
   * no ticks (R25). Absent on a row a 0.5.0 session wrote: the row omits it.
   */
  elapsedMs?: number;
};

/**
 * Why the last press ended without a fill, kept for the band's row until the
 * next action (R25). `text` is the toast's reason less its `prompt-lift: `
 * prefix and its cost; `usd` is what the press cost (0 when no call was
 * made), null when the model has no price.
 */
export type Verdict = {
  kind: "refused" | "failed" | "cancelled";
  text: string;
  usd: number | null;
};

declare module "claude-code" {
  interface PluginState {
    "prompt-lift": {
      phase: "idle" | "running" | "done";
      original: string | null;
      enhanced: string | null;
      isUndone: boolean;
      lastDecorations: PromptDecoration[] | null;
      model: string;
      runningModel: string;
      lastUsage: LastUsage | null;
      blockHash: string;
      staticChars: number;
      requestId: number;
      noCacheStreak: number;
      sessionPresses: number;
      sessionUsd: number;
      sessionUnpriced: number;
      /** The session cap `/prompt-lift cap` set (0 = off); null = the option (R9). */
      capOverride: number | null;
      /** The conversation tail `/prompt-lift tail` set; null = the option (R10). */
      tailOverride: number | null;
      /** The last press's refusal, failure or cancel, shown until the next action (R25). */
      lastVerdict: Verdict | null;
    };
  }
}
