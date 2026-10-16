/**
 * Token extraction utilities for the prompt-master mod.
 * Extracted from guards.ts to maintain file size discipline.
 */

export function protectedTokens(draft: string): string[] {
  const tokens: string[] = [];

  // @mentions
  const mentions = draft.match(/@\S+/g);
  if (mentions) {
    tokens.push(...mentions);
  }

  // [Image #N]
  const images = draft.match(/\[Image #\d+\]/g);
  if (images) {
    tokens.push(...images);
  }

  // Backticked spans
  const backticked = draft.match(/`[^`]+`/g);
  if (backticked) {
    tokens.push(...backticked);
  }

  // Path-like tokens (controller ruling: restricted extensions)
  const pathLike = draft.match(
    /\S+\/\S+|\S+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|md|json|yaml|yml|toml|sh|sql|css|html|txt)\b/g,
  );
  if (pathLike) {
    tokens.push(...pathLike);
  }

  return tokens;
}

export function pathTokens(s: string): string[] {
  const tokens: string[] = [];

  // Path-like tokens (controller ruling: restricted extensions)
  const pathLike = s.match(
    /\S+\/\S+|\S+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|md|json|yaml|yml|toml|sh|sql|css|html|txt)\b/g,
  );
  if (pathLike) {
    tokens.push(...pathLike);
  }

  return tokens;
}

export function commandTokens(result: string): string[] {
  // Controller ruling 3: case-insensitive
  const tokens = result.split(/\s+/);
  return tokens.filter((t) => /^\/[a-z0-9][a-z0-9:_-]*$/i.test(t));
}
