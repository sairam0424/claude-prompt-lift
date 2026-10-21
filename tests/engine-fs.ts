import type { FsEntry, FsStat } from "claude-code";

// The stub engine's in-memory file system, kept out of engine.ts so that file
// does not grow: the listing and existence a `files` record answers, and the
// stat of a directory that lands where it is.

export function childEntries(
  files: Record<string, string>,
  dir: string,
): FsEntry[] {
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  const seen = new Map<string, FsEntry>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : rest.slice(0, slash);
    const kind = slash === -1 ? "file" : "dir";
    if (!seen.has(name)) {
      seen.set(name, { name, kind, size: 0, mtimeMs: 0, isLink: false });
    }
  }
  return [...seen.values()];
}

export function pathExists(
  files: Record<string, string>,
  path: string,
): boolean {
  return (
    path in files || Object.keys(files).some((p) => p.startsWith(`${path}/`))
  );
}

/**
 * What `$.fs.stat` answers by default: a directory that is no link, and with
 * `resolve` landing at the path it was asked about (no symbolic link in it).
 * The one path the mod stats is HOME; a test that wants it to land elsewhere
 * registers its own `fs.stat` hook before the stub's.
 */
export function statOf(path: string, isResolved: boolean): FsStat {
  return {
    kind: "dir",
    size: 0,
    mtimeMs: 0,
    isLink: false,
    ...(isResolved && { realPath: path }),
  };
}
