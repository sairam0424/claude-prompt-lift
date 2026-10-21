import { atom, read } from "claude-code";
import type { EngineInterface, RenderElement, RenderInput } from "claude-code";
import type { Config } from "./config";
import { hasUnpricedAlias } from "./config";
import { enhance, isCallInFlight } from "./enhance";
import { cancel, send, undo } from "./actions";
import { resolveChain, resolveChainWithPlatform } from "./gather";
import { leftText, readCapStatus } from "./caps";
import { readTailCount } from "./tail";
import type { BandState, Face, Strip, StripRung } from "./band-row";
import {
  colorOf,
  counterText,
  doneCostText,
  doneRowText,
  headline,
  idleRowText,
  runningRowText,
  stripOf,
  tierOf,
  verdictFace,
  RESTORED_ROW,
} from "./band-row";

// The band (spec §5.1; C12, C17, C19; R25): one row above the prompt, chained
// above whatever the engine and the plugins beneath draw there. It redraws
// only when a value it reads changes or the engine redraws the band; it never
// calls the model and runs no timer: while the chain runs, the rung strip
// moves because each rung's `runningModel` write (enhance.ts) redraws the
// band (R25). The atoms are declared here as well as in enhance.ts: `read`
// validates against an atom made in the calling file, and the same plugin and
// key name the same value. The row's words and the width tiers live in
// band-row.tsx; this file alone touches `$`.

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
const lastVerdict = atom(
  { plugin: "prompt-lift", key: "lastVerdict" } as const,
  null,
);

/** With no width from the engine, the 80-column tier: hint gone, figures kept. */
const DEFAULT_COLUMNS = 80;

export type BandEvent = RenderInput<"AbovePrompt">;
export type BandNext = (e: BandEvent) => Promise<RenderElement>;

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

/**
 * What a cap leaves (R9), or nothing with no cap; over a chain whose alias
 * rungs the platform leaves unpriced it ends with the R19 note, since none
 * of those presses count toward the cap.
 */
async function capLeft(
  $: EngineInterface,
  cfg: Config,
): Promise<string | undefined> {
  const caps = await readCapStatus($, cfg);
  if (leftText(caps) === undefined) {
    return undefined;
  }
  const { chain, platform } = await resolveChainWithPlatform($, cfg);
  return leftText(caps, hasUnpricedAlias(chain, platform));
}

async function drawRow(
  $: EngineInterface,
  e: BandEvent,
  cfg: Config,
): Promise<RenderElement> {
  const { Box, Button, Text } = $.ui.resolve(e);
  // One read of the width per draw (R25); the tiers drop parts as it falls.
  const tier = tierOf(e.props.bodyColumns ?? DEFAULT_COLUMNS);
  // The headline leads in its own non-shrinking Box, so a squeeze lands on
  // the details Text, which truncates: the row stays one line (§5.1).
  const headlineNode = (state: BandState, figure?: string): RenderElement => {
    const head = headline(state, tier, figure);
    return (
      <Box flexShrink={0}>
        <Text color={head.color} bold>
          {head.text}
        </Text>
      </Box>
    );
  };
  const detailsNode = (text: string): RenderElement => (
    <Text dimColor wrap="truncate-end">
      {text}
    </Text>
  );
  // The strip's runs nest in the dim details Text (the d.ts allows inline
  // elements in a Text): a failed rung struck and dim, the active one bold in
  // the headline's colour, a pending one dim; ` › ` between them.
  const rungNode = (run: StripRung): RenderElement =>
    run.state === "active" ? (
      <Text bold color={colorOf("running")} dimColor={false}>
        {run.label}
      </Text>
    ) : (
      <Text dimColor strikethrough={run.state === "failed"}>
        {run.label}
      </Text>
    );
  const stripNode = (strip: Strip): RenderElement => (
    <Text dimColor wrap="truncate-end">
      {strip.runs.flatMap((run, index) =>
        index === 0 ? [rungNode(run)] : [" › ", rungNode(run)],
      )}
    </Text>
  );
  const current = await read($, phase);
  // A `running` no call backs is one a dropped environment left (§5.3 resets):
  // drawn as idle here and reset by the next command; a render never writes.
  const isRunning = current === "running" && isCallInFlight();
  const isDone = current === "done";
  if (isRunning) {
    const running = await read($, runningModel);
    const strip = stripOf(await resolveChain($, cfg), running, tier);
    return (
      <Box gap={1}>
        {headlineNode(
          "running",
          strip === undefined ? undefined : counterText(strip, tier),
        )}
        <Button
          key="cancel"
          label="Cancel (c)"
          hotkey="c"
          variant="primary"
          onPress={cancel}
        />
        {strip === undefined
          ? detailsNode(runningRowText(running))
          : stripNode(strip)}
      </Box>
    );
  }
  const left = await capLeft($, cfg);
  const tail = await readTailCount($, cfg);
  const action = cfg.enhanceAction === "" ? {} : { action: cfg.enhanceAction };
  // The primary Button per state (R25): Enhance when idle, Send once done.
  const enhanceButton = (primary: boolean): RenderElement => (
    <Button
      key="enhance"
      label="Enhance (e)"
      hotkey="e"
      {...action}
      {...(primary ? { variant: "primary" } : {})}
      onPress={() => enhance($, cfg, { kind: "box" })}
    />
  );
  // A press that ended without a fill leaves its reason here until the next
  // action (R25): the headline and details change, the Buttons do not.
  const verdict = await read($, lastVerdict);
  if (!isDone) {
    const face: Face =
      verdict === null
        ? {
            state: "idle",
            details: idleRowText(await firstRung($, cfg), left, tail, tier),
          }
        : verdictFace(verdict);
    return (
      <Box gap={1}>
        {headlineNode(face.state, face.figure)}
        {enhanceButton(true)}
        {detailsNode(face.details)}
      </Box>
    );
  }
  const undone = await read($, isUndone);
  const usage = await read($, lastUsage);
  const streak = await read($, noCacheStreak);
  const summary =
    usage === null ? "" : doneRowText(usage, streak, left, tail, tier);
  // The cost leads the done headline (R25), so a squeeze never truncates it;
  // a record that failed to write leaves the headline without one.
  const cost = usage === null ? undefined : doneCostText(usage);
  const face: Face =
    verdict !== null
      ? verdictFace(verdict)
      : undone
        ? { state: "restored", details: RESTORED_ROW }
        : { state: "done", figure: cost, details: summary };
  return (
    <Box gap={1}>
      {headlineNode(face.state, face.figure)}
      {enhanceButton(false)}
      <Button
        key="send"
        label={e.props.isWorking ? "Send (queues)" : "Send (s)"}
        hotkey="s"
        variant="primary"
        onPress={() => send($)}
      />
      <Button
        key="undo"
        label={undone ? "Redo (u)" : "Undo (u)"}
        hotkey="u"
        onPress={() => undo($)}
      />
      {detailsNode(face.details)}
    </Box>
  );
}
