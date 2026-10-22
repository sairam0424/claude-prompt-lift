import type { EngineInterface } from "claude-code";
import { fsStat, getHome, log } from "./api";

// R26: the engine reports real paths for the memory files it loaded, while
// `$.env.get` of HOME can be a spelling that goes through a symlink (macOS
// `/tmp`, a Linux `/home` that leads to `/var/home`). A path compared against
// that HOME alone reads as foreign: the rules files would count as outside
// `~/.claude/rules/`, and a `~/…` entry of `instructionExclude` would stop
// matching its file, which would then be sent. So HOME is asked for under
// every spelling the engine can name, and a match on any one of them counts.

/**
 * A directory as it is spelled for joining to a child path (`home + "/x"`):
 * without the trailing slash a resolved directory may carry, so the
 * filesystem root, which is all slash, is the empty string and joins as `/x`
 * rather than `//x`. An unset HOME never gets here; it has no spelling at all.
 */
function forJoining(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}

/** A spelling as the person reads it: the root's empty string shows as `/`. */
function shown(spelling: string): string {
  return spelling === "" ? "/" : spelling;
}

/**
 * HOME set, but the engine did not say where it lands. `home` is for the
 * person to read, so the root is `/` here.
 */
export type HomeUnresolved = { home: string; reason: string };

export type HomeResolution = {
  /**
   * HOME as the environment spells it, then where it lands once every symbolic
   * link is followed when that differs. `[]` when HOME is unset; `[HOME]`
   * alone when the engine cannot say where it lands. Each is spelled for
   * joining a child path to it, so the filesystem root is `""` (`[""]` for a
   * HOME of `/`), which is not the `[]` of no HOME at all.
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
  const given = await getHome($);
  if (given === undefined || given === "") {
    return { spellings: [] };
  }
  const home = forJoining(given);
  const label = shown(home);
  try {
    const { realPath } = await fsStat($, label, { resolve: true });
    if (realPath === undefined || realPath === "") {
      log($, `prompt-lift: ${label} has no real path, used as given`, {
        to: "debug",
      });
      return {
        spellings: [home],
        unresolved: { home: label, reason: "the engine reported no real path" },
      };
    }
    const real = forJoining(realPath);
    return { spellings: real === home ? [home] : [home, real] };
  } catch (err) {
    log($, `prompt-lift: could not resolve ${label}: ${String(err)}`, {
      to: "debug",
    });
    return {
      spellings: [home],
      unresolved: {
        home: label,
        reason: `stat failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

/** Just the spellings of `resolveHome`, for the callers that compare paths. */
export async function homeSpellings($: EngineInterface): Promise<string[]> {
  return (await resolveHome($)).spellings;
}
