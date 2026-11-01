import type { EngineInterface } from "claude-code";
import { log } from "./api";
import type { ChainFail } from "./chain";
import type { Config, Platform } from "./config";
import { attemptsUsd, describeAttempt, recordSpend } from "./stats";
import type { Stop } from "./verdict";

// What a press says when its chain answered nothing. Split out of enhance.ts,
// which stays under the file cap.

const TOAST_CANCELLED = "prompt-lift: cancelled, draft unchanged";
const TOAST_NO_MODELS = "prompt-lift: no models configured";

/**
 * A chain that answered nothing still paid for its rungs (G5): record that,
 * priced on the platform the press ran on (R19), then say so.
 */
export async function reportFailure(
  $: EngineInterface,
  cfg: Config,
  run: ChainFail,
  platform: Platform,
  stop: Stop,
): Promise<void> {
  if (run.attempts.length === 0) {
    stop("failed", TOAST_NO_MODELS);
    return;
  }
  const usd = attemptsUsd(run.attempts, cfg.prices, platform);
  await recordSpend($, usd);
  if (run.cancelled) {
    stop("cancelled", TOAST_CANCELLED, { usd });
    return;
  }
  const trail = run.attempts.map(describeAttempt).join(" → ");
  stop("failed", `prompt-lift: no model answered · ${trail}`, { usd });
  log($, `prompt-lift: enhance failed: ${trail}`);
}
