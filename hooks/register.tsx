import type { Register } from "claude-code";
import { parseOptions } from "./config";
import { enhance } from "./enhance";

export const HINT =
  "prompt-master: type /prompt-master <your prompt>, press ctrl+x b, or click Enhance";

// Sub-words of /prompt-master (spec C18); their flows arrive with later tasks.
const SUB_WORDS: ReadonlySet<string> = new Set([
  "undo",
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
    return next(e);
  });

  on("command.run", { command: "prompt-master" }, async ($, e) => {
    const args = e.args.trim();
    if (args === "") {
      return { text: HINT };
    }
    const [first = ""] = args.split(/\s+/);
    if (SUB_WORDS.has(first.toLowerCase())) {
      return { text: NOT_BUILT };
    }
    await enhance($, cfg, { kind: "args", text: args });
    return {};
  });
};
