// Word-level diffs over one longest-common-subsequence table: the inserted
// runs as character offsets into the result (the fill's decorations, C15) and
// the removed and inserted runs as lines (`/prompt-lift diff`).

type Table = number[][];

type Op = { kind: "same" | "del" | "ins"; word: string };

function lcsTable(from: readonly string[], to: readonly string[]): Table {
  const m = from.length;
  const n = to.length;
  const dp: Table = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    const row = dp[i] ?? [];
    const above = dp[i - 1] ?? [];
    for (let j = 1; j <= n; j++) {
      if (from[i - 1] === to[j - 1]) {
        row[j] = (above[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(above[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }
  return dp;
}

type Token = { word: string; start: number; end: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    tokens.push({
      word: match[0] ?? "",
      start: match.index ?? 0,
      end: (match.index ?? 0) + (match[0] ?? "").length,
    });
  }
  return tokens;
}

export function wordDiffInsertions(
  from: string,
  to: string,
): Array<{ start: number; end: number }> {
  const fromTokens = tokenize(from);
  const toTokens = tokenize(to);
  const fromWords = fromTokens.map((t) => t.word);
  const toWords = toTokens.map((t) => t.word);
  const m = fromWords.length;
  const n = toWords.length;
  const dp = lcsTable(fromWords, toWords);

  // Backtrack to find inserted words
  const inserted: boolean[] = Array(n).fill(true);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if ((fromWords[i - 1] ?? "") === (toWords[j - 1] ?? "")) {
      inserted[j - 1] = false;
      i--;
      j--;
    } else if ((dp[i - 1]?.[j] ?? 0) > (dp[i]?.[j - 1] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }

  // Group contiguous inserted tokens into runs
  const runs: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  let runEnd = -1;

  for (let idx = 0; idx < toTokens.length; idx++) {
    if (inserted[idx] ?? false) {
      const token = toTokens[idx];
      if (!token) continue;
      if (runStart === -1) {
        runStart = token.start;
      }
      runEnd = token.end;
    } else {
      if (runStart !== -1) {
        runs.push({ start: runStart, end: runEnd });
        runStart = -1;
        runEnd = -1;
      }
    }
  }

  // Handle last run
  if (runStart !== -1) {
    runs.push({ start: runStart, end: runEnd });
  }

  return runs;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

/**
 * The edit script from `from` to `to`, word by word, in reading order; ties
 * break as `wordDiffInsertions` breaks them, so a replacement reads as the
 * removed words before the inserted ones.
 */
function wordDiffOps(from: readonly string[], to: readonly string[]): Op[] {
  const dp = lcsTable(from, to);
  const ops: Op[] = [];
  let i = from.length;
  let j = to.length;
  while (i > 0 || j > 0) {
    const fromWord = from[i - 1] ?? "";
    const toWord = to[j - 1] ?? "";
    const above = dp[i - 1]?.[j] ?? 0;
    const left = dp[i]?.[j - 1] ?? 0;
    if (i > 0 && j > 0 && fromWord === toWord) {
      ops.push({ kind: "same", word: fromWord });
      i--;
      j--;
    } else if (j === 0 || (i > 0 && above > left)) {
      ops.push({ kind: "del", word: fromWord });
      i--;
    } else {
      ops.push({ kind: "ins", word: toWord });
      j--;
    }
  }
  return ops.reverse();
}

/** Spec §5.2 `diff`: one `- run` or `+ run` line per changed run of words. */
export function wordDiffLines(from: string, to: string): string[] {
  const runs = wordDiffOps(words(from), words(to)).reduce<Op[]>((acc, op) => {
    const last = acc.at(-1);
    if (op.kind !== "same" && last !== undefined && last.kind === op.kind) {
      return [
        ...acc.slice(0, -1),
        { kind: op.kind, word: `${last.word} ${op.word}` },
      ];
    }
    return [...acc, op];
  }, []);
  return runs
    .filter((run) => run.kind !== "same")
    .map((run) => `${run.kind === "del" ? "-" : "+"} ${run.word}`);
}
