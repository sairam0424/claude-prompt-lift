import { atom, read } from "claude-code";
import type { EngineInterface } from "claude-code";
import type { Config } from "./config";

// Conversation tail override (R10): null = follow config; 0 = off this session;
// N > 0 = include the last N messages this session.
export const tailOverride = atom(
  { plugin: "prompt-lift", key: "tailOverride" } as const,
  null,
);

/**
 * The effective tail count: the override when set, else the config setting
 * (0 when `includeConversation` is false, `conversationMessages` when true).
 */
export function tailCount(cfg: Config, override: number | null): number {
  if (override !== null) {
    return override;
  }
  return cfg.includeConversation ? cfg.conversationMessages : 0;
}

/**
 * Read the effective tail count from the state and config (R10).
 */
export async function readTailCount(
  $: EngineInterface,
  cfg: Config,
): Promise<number> {
  const override = await read($, tailOverride);
  return tailCount(cfg, override);
}
