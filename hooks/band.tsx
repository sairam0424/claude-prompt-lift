import { atom, read } from "claude-code";
import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import type { LastUsage } from "../types";
import type { Config } from "./config";
import { shortModel } from "./config";
import { costText, formatTokens } from "./chain";
import { enhance, isCallInFlight } from "./enhance";
import { cancel, send, undo } from "./actions";
import { resolveChain } from "./gather";
import { leftText, readCapStatus } from "./caps";
import { readTailCount } from "./tail";

// The band (spec §5.1; C12, C17, C19): one row above the prompt, chained
// above whatever the engine and the plugins beneath draw there. It redraws
// only when a value it reads changes or the engine redraws the band; it never
// calls the model. The atoms are declared here as well as in enhance.ts:
// `read` validates against an atom made in the calling file, and the same
// plugin and key name the same value.

const phase = atom({ plugin: "prompt-lift", key: "phase" } as const, "idle");
const isUndone = atom(
  { plugin: "prompt-lift", key: "isUndone" } as const,
  false,
);
const model = atom({ plugin: "prompt-lift", key: "model" } as const, "");
const runningModel = atom(
  { plugin: "prompt-lift", key: "runningModel" } as const,
  "",
);
const lastUsage = atom(
  { plugin: "prompt-lift", key: "lastUsage" } as const,
  null,
);
const noCacheStreak = atom(
  { plugin: "prompt-lift", key: "noCacheStreak" } as const,
  0,
);

/** Presses without a cache hit before the row suggests a cheaper rung (C19). */
const NO_CACHE_HINT_AFTER = 3;
export const RESTORED_ROW = "restored your draft";
const NO_CACHE_HINT = "cache not hitting — consider /prompt-lift model haiku";

export type BandEvent = RenderInput<"AbovePrompt">;
export type BandNext = (e: BandEvent) => Promise<RenderElement>;

/** The idle row: the keys and the first rung, then what a cap leaves (R9) and tail N (R10). */
export function idleRowText(
  firstRung: string,
  left?: string,
  tail?: number,
): string {
  const row = `ctrl+x b · or ctrl+x tab, e · prompt-lift: ${shortModel(firstRung)}`;
  const parts = [row];
  if (left !== undefined) {
    parts.push(left);
  }
  if (tail !== undefined && tail > 0) {
    parts.push(`tail ${tail}`);
  }
  return parts.join(" · ");
}

export function runningRowText(modelId: string): string {
  return `Enhancing with ${shortModel(modelId)}…`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The done row: the last call's usage, what the rewrite added, then what a
 * cap leaves (R9), tail N (R10); the no-cache hint stays last.
 */
export function doneRowText(
  usage: LastUsage,
  streak: number,
  left?: string,
  tail?: number,
): string {
  const hint = streak >= NO_CACHE_HINT_AFTER ? [NO_CACHE_HINT] : [];
  return [
    shortModel(usage.model),
    `${formatTokens(usage.cached)} cached`,
    `${formatTokens(usage.input + usage.written)} in`,
    `${usage.output} out`,
    costText(usage.usd ?? undefined),
    `+${plural(usage.addedWords, "word")}`,
    plural(usage.skills, "skill"),
    ...(left === undefined ? [] : [left]),
    ...(tail !== undefined && tail > 0 ? [`tail ${tail}`] : []),
    ...hint,
  ].join(" · ");
}

/** The `ui.render { component: 'AbovePrompt' }` hook's body. */
export async function renderBand(
  $: EngineInterface,
  e: BandEvent,
  next: BandNext,
  cfg: Config,
): Promise<RenderElement> {
  if (e.props.hasSurvey) {
    return next(e);
  }
  const below = await next(e);
  const row = await drawRow($, e, cfg);
  const { Box } = $.ui.resolve(e);
  // The mods beneath share this slot: one blank row keeps the band and their
  // drawing apart; with nothing beneath the gap has no second child to open.
  return (
    <Box flexDirection="column" rowGap={1}>
      {row}
      {below}
    </Box>
  );
}

/** The first rung as the last press used it, or as the chain resolves now. */
async function firstRung($: EngineInterface, cfg: Config): Promise<string> {
  const used = await read($, model);
  if (used !== "") {
    return used;
  }
  return (await resolveChain($, cfg))[0] ?? "";
}

async function drawRow(
  $: EngineInterface,
  e: BandEvent,
  cfg: Config,
): Promise<RenderElement> {
  const { Box, Button, Text } = $.ui.resolve(e);
  const current = await read($, phase);
  // A `running` no call backs is one a dropped environment left (§5.3 resets):
  // drawn as idle here and reset by the next command; a render never writes.
  const isRunning = current === "running" && isCallInFlight();
  const isDone = current === "done";
  if (isRunning) {
    const running = await read($, runningModel);
    return (
      <Box gap={1}>
        <Button key="cancel" label="Cancel (c)" hotkey="c" onPress={cancel} />
        <Text dimColor wrap="truncate-end">
          {runningRowText(running)}
        </Text>
      </Box>
    );
  }
  const left = leftText(await readCapStatus($, cfg));
  const tail = await readTailCount($, cfg);
  const action = cfg.enhanceAction === "" ? {} : { action: cfg.enhanceAction };
  const enhanceButton = (
    <Button
      key="enhance"
      label="Enhance (e)"
      hotkey="e"
      {...action}
      onPress={() => enhance($, cfg, { kind: "box" })}
    />
  );
  if (!isDone) {
    return (
      <Box gap={1}>
        {enhanceButton}
        <Text dimColor wrap="truncate-end">
          {idleRowText(await firstRung($, cfg), left, tail)}
        </Text>
      </Box>
    );
  }
  const undone = await read($, isUndone);
  const usage = await read($, lastUsage);
  const streak = await read($, noCacheStreak);
  const summary = usage === null ? "" : doneRowText(usage, streak, left, tail);
  return (
    <Box gap={1}>
      {enhanceButton}
      <Button
        key="send"
        label={e.props.isWorking ? "Send (queues)" : "Send (s)"}
        hotkey="s"
        onPress={() => send($)}
      />
      <Button
        key="undo"
        label={undone ? "Redo (u)" : "Undo (u)"}
        hotkey="u"
        onPress={() => undo($)}
      />
      <Text dimColor wrap="truncate-end">
        {undone ? RESTORED_ROW : summary}
      </Text>
    </Box>
  );
}
