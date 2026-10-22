import type { EngineInterface } from "claude-code";

// R26: the engine reports real paths for the memory files it loaded, while
// `$.env.get("HOME")` can be a spelling that goes through a symlink (macOS
// `/tmp`, a Linux `/home` that leads to `/var/home`). A path compared against
// that HOME alone reads as foreign: the rules files would count as outside
// `~/.claude/rules/`, and a `~/…` entry of `instructionExclude` would stop
// matching its file, which would then be sent. So HOME is asked for under
// every spelling the engine can name, and a match on any one of them counts.

/** The path without the trailing slash a resolved directory may carry. */
function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** HOME set, but the engine did not say where it lands. */
export type HomeUnresolved = { home: string; reason: string };

export type HomeResolution = {
  /**
   * HOME as the environment spells it, then where it lands once every symbolic
   * link is followed when that differs. `[]` when HOME is unset; `[HOME]`
   * alone when the engine cannot say where it lands.
   */
  spellings: string[];
  /**
   * Set when that last case held: HOME goes unresolved, so a HOME reached
   * through a symlink would read as foreign to the engine's real paths. The
   * reason is for `/prompt-lift status`; the debug log has it too.
   */
  unresolved?: HomeUnresolved;
};

/**
 * HOME under every spelling the engine can name, and, when it cannot name
 * the real one (the stat fails, or answers no real path: `realPath` is absent
 * when a hook above withheld it), why: a HOME that goes through a symlink
 * then loses the `~/` exclusions and the rules files (spec C6), which the
 * debug log alone would never tell the person.
 */
export async function resolveHome($: EngineInterface): Promise<HomeResolution> {
  const given = await $.env.get("HOME");
  if (given === undefined || given === "") {
    return { spellings: [] };
  }
  const home = withoutTrailingSlash(given);
  try {
    const { realPath } = await $.fs.stat(home, { resolve: true });
    if (realPath === undefined || realPath === "") {
      $.ui.log(`prompt-lift: ${home} has no real path, used as given`, {
        to: "debug",
      });
      return {
        spellings: [home],
        unresolved: { home, reason: "the engine reported no real path" },
      };
    }
    const real = withoutTrailingSlash(realPath);
    return { spellings: real === home ? [home] : [home, real] };
  } catch (err) {
    $.ui.log(`prompt-lift: could not resolve ${home}: ${String(err)}`, {
      to: "debug",
    });
    return {
      spellings: [home],
      unresolved: {
        home,
        reason: `stat failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

/** Just the spellings of `resolveHome`, for the callers that compare paths. */
export async function homeSpellings($: EngineInterface): Promise<string[]> {
  return (await resolveHome($)).spellings;
}
