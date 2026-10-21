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
    };
  }
}
