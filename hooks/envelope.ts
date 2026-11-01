// The envelope tags a block uses and the one function that keeps user data
// from forging them. Split out of context.ts, which stays under the file cap.

// Envelope tag names to neutralize
const ENVELOPE_TAGS = [
  "enhancer_rules",
  "examples",
  "example",
  "draft",
  "answer",
  "project",
  "documents",
  "document",
  "source",
  "document_content",
  "skill_names",
  "relevant_skills",
  "subproject_instructions",
  "recent_conversation",
];

// Precompiled regexes for tag neutralization
const tagPattern = ENVELOPE_TAGS.join("|");
const CLOSE_TAG_RE = new RegExp(`</\\s*(${tagPattern})(\\s*)>`, "gi");
const OPEN_TAG_RE = new RegExp(`<(${tagPattern})((?:\\s[^>]*)?)>`, "gi");

export function neutralizeTags(text: string): string {
  // Neutralize closing tags first: </name> → <\/name>
  // Capture tag name and trailing whitespace separately to preserve trailing space
  let result = text.replace(CLOSE_TAG_RE, (match, tagName, trailingWS) => {
    return `<\\/${tagName}${trailingWS}>`;
  });

  // Then neutralize opening tags: <name> or <name attrs> → <\name> or <\name attrs>
  // Capture tag name and any attributes separately to preserve them
  result = result.replace(OPEN_TAG_RE, (match, tagName, attrs) => {
    return `<\\${tagName}${attrs}>`;
  });

  return result;
}
