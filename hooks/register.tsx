import type { Register } from "claude-code";
import { parseOptions } from "./config";
import { cancel, clearHeld, resetStuckPhase } from "./actions";
import { renderBand } from "./band";
import { runCommand } from "./commands";

export { HINT } from "./commands";

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
  // A /clear or a resume also forgets the held pair here, belt and braces for
  // classic.SessionStart, which an organization-managed install never runs.
  on("session.end", async ($, e, next) => {
    cancel();
    if (e.reason === "clear" || e.reason === "resume") {
      await clearHeld($);
    }
    return next(e);
  }).catch(($, e, next) => next(e));

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

  // The band (§5.1): one row chained above whatever is drawn beneath.
  on("ui.render", { component: "AbovePrompt" }, ($, e, next) =>
    renderBand($, e, next, cfg),
  );

  on("command.run", { command: "prompt-master" }, ($, e) =>
    runCommand($, cfg, e.args),
  );
};
