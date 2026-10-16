/**
 * The token shapes the post-processing guards compare (spec §9.8–§9.11):
 * protected references the draft carries, path-like tokens, command-shaped
 * tokens. Every token comes back without the punctuation prose wraps it in,
 * so a sentence that ends with `src/auth.ts.` protects `src/auth.ts`.
 */

const EDGE_PUNCTUATION = /^[("'`]+|[.,;:!?)"'`]+$/g;
// Path-like: a slash form, or a dot and one of the listed extensions
// (controller ruling: `e.g.` and `v0.3` are not references).
const PATH_LIKE =
  /\S+\/\S+|\S+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|md|json|yaml|yml|toml|sh|sql|css|html|txt)\b/g;
/** Spec §9.10's command-name shape, case-insensitive (controller ruling 3). */
export const COMMAND_SHAPE = /^\/[a-z0-9][a-z0-9:_-]*$/i;
const ROOTED = /^(\/|\.\/|\.\.\/|~\/)/;
const DOT_EXTENSION = /\.\w{1,5}$/;

/** `(src/auth.ts).` → `src/auth.ts`; a token's own inner punctuation stays. */
export function stripEdges(token: string): string {
  return token.replace(EDGE_PUNCTUATION, "");
}

function matches(s: string, shape: RegExp): string[] {
  return s.match(shape) ?? [];
}

/** Spec §9.8: what the draft names and the result must carry verbatim. */
export function protectedTokens(draft: string): string[] {
  return [
    ...matches(draft, /@\S+/g).map(stripEdges),
    ...matches(draft, /\[Image #\d+\]/g),
    ...matches(draft, /`[^`]+`/g),
    ...pathTokens(draft),
  ];
}

export function pathTokens(s: string): string[] {
  return matches(s, PATH_LIKE)
    .map(stripEdges)
    .filter((token) => token.length > 0);
}

export function commandTokens(result: string): string[] {
  return result
    .split(/\s+/)
    .map(stripEdges)
    .filter((token) => COMMAND_SHAPE.test(token));
}

/**
 * Spec §9.11 names files, but prose has the same `a/b` shape (`CI/CD`,
 * `and/or`, `client/server`). A token looks like a file when it is rooted
 * (`/`, `./`, `../`, `~/`), its last segment carries an extension, or its
 * first segment is a directory of the project root.
 */
export function isFileLike(
  token: string,
  rootDirs: ReadonlySet<string>,
): boolean {
  if (ROOTED.test(token)) {
    return true;
  }
  const segments = token.split("/");
  if (DOT_EXTENSION.test(segments.at(-1) ?? "")) {
    return true;
  }
  return rootDirs.has(segments[0] ?? "");
}
