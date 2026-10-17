import { test, expect } from "claude-code/testing";
import { wordDiffInsertions } from "../hooks/diff";

/**
 * Tests for wordDiffInsertions: spec C15 requires true character offsets into
 * the result string, such that the runs slice to exactly the inserted text.
 */

test("wordDiffInsertions: returns true character offsets that slice to inserted words", () => {
  const from = "fix the bug";
  const to = "fix  the login bug\n\nin auth";

  const runs = wordDiffInsertions(from, to);

  // Verify by slicing the result
  const sliced = runs.map((r) => to.slice(r.start, r.end));

  // The runs should slice to exactly "login" and "in auth"
  // (two spaces and blank lines are deliberate)
  expect(sliced).toEqual(["login", "in auth"]);
});

test("wordDiffInsertions: returns empty array when no insertions", () => {
  const text = "no change here";
  const runs = wordDiffInsertions(text, text);
  expect(runs).toEqual([]);
});

test("wordDiffInsertions: handles single word insertion", () => {
  const from = "hello world";
  const to = "hello beautiful world";
  const runs = wordDiffInsertions(from, to);
  const sliced = runs.map((r) => to.slice(r.start, r.end));
  expect(sliced).toEqual(["beautiful"]);
});

test("wordDiffInsertions: handles insertion at start", () => {
  const from = "world";
  const to = "hello world";
  const runs = wordDiffInsertions(from, to);
  const sliced = runs.map((r) => to.slice(r.start, r.end));
  expect(sliced).toEqual(["hello"]);
});

test("wordDiffInsertions: handles insertion at end", () => {
  const from = "hello";
  const to = "hello world";
  const runs = wordDiffInsertions(from, to);
  const sliced = runs.map((r) => to.slice(r.start, r.end));
  expect(sliced).toEqual(["world"]);
});

test("wordDiffInsertions: handles multiple non-contiguous insertions", () => {
  const from = "a c e";
  const to = "a b c d e f";
  const runs = wordDiffInsertions(from, to);
  const sliced = runs.map((r) => to.slice(r.start, r.end));
  expect(sliced).toEqual(["b", "d", "f"]);
});

test("wordDiffInsertions: handles contiguous insertions as one run", () => {
  const from = "start end";
  const to = "start middle words here end";
  const runs = wordDiffInsertions(from, to);
  const sliced = runs.map((r) => to.slice(r.start, r.end));
  expect(sliced).toEqual(["middle words here"]);
});
