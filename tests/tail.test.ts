import { expect, test } from "claude-code/testing";
import type { Engine as Harness, Mounted } from "claude-code/testing";
import {
  answered,
  block,
  engine,
  press,
  watch,
  DRAFT,
  FABLE,
  GOOD,
  type Message,
} from "./engine";
import { parseOptions } from "../hooks/config";

// Conversation tail (R10): `/prompt-lift tail` command controls the transcript
// grounding override for this session; the rows show ` · tail N` when active;
// status shows `conversation: off` or `conversation: last N messages`.

const DRAFT_2 = "fix the database query bug in src/db.ts please";
const MESSAGES: Message[] = [
  { role: "user", text: "first user message" },
  { role: "assistant", text: "first assistant reply" },
  { role: "user", text: "second user message" },
  { role: "assistant", text: "second assistant reply" },
  { role: "user", text: "third user message" },
  { role: "assistant", text: "third assistant reply" },
  { role: "user", text: "fourth user message" },
  { role: "assistant", text: "fourth assistant reply" },
];
const TAIL_USAGE =
  "prompt-lift: tail takes on, off or a count 1-50, e.g. /prompt-lift tail 6";
const TAIL_ON_4 = "prompt-lift: tail on · last 4 messages this session";
const TAIL_OFF = "prompt-lift: tail off this session";
const TAIL_ON_6 = "prompt-lift: tail on · last 6 messages this session";

type Band = Mounted<"terminal", "AbovePrompt">;

function opts(includeConversation: boolean, conversationMessages: number) {
  return parseOptions({ includeConversation, conversationMessages });
}

function mount($: Harness): Promise<Band> {
  return $.ui.mount({
    plugin: "prompt-lift",
    surface: "terminal",
    component: "AbovePrompt",
    props: {},
  });
}

async function text($: Harness, args: string): Promise<string | undefined> {
  return ((await press($, args)) as { text?: string }).text;
}

async function rowText(band: Band): Promise<string> {
  return band.text ?? "";
}

test("tail off by default: no suffix, no tail in dynamic block", async ($, on) => {
  const e = engine(on, { messages: MESSAGES });

  await press($, DRAFT);

  const band = await mount($);
  expect(await rowText(band)).not.toContain(" · tail");

  // The dynamic block (second prompt block) should not have conversation
  const dynamic = block(e, 0, 1);
  expect(dynamic).not.toContain("user:");
  expect(dynamic).not.toContain("assistant:");
});

test(
  "tail on by config: suffix and tail present",
  { options: opts(true, 4) },
  async ($, on) => {
    const e = engine(on, { messages: MESSAGES });

    await press($, DRAFT);

    const band = await mount($);
    expect(await rowText(band)).toContain(" · tail 4");

    // The dynamic block should have the last 4 messages
    const dynamic = block(e, 0, 1);
    expect(dynamic).toContain("user: fourth user message");
    expect(dynamic).toContain("assistant: fourth assistant reply");
    expect(dynamic).toContain("user: third user message");
    expect(dynamic).toContain("assistant: third assistant reply");
    expect(dynamic).not.toContain("user: second user message");
  },
);

test("/prompt-lift tail 6: enables tail for this session", async ($, on) => {
  const e = engine(on, { messages: MESSAGES });

  expect(await text($, "tail 6")).toBe(TAIL_ON_6);

  await press($, DRAFT);

  const band = await mount($);
  expect(await rowText(band)).toContain(" · tail 6");

  // The dynamic block should have the last 6 messages
  const dynamic = block(e, 0, 1);
  expect(dynamic).toContain("user: fourth user message");
  expect(dynamic).toContain("user: third user message");
  expect(dynamic).toContain("user: second user message");
  expect(dynamic).not.toContain("user: first user message");
});

test(
  "/prompt-lift tail on: uses conversationMessages from config",
  { options: opts(false, 4) },
  async ($, on) => {
    const e = engine(on, { messages: MESSAGES });

    expect(await text($, "tail on")).toBe(TAIL_ON_4);

    await press($, DRAFT);

    const band = await mount($);
    expect(await rowText(band)).toContain(" · tail 4");

    // The dynamic block should have the last 4 messages
    const dynamic = block(e, 0, 1);
    expect(dynamic).toContain("user: fourth user message");
    expect(dynamic).toContain("user: third user message");
    expect(dynamic).not.toContain("user: second user message");
  },
);

test(
  "/prompt-lift tail off: disables tail for this session",
  { options: opts(true, 4) },
  async ($, on) => {
    const e = engine(on, { messages: MESSAGES });

    expect(await text($, "tail off")).toBe(TAIL_OFF);

    await press($, DRAFT);

    const band = await mount($);
    expect(await rowText(band)).not.toContain(" · tail");

    // The dynamic block should not have conversation
    const dynamic = block(e, 0, 1);
    expect(dynamic).not.toContain("user:");
  },
);

test("/prompt-lift tail: shows current status", async ($, on) => {
  engine(on);

  expect(await text($, "tail")).toBe(
    "prompt-lift: conversation off · /prompt-lift tail on|off|<count>",
  );
});

test(
  "/prompt-lift tail: shows current status when on by config",
  { options: opts(true, 4) },
  async ($, on) => {
    engine(on);

    expect(await text($, "tail")).toBe(
      "prompt-lift: conversation last 4 messages · /prompt-lift tail on|off|<count>",
    );
  },
);

test("/prompt-lift tail: shows current status when on by override", async ($, on) => {
  engine(on);

  await press($, "tail 6");
  expect(await text($, "tail")).toBe(
    "prompt-lift: conversation last 6 messages · /prompt-lift tail on|off|<count>",
  );
});

test("/prompt-lift tail x: rejects non-numeric", async ($, on) => {
  engine(on);

  expect(await text($, "tail x")).toBe(TAIL_USAGE);
});

test("/prompt-lift tail 0: rejects zero", async ($, on) => {
  engine(on);

  expect(await text($, "tail 0")).toBe(TAIL_USAGE);
});

test("/prompt-lift tail 99: rejects out of range", async ($, on) => {
  engine(on);

  expect(await text($, "tail 99")).toBe(TAIL_USAGE);
});

test("/prompt-lift tail with prose: enhances", async ($, on) => {
  engine(on);

  const w = watch($);
  await press($, "tail this story");
  const f = await w.promptFill();
  expect(f.isFilled).toBe(true);
  if (f.isFilled) {
    expect(f.text).toContain("tail this story");
  }
});

test(
  "tail suffix appears after $Y left",
  { options: opts(false, 4) },
  async ($, on) => {
    engine(on, {
      replies: [answered(GOOD)],
    });

    await press($, "cap 1.00");
    await press($, "tail on");
    await press($, DRAFT);

    const band = await mount($);
    // Should be: "... · $... left · tail 4"
    expect(await rowText(band)).toMatch(/\$.*left.*·.*tail 4/);
  },
);

test(
  "tail suffix appears before NO_CACHE_HINT",
  { options: opts(false, 4) },
  async ($, on) => {
    const e = engine(on, {
      messages: MESSAGES,
      replies: [
        answered(GOOD),
        answered(GOOD, {
          input_tokens: 1400,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 310,
        }),
        answered(GOOD, {
          input_tokens: 1400,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 310,
        }),
        answered(GOOD, {
          input_tokens: 1400,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 310,
        }),
      ],
    });

    await press($, "tail on");

    // Three presses with no cache hit
    await press($, DRAFT);
    await press($, DRAFT_2);
    await press($, DRAFT);
    await press($, DRAFT_2);

    const band = await mount($);
    // Should be: "... · tail 4 · cache not hitting — consider /prompt-lift model haiku"
    expect(await rowText(band)).toMatch(/tail 4.*cache not hitting/);
  },
);

test("status shows conversation: off by default", async ($, on) => {
  engine(on);

  expect(await text($, "status")).toContain("conversation: off");
});

test(
  "status shows conversation: last N messages when on by config",
  { options: opts(true, 4) },
  async ($, on) => {
    engine(on);

    expect(await text($, "status")).toContain("conversation: last 4 messages");
  },
);

test("status shows conversation: last N messages when on by override", async ($, on) => {
  engine(on);

  await press($, "tail 6");
  expect(await text($, "status")).toContain("conversation: last 6 messages");
});

test(
  "status shows conversation: off when override is 0",
  { options: opts(true, 4) },
  async ($, on) => {
    engine(on);

    await press($, "tail off");
    expect(await text($, "status")).toContain("conversation: off");
  },
);

test(
  "tail count respects override over config",
  { options: opts(true, 10) },
  async ($, on) => {
    const e = engine(on, { messages: MESSAGES });

    await press($, "tail 2");
    await press($, DRAFT);

    const dynamic = block(e, 0, 1);
    // Should only have 2 messages, not the 10 from config
    expect(dynamic).toContain("user: fourth user message");
    expect(dynamic).toContain("assistant: fourth assistant reply");
    expect(dynamic).not.toContain("user: third user message");
  },
);
