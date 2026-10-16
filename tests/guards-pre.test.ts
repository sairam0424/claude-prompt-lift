import { expect, test } from "claude-code/testing";
import { preGuard } from "../hooks/guards";
import { parseOptions } from "../hooks/config";

const cfg = parseOptions({});

test("slash, bang and hash drafts are refused", async () => {
  for (const d of ["/commit", "!ls", "# note"]) {
    expect(preGuard(d, cfg, undefined)).toEqual({
      ok: false,
      toast: "prompt-master: commands and shell lines are sent as typed",
    });
  }
});

test("reply-like drafts are refused at any length", async () => {
  expect(
    preGuard("yes, go ahead with option B for now", cfg, undefined).ok,
  ).toBe(false);
  expect(preGuard("fix the flaky test", cfg, "Option A or B?").ok).toBe(false);
  expect(preGuard("fix the flaky test in auth", cfg, "Done.").ok).toBe(true);
});

test("length floors and ceilings", async () => {
  expect(preGuard("fix bug", cfg, undefined)).toEqual({
    ok: false,
    toast: "prompt-master: under 3 words, nothing to enhance",
  });
  expect(preGuard("x ".repeat(2001), cfg, undefined).ok).toBe(false);
});
