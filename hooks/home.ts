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

/**
 * HOME as the environment spells it, then where it lands once every symbolic
 * link is followed when that differs. `[]` when HOME is unset; `[HOME]` alone
 * when the engine cannot say where it lands (the reason goes to the debug log).
 */
export async function homeSpellings($: EngineInterface): Promise<string[]> {
  const given = await $.env.get("HOME");
  if (given === undefined || given === "") {
    return [];
  }
  const home = withoutTrailingSlash(given);
  try {
    const { realPath } = await $.fs.stat(home, { resolve: true });
    if (realPath === undefined || realPath === "") {
      $.ui.log(`prompt-lift: ${home} has no real path, used as given`, {
        to: "debug",
      });
      return [home];
    }
    const real = withoutTrailingSlash(realPath);
    return real === home ? [home] : [home, real];
  } catch (err) {
    $.ui.log(`prompt-lift: could not resolve ${home}: ${String(err)}`, {
      to: "debug",
    });
    return [home];
  }
}
