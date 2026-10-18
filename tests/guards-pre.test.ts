import { expect, test } from "claude-code/testing";
import { preGuard } from "../hooks/guards";
import { parseOptions } from "../hooks/config";

const cfg = parseOptions({});

test("slash, bang and hash drafts are refused", async () => {
  for (const d of ["/commit", "!ls", "# note"]) {
    expect(preGuard(d, cfg, undefined)).toEqual({
      ok: false,
      toast: "prompt-lift: commands and shell lines are sent as typed",
    });
  }
});

test("reply-like drafts are refused only when short (<12 words)", async () => {
  // Short draft with reply prefix: refused (8 words)
  expect(
    preGuard("yes, go ahead with option B for now", cfg, undefined),
  ).toEqual({
    ok: false,
    toast: "prompt-lift: that reads like an answer to Claude's question",
  });

  // Short draft with 'no' prefix: refused (5 words)
  expect(preGuard("no need to add tests", cfg, undefined)).toEqual({
    ok: false,
    toast: "prompt-lift: that reads like an answer to Claude's question",
  });

  // 12-word draft with 'no' prefix: passes (12 words, threshold is <12)
  expect(
    preGuard(
      "no need to add tests, just fix src/x.ts please and report back",
      cfg,
      undefined,
    ).ok,
  ).toBe(true);

  // Draft with 'use' passes now (use removed from REPLY_PREFIX, 8 words)
  expect(
    preGuard("use zod for validation in the api layer", cfg, undefined).ok,
  ).toBe(true);

  // Question rule still works: short answer after question
  expect(preGuard("fix the flaky test", cfg, "Option A or B?").ok).toBe(false);
  expect(preGuard("fix the flaky test in auth", cfg, "Done.").ok).toBe(true);
});

test("length floors and ceilings", async () => {
  expect(preGuard("fix bug", cfg, undefined)).toEqual({
    ok: false,
    toast: "prompt-lift: under 3 words, nothing to enhance",
  });
  expect(preGuard("x ".repeat(2001), cfg, undefined).ok).toBe(false);
});
