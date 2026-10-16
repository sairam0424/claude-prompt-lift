import type { ModelCompleteRequest, ModelCompleteResult, ModelTextBlock, ModelUsage } from "claude-code";
import type { Config } from "./config";
import { shortModel, estimateUsd } from "./config";

export type Attempt = {
  model: string;
  outcome: string;
};

export type ChainOk = {
  ok: true;
  text: string;
  usage: ModelUsage;
  model: string;
  attempts: Attempt[];
};

export type ChainFail = {
  ok: false;
  cancelled: boolean;
  attempts: Attempt[];
};

export type Complete = (
  req: ModelCompleteRequest,
  opts: { signal: AbortSignal }
) => Promise<ModelCompleteResult>;

export function decide(
  r: ModelCompleteResult,
  previous: Attempt | undefined,
  isCancelled: boolean
): { outcome: string; action: "return" | "next" | "stop" } {
  // Answered → return
  if ("isAnswered" in r && r.isAnswered) {
    return { outcome: "ok", action: "return" };
  }

  // Aborted + cancelled → stop
  if ("reason" in r && r.reason === "aborted" && isCancelled) {
    return { outcome: "cancelled", action: "stop" };
  }

  // Aborted (no cancel) → next (timeout)
  if ("reason" in r && r.reason === "aborted") {
    return { outcome: "timeout", action: "next" };
  }

  // Empty reply → next
  if ("reason" in r && r.reason === "empty-reply") {
    return { outcome: "no text (possible refusal)", action: "next" };
  }

  // API errors
  if ("reason" in r && r.reason === "api-error") {
    const error = (r as any).error;
    
    // invalid_request → stop
    if (error === "invalid_request") {
      return { outcome: "invalid_request", action: "stop" };
    }

    // authentication_failed: stop if previous was also authentication_failed, else next
    if (error === "authentication_failed") {
      if (previous?.outcome === "authentication_failed") {
        return { outcome: "authentication_failed", action: "stop" };
      }
      return { outcome: "authentication_failed", action: "next" };
    }

    // Other errors: return error kind, or status if error is 'unknown' and status is non-null
    const status = (r as any).status;
    if (error === "unknown" && status !== null && status !== undefined) {
      return { outcome: String(status), action: "next" };
    }
    return { outcome: error, action: "next" };
  }

  // Fallback (shouldn't happen)
  return { outcome: "unknown", action: "next" };
}

export async function runChain(a: {
  complete: Complete;
  chain: readonly string[];
  cfg: Config;
  system: string;
  blocks: readonly ModelTextBlock[];
  signal: AbortSignal;
  isCancelled: () => boolean;
  onAttempt?: (model: string, index: number) => void;
}): Promise<ChainOk | ChainFail> {
  const attempts: Attempt[] = [];
  let previous: Attempt | undefined = undefined;

  for (let index = 0; index < a.chain.length; index++) {
    const model = a.chain[index];
    
    // Call onAttempt callback if provided
    if (a.onAttempt) {
      a.onAttempt(model, index);
    }

    // Build request
    const req: ModelCompleteRequest = {
      model,
      system: a.system,
      prompt: a.blocks,
      maxTokens: a.cfg.maxTokens,
      timeoutMs: index === 0 ? a.cfg.timeoutMsFirst : a.cfg.timeoutMsNext,
    };

    // Add effort key only if model is in effortModels
    if (a.cfg.effortModels.has(model)) {
      (req as any).effort = "low";
    }

    let result: ModelCompleteResult;
    let outcome: string;

    try {
      result = await a.complete(req, { signal: a.signal });
      const decision = decide(result, previous, a.isCancelled());
      outcome = decision.outcome;

      const attempt: Attempt = { model, outcome };
      attempts.push(attempt);

      if (decision.action === "return") {
        // Success!
        return {
          ok: true,
          text: (result as any).text,
          usage: (result as any).usage,
          model,
          attempts,
        };
      }

      if (decision.action === "stop") {
        // Stop the chain
        return {
          ok: false,
          cancelled: outcome === "cancelled",
          attempts,
        };
      }

      // decision.action === "next", continue to next model
      previous = attempt;
    } catch (err) {
      // Thrown complete → attempt outcome 'refused', next
      outcome = "refused";
      const attempt: Attempt = { model, outcome };
      attempts.push(attempt);
      previous = attempt;
      // Continue to next model
    }
  }

  // Exhausted the chain
  return {
    ok: false,
    cancelled: false,
    attempts,
  };
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + "k";
  }
  return String(count);
}

function formatDollars(usd: number): string {
  if (usd < 0.01) {
    return "$" + usd.toFixed(3);
  }
  return "$" + usd.toFixed(2);
}

export function usageText(a: {
  model: string;
  usage: ModelUsage;
  usd: number;
  why?: string;
  hashChanged?: boolean;
  attempts: readonly Attempt[];
}): string {
  const model = shortModel(a.model);
  
  const inputTokens = (a.usage.input_tokens ?? 0) + (a.usage.cache_creation_input_tokens ?? 0);
  const cachedTokens = a.usage.cache_read_input_tokens ?? 0;
  const outputTokens = a.usage.output_tokens ?? 0;

  const parts: string[] = [
    `prompt-master: ${model}`,
    `${formatTokens(cachedTokens)} cached`,
    `${formatTokens(inputTokens)} in`,
    `${outputTokens} out`,
    formatDollars(a.usd),
  ];

  let text = parts.join(" · ");

  // Add optional suffixes
  if (a.why && a.why.length > 0) {
    text += ` · ${a.why}`;
  }

  const cacheCreation = a.usage.cache_creation_input_tokens ?? 0;
  if (cacheCreation > 0) {
    text += " · (cache written)";
  } else if (cachedTokens === 0 && cacheCreation === 0) {
    text += " · (no cache)";
  }

  if (a.hashChanged) {
    text += " · static block changed";
  }

  // Add failed attempts
  const failedAttempts = a.attempts.slice(0, -1); // All except the last (answering) one
  for (const attempt of failedAttempts) {
    if (attempt.outcome !== "ok") {
      text += ` · via ${shortModel(attempt.model)}: ${attempt.outcome}`;
    }
  }

  return text;
}
