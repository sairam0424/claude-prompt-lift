import { expect, test } from "claude-code/testing";
import type { ModelCompleteRequest, ModelCompleteResult, ModelUsage } from "claude-code";
import { runChain, decide, usageText, type Attempt, type Complete } from "../hooks/chain";
import { parseOptions } from "../hooks/config";

/** What a rung that answered nothing cost: the shape every Attempt carries. */
const NO_USAGE: ModelUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

test("answered first rung returns with one attempt", async () => {
  const cfg = parseOptions({});
  const fakeComplete: Complete = async (req) => {
    return {
      isAnswered: true,
      text: "enhanced prompt",
      usage: {
        input_tokens: 1400,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 6800,
        output_tokens: 310,
      },
    } as ModelCompleteResult;
  };
  
  const result = await runChain({
    complete: fakeComplete,
    chain: cfg.models,
    cfg,
    system: "test system",
    blocks: [{ text: "hello" }],
    signal: new AbortController().signal,
    isCancelled: () => false,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.text).toBe("enhanced prompt");
    expect(result.model).toBe(cfg.models[0]);
    expect(result.attempts).toEqual([
      {
        model: cfg.models[0],
        outcome: "ok",
        usage: {
          input_tokens: 1400,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 6800,
          output_tokens: 310,
        },
      },
    ]);
  }
});

test("timeout falls back, cancel does not", async () => {
  const cfg = parseOptions({});
  const calls: string[] = [];
  
  // Test timeout fallback (aborted without cancel)
  const fakeCompleteTimeout: Complete = async (req) => {
    calls.push(req.model);
    if (calls.length === 1) {
      return { isAnswered: false, reason: "aborted", usage: NO_USAGE } as never;
    }
    return {
      isAnswered: true,
      text: "done",
      usage: { input_tokens: 100, output_tokens: 50 } as ModelUsage,
    } as ModelCompleteResult;
  };

  const result1 = await runChain({
    complete: fakeCompleteTimeout,
    chain: cfg.models,
    cfg,
    system: "sys",
    blocks: [{ text: "hi" }],
    signal: new AbortController().signal,
    isCancelled: () => false,
  });

  expect(result1.ok).toBe(true);
  if (result1.ok) {
    expect(calls.length).toBe(2);
    expect(result1.attempts).toHaveLength(2);
    expect(result1.attempts[0].outcome).toBe("timeout");
    expect(result1.attempts[1].outcome).toBe("ok");
  }

  // Test cancel stops immediately
  calls.length = 0;
  const fakeCompleteCancel: Complete = async (req) => {
    calls.push(req.model);
    return { isAnswered: false, reason: "aborted", usage: NO_USAGE } as never;
  };

  const result2 = await runChain({
    complete: fakeCompleteCancel,
    chain: cfg.models,
    cfg,
    system: "sys",
    blocks: [{ text: "hi" }],
    signal: new AbortController().signal,
    isCancelled: () => true,
  });

  expect(result2.ok).toBe(false);
  if (!result2.ok) {
    expect(calls.length).toBe(1);
    expect(result2.cancelled).toBe(true);
    expect(result2.attempts[0].outcome).toBe("cancelled");
  }
});

test("empty-reply falls back and names the refusal", async () => {
  const cfg = parseOptions({});
  const calls: string[] = [];
  
  const fakeComplete: Complete = async (req) => {
    calls.push(req.model);
    if (calls.length === 1) {
      return { isAnswered: false, reason: "empty-reply", usage: NO_USAGE } as never;
    }
    return {
      isAnswered: true,
      text: "result",
      usage: { input_tokens: 100, output_tokens: 50 } as ModelUsage,
    } as ModelCompleteResult;
  };

  const result = await runChain({
    complete: fakeComplete,
    chain: cfg.models,
    cfg,
    system: "sys",
    blocks: [{ text: "hi" }],
    signal: new AbortController().signal,
    isCancelled: () => false,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(calls.length).toBe(2);
    expect(result.attempts[0].outcome).toBe("no text (possible refusal)");
    expect(result.attempts[1].outcome).toBe("ok");
  }
});

test("authentication_failed twice stops after the second", async () => {
  const cfg = parseOptions({});
  const calls: string[] = [];
  
  const fakeComplete: Complete = async (req) => {
    calls.push(req.model);
    return {
      isAnswered: false,
      reason: "api-error",
      status: 401,
      error: "authentication_failed",
    } as never;
  };

  const result = await runChain({
    complete: fakeComplete,
    chain: cfg.models,
    cfg,
    system: "sys",
    blocks: [{ text: "hi" }],
    signal: new AbortController().signal,
    isCancelled: () => false,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(calls.length).toBe(2); // first + one fallback before stopping
    expect(result.attempts[0].outcome).toBe("authentication_failed");
    expect(result.attempts[1].outcome).toBe("authentication_failed");
  }
});

test("invalid_request stops at once", async () => {
  const cfg = parseOptions({});
  const calls: string[] = [];
  
  const fakeComplete: Complete = async (req) => {
    calls.push(req.model);
    return {
      isAnswered: false,
      reason: "api-error",
      status: 400,
      error: "invalid_request",
    } as never;
  };

  const result = await runChain({
    complete: fakeComplete,
    chain: cfg.models,
    cfg,
    system: "sys",
    blocks: [{ text: "hi" }],
    signal: new AbortController().signal,
    isCancelled: () => false,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(calls.length).toBe(1);
    expect(result.attempts[0].outcome).toBe("invalid_request");
  }
});

test("a thrown complete counts as refused and moves on", async () => {
  const cfg = parseOptions({});
  const calls: string[] = [];
  
  const fakeComplete: Complete = async (req) => {
    calls.push(req.model);
    if (calls.length === 1) {
      throw new Error("model refused");
    }
    return {
      isAnswered: true,
      text: "result",
      usage: { input_tokens: 100, output_tokens: 50 } as ModelUsage,
    } as ModelCompleteResult;
  };

  const result = await runChain({
    complete: fakeComplete,
    chain: cfg.models,
    cfg,
    system: "sys",
    blocks: [{ text: "hi" }],
    signal: new AbortController().signal,
    isCancelled: () => false,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(calls.length).toBe(2);
    expect(result.attempts[0].outcome).toBe("refused");
    expect(result.attempts[1].outcome).toBe("ok");
  }
});

test("effort is omitted for models outside effortModels and timeouts differ per rung", async () => {
  const cfg = parseOptions({
    models: "a,b,c",
    effortModels: "a,b", // only a and b get effort: 'low'
    timeoutMsFirst: 60000,
    timeoutMsNext: 20000,
  });

  const requests: ModelCompleteRequest[] = [];
  const fakeComplete: Complete = async (req) => {
    requests.push(req);
    return { isAnswered: false, reason: "aborted", usage: NO_USAGE } as never;
  };

  await runChain({
    complete: fakeComplete,
    chain: cfg.models,
    cfg,
    system: "sys",
    blocks: [{ text: "hi" }],
    signal: new AbortController().signal,
    isCancelled: () => false,
  });

  expect(requests).toHaveLength(3);
  
  // First rung: model 'a', should have effort: 'low' and timeout 60000
  expect(requests[0].model).toBe("a");
  expect(requests[0].effort).toBe("low");
  expect(requests[0].timeoutMs).toBe(60000);

  // Second rung: model 'b', should have effort: 'low' and timeout 20000
  expect(requests[1].model).toBe("b");
  expect(requests[1].effort).toBe("low");
  expect(requests[1].timeoutMs).toBe(20000);

  // Third rung: model 'c', should NOT have effort key and timeout 20000
  expect(requests[2].model).toBe("c");
  expect(requests[2].effort).toBeUndefined();
  expect(requests[2].timeoutMs).toBe(20000);
});

test("usageText formats tokens, dollars and attempts", async () => {
  const usage: ModelUsage = {
    input_tokens: 1400,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 6800,
    output_tokens: 310,
  };

  const text = usageText({
    model: "us.anthropic.claude-fable-5-1",
    usage,
    usd: 0.04027,
    why: "",
    hashChanged: false,
    attempts: [
      { model: "us.anthropic.claude-fable-5-1", outcome: "ok", usage: NO_USAGE },
    ],
  });

  expect(text).toBe("prompt-lift: fable 5.1 · 6.8k cached · 1.4k in · 310 out · $0.04");
});

test("usageText includes optional suffixes", async () => {
  const usage: ModelUsage = {
    input_tokens: 1400,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 6800,
    output_tokens: 310,
  };

  const text = usageText({
    model: "us.anthropic.claude-fable-5-1",
    usage,
    usd: 0.04027,
    why: "context grew",
    hashChanged: true,
    attempts: [
      { model: "us.anthropic.claude-sonnet-5-5", outcome: "rate_limit", usage: NO_USAGE },
      { model: "us.anthropic.claude-fable-5-1", outcome: "ok", usage: NO_USAGE },
    ],
  });

  expect(text).toBe(
    "prompt-lift: fable 5.1 · 6.8k cached · 1.9k in · 310 out · $0.04 · context grew · (cache written) · static block changed · via sonnet 5.5: rate_limit"
  );
});

test("usageText handles no cache and low amounts", async () => {
  const usage: ModelUsage = {
    input_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 50,
  };

  const text = usageText({
    model: "us.anthropic.claude-haiku-5-5",
    usage,
    usd: 0.006,
    attempts: [{ model: "us.anthropic.claude-haiku-5-5", outcome: "ok", usage: NO_USAGE }],
  });

  expect(text).toBe("prompt-lift: haiku 5.5 · 0 cached · 500 in · 50 out · $0.006 · (no cache)");
});

test("decide rules", async () => {
  // Answered returns
  let decision = decide(
    { isAnswered: true, text: "x" } as ModelCompleteResult,
    undefined,
    false
  );
  expect(decision).toEqual({ action: "return", outcome: "ok" });

  // Aborted with cancel stops
  decision = decide(
    { isAnswered: false, reason: "aborted", usage: NO_USAGE } as never,
    undefined,
    true
  );
  expect(decision).toEqual({ action: "stop", outcome: "cancelled" });

  // Aborted without cancel falls back
  decision = decide(
    { isAnswered: false, reason: "aborted", usage: NO_USAGE } as never,
    undefined,
    false
  );
  expect(decision).toEqual({ action: "next", outcome: "timeout" });

  // Empty reply falls back
  decision = decide(
    { isAnswered: false, reason: "empty-reply", usage: NO_USAGE } as never,
    undefined,
    false
  );
  expect(decision).toEqual({ action: "next", outcome: "no text (possible refusal)" });

  // Invalid request stops
  decision = decide(
    { isAnswered: false, reason: "api-error", error: "invalid_request", status: 400, usage: NO_USAGE } as never,
    undefined,
    false
  );
  expect(decision).toEqual({ action: "stop", outcome: "invalid_request" });

  // First authentication_failed falls back
  decision = decide(
    { isAnswered: false, reason: "api-error", error: "authentication_failed", status: 401, usage: NO_USAGE } as never,
    undefined,
    false
  );
  expect(decision).toEqual({ action: "next", outcome: "authentication_failed" });

  // Second consecutive authentication_failed stops
  decision = decide(
    { isAnswered: false, reason: "api-error", error: "authentication_failed", status: 401, usage: NO_USAGE } as never,
    { model: "x", outcome: "authentication_failed", usage: NO_USAGE },
    false
  );
  expect(decision).toEqual({ action: "stop", outcome: "authentication_failed" });

  // Other api errors fall back
  decision = decide(
    { isAnswered: false, reason: "api-error", error: "rate_limit", status: 429, usage: NO_USAGE } as never,
    undefined,
    false
  );
  expect(decision).toEqual({ action: "next", outcome: "rate_limit" });

  // Unknown error with status
  decision = decide(
    { isAnswered: false, reason: "api-error", error: "unknown", status: 503, usage: NO_USAGE } as never,
    undefined,
    false
  );
  expect(decision).toEqual({ action: "next", outcome: "503" });
});
