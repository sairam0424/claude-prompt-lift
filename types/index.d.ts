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
};

declare module "claude-code" {
  interface PromptDecoration {
    start: number;
    end: number;
    bold?: boolean;
    underline?: boolean;
  }

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
    };
  }
}
