// Finds the JSON objects in a model reply. A rewrite that quotes a payload
// (a request body, a `{id}` template) carries brace pairs inside its string,
// so a brace-free pattern matches the inner pair and misses the answer. This
// scans from each `{` with a depth count that skips string contents, so the
// outer object comes out whole. Split out of guards.ts, which stays under the
// file cap.

/** How many `{` the scan tries; a reply is a few thousand characters at most. */
const MAX_STARTS = 40;

/** The balanced `{...}` that opens at `from`, or undefined when it never closes. */
function objectAt(text: string, from: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(from, i + 1);
      }
    }
  }
  return undefined;
}

/**
 * Every balanced object that opens at some `{` of `text`, in order of that
 * `{`, so an outer object comes before one inside it. A `{` that never closes
 * yields nothing; at most `MAX_STARTS` starts are tried.
 */
export function jsonObjects(text: string): string[] {
  const found: string[] = [];
  let from = text.indexOf("{");
  for (let tried = 0; from !== -1 && tried < MAX_STARTS; tried++) {
    const object = objectAt(text, from);
    if (object !== undefined) {
      found.push(object);
    }
    from = text.indexOf("{", from + 1);
  }
  return found;
}
