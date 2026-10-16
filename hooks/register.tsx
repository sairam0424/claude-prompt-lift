import type { Register } from "claude-code";
import { parseOptions } from "./config";
import { enhance } from "./enhance";
import { cancel, clearHeld, resetStuckPhase, undo } from "./actions";

export const HINT =
  "prompt-master: type /prompt-master <your prompt>, press ctrl+x b, or click Enhance";

// Sub-words of /prompt-master (spec C18) whose flows arrive with later tasks.
const NOT_BUILT_WORDS: ReadonlySet<string> = new Set([
  "model",
  "status",
  "diff",
  "probe",
]);
const NOT_BUILT = "prompt-master: not built yet";

export const register: Register = (on, options) => {
  const cfg = parseOptions(options);

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "prompt-master",
      description:
        "Enhance the prompt from the project instructions and skills",
      argumentHint: "<text> | undo | model <id> | status | diff | probe",
    });
    await resetStuckPhase($);
    return next(e);
  });

  // The last chance to cut a call still running when the session goes (§5.3).
  on("session.end", ($, e, next) => {
    cancel();
    return next(e);
  });

  // /clear, a resume and a fork start with nothing held (§5.3 resets); an
  // observer, so a failure lets the event go on.
  on(
    "classic.SessionStart",
    { source: ["clear", "resume", "fork"] },
    async ($, e, next) => {
      await clearHeld($);
      return next(e);
    },
  ).catch(($, e, next) => next(e));

  // C14: the one prompt.* hook, a passthrough observer. The person's own Enter
  // ends what Undo could restore; the prompt always goes on, clearing or not.
  // An engine-made submit can arrive with no origin stamped, so read it softly.
  on("prompt.submit", async ($, e, next) => {
    if (e.origin?.kind === "composer") {
      await clearHeld($);
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "prompt-master" }, async ($, e) => {
    const args = e.args.trim();
    if (args === "") {
      return { text: HINT };
    }
    const [first = ""] = args.split(/\s+/);
    const word = first.toLowerCase();
    if (word === "undo") {
      await undo($);
      return {};
    }
    if (NOT_BUILT_WORDS.has(word)) {
      return { text: NOT_BUILT };
    }
    await enhance($, cfg, { kind: "args", text: args });
    return {};
  });
};
