import { expect, test } from "claude-code/testing";
import { parseVerdict, postProcess } from "../hooks/guards";
import { parseOptions } from "../hooks/config";

// The model's answer is one JSON object, and a rewrite that quotes a payload
// puts brace pairs inside its `prompt` string. The parser used to take the
// first brace-free `{...}` and so matched the inner pair, failed to parse it,
// and treated the whole reply as the rewrite: the raw JSON envelope landed in
// the prompt box. A balanced, string-aware scan finds the real object.

const BODY = '{"name": ""}';
const PROMPT = `Saving the profile returns a 500 and the form empties. The request body was ${BODY}.`;

function reply(prompt: string): string {
  return JSON.stringify({
    verdict: "improve",
    prompt,
    why: "kept the payload",
    applied: [],
  });
}

test("a rewrite that quotes a JSON body is read as the rewrite, not the envelope", () => {
  const v = parseVerdict(reply(PROMPT));

  expect(v.verdict).toBe("improve");
  if (v.verdict === "improve") {
    expect(v.prompt).toBe(PROMPT);
    expect(v.why).toBe("kept the payload");
    expect(v.prompt).not.toContain('"verdict"');
  }
});

test("a template brace such as {id} in the rewrite does not hide the object", () => {
  const prompt = "Return 404 for GET /users/{id} when the user is missing.";
  const v = parseVerdict(reply(prompt));

  expect(v).toEqual({
    verdict: "improve",
    prompt,
    why: "kept the payload",
    applied: [],
  });
});

test("an unbalanced brace character inside a string is not a brace", () => {
  const prompt = "Close the block with } and open the next with {.";
  const v = parseVerdict(reply(prompt));

  expect(v.verdict).toBe("improve");
  if (v.verdict === "improve") {
    expect(v.prompt).toBe(prompt);
  }
});

test("prose before the object, or a fence around it, still finds the object", () => {
  expect(parseVerdict('Nothing to add. {"verdict":"fine"}')).toEqual({
    verdict: "fine",
  });
  expect(parseVerdict('```json\n{"verdict":"fine"}\n```')).toEqual({
    verdict: "fine",
  });
  const fenced = parseVerdict(`\`\`\`json\n${reply(PROMPT)}\n\`\`\``);
  expect(fenced.verdict === "improve" && fenced.prompt).toBe(PROMPT);
});

test("a brace pair in leading prose does not stop the scan for the object", () => {
  expect(parseVerdict('Use {x} here. {"verdict":"fine"}')).toEqual({
    verdict: "fine",
  });
});

test("the old behaviour stands for plain text, malformed JSON and an object with no verdict", () => {
  const plain = parseVerdict("Fix the login bug in src/auth.ts");
  expect(plain).toEqual({
    verdict: "improve",
    prompt: "Fix the login bug in src/auth.ts",
    why: "",
    applied: [],
  });

  const broken = parseVerdict('{"verdict":"improve","prompt":"Do X"');
  expect(broken.verdict === "improve" && broken.prompt).toBe(
    '{"verdict":"improve","prompt":"Do X"',
  );

  const noVerdict = parseVerdict('{"prompt":"Do X"}');
  expect(noVerdict.verdict === "improve" && noVerdict.prompt).toBe(
    '{"prompt":"Do X"}',
  );

  // An improve with an empty prompt is not an improvement
  const empty = parseVerdict(reply("   "));
  expect(empty.verdict === "improve" && empty.prompt).toContain('"verdict"');
});

test("end to end: a bug report with a JSON body gets its rewrite, not the envelope", () => {
  const cfg = parseOptions({});
  const draft = `Saving the profile returns a 500 and the form empties. The request body was ${BODY}.`;
  const rewrite = `${draft} Confirm the failure on the same request first, then check it passes.`;

  const result = postProcess({
    draft,
    reply: reply(rewrite),
    outputTokens: 120,
    cfg,
    knownSkills: new Set(),
    listedSkills: new Set(),
    descriptions: new Map(),
    documents: "",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.text).toBe(rewrite);
    expect(result.text).not.toContain('"verdict"');
  }
});
