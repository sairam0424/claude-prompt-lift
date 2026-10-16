export function wordDiffInsertions(
  from: string,
  to: string,
): Array<{ start: number; end: number }> {
  const fromWords = from.split(/\s+/);
  const toWords = to.split(/\s+/);

  // LCS algorithm
  const m = fromWords.length;
  const n = toWords.length;
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (fromWords[i - 1] === toWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find inserted words
  const inserted: boolean[] = Array(n).fill(true);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (fromWords[i - 1] === toWords[j - 1]) {
      inserted[j - 1] = false;
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  // Convert word indices to character offsets
  const runs: Array<{ start: number; end: number }> = [];
  let pos = 0;
  let runStart = -1;

  for (let idx = 0; idx < toWords.length; idx++) {
    const word = toWords[idx];

    if (inserted[idx]) {
      if (runStart === -1) {
        runStart = pos;
      }
    } else {
      if (runStart !== -1) {
        // End of run, trim trailing space
        runs.push({ start: runStart, end: pos - 1 });
        runStart = -1;
      }
    }

    pos += word.length;
    if (idx < toWords.length - 1) {
      pos += 1; // Space
    }
  }

  // Handle last run
  if (runStart !== -1) {
    runs.push({ start: runStart, end: pos });
  }

  return runs;
}
