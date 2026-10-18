import type { Register } from "claude-code";
import { parseOptions } from "./config";
import { cancel, clearHeld, resetStuckPhase } from "./actions";
import { renderBand } from "./band";
import { runCommand } from "./commands";
import { isCallInFlight } from "./enhance";

export { HINT } from "./commands";

export const register: Register = (on, options) => {
  const cfg = parseOptions(options);

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "prompt-lift",
      description:
        "Enhance the prompt from the project instructions and skills",
      argumentHint: "<text> | undo | model <id> | status | diff | probe",
    });
    if (cfg.pricesIssue) {
      $.ui.log(cfg.pricesIssue);
    }
    await resetStuckPhase($, isCallInFlight);
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
  // ends what Undo could restore, but only once the prompt entered: a drop by
  // a lower hook or the engine leaves the text in the box, so the pair stays
  // and Undo still restores the pre-enhance words (G6). An engine-made submit
  // can arrive with no origin stamped, so read it softly.
  on("prompt.submit", async ($, e, next) => {
    const r = await next(e);
    if (r.drop === undefined && e.origin?.kind === "composer") {
      await clearHeld($);
    }
    return r;
  }).catch(($, e, next) => next(e));

  // The band (§5.1): one row chained above whatever is drawn beneath.
  on("ui.render", { component: "AbovePrompt" }, ($, e, next) =>
    renderBand($, e, next, cfg),
  );

  on("command.run", { command: "prompt-lift" }, ($, e) =>
    runCommand($, cfg, e.args),
  );
};
