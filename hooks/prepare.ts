import type { EngineInterface, SessionMessage } from "claude-code";
import type { Config } from "./config";
import { processExtraRules, rulesText } from "./rules";
import {
  buildDynamicBlock,
  buildStaticBlock,
  knownSkillSet,
  matchSkills,
} from "./context";
import { basename, gatherContext } from "./gather";

// Step 4 of the Enhance flow (spec §5.3): the two prompt blocks a press sends
// (§6.1 static, §6.2 dynamic), built from what gatherContext read, together
// with what the later steps need of that reading. No state lives here.

export type Prepared = {
  root: string;
  rootDirs: string[];
  staticBlock: string;
  dynamicBlock: string;
  relevantCount: number;
  knownSkills: Set<string>;
  listedSkills: ReadonlySet<string>;
  descriptions: Map<string, string>;
  documentsText: string;
  /** The user's own `extraRules`, as block 0 carries it (rule 11). */
  userRulesText: string;
};

export async function prepare(
  $: EngineInterface,
  cfg: Config,
  draft: string,
  rows: readonly SessionMessage[],
): Promise<Prepared> {
  const ctx = await gatherContext($, cfg, draft, rows);
  const knownSkills = knownSkillSet(ctx, cfg.skillExclude);
  const staticBlock = buildStaticBlock({
    rules: rulesText(cfg.filePrefix, cfg.extraRules),
    project: basename(ctx.root),
    documents: ctx.documents,
    skillNames: ctx.skillNames,
    knownSkills,
  });
  const relevant = matchSkills(
    draft,
    ctx.commands,
    new Set(ctx.skillNames),
    cfg.relevantSkills,
  );
  const dynamicBlock = buildDynamicBlock({
    relevant,
    subproject: ctx.subproject,
    conversation: ctx.conversation,
    draft,
  });
  return {
    root: ctx.root,
    rootDirs: ctx.rootDirs,
    staticBlock,
    dynamicBlock,
    relevantCount: relevant.length,
    knownSkills,
    listedSkills: new Set(ctx.skillNames),
    descriptions: ctx.descriptions,
    documentsText: ctx.documentsText,
    userRulesText: processExtraRules(cfg.extraRules),
  };
}
