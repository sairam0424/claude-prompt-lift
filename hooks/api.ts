import type { EngineInterface, ResolveInput } from "claude-code";

// R29, the engine seam: every call the mod makes to the engine's `$.<noun>.<fn>`
// goes through one of these wrappers (register.tsx's own hook bodies and
// `$.command.register` aside). `claude plugin validate` lists each API it finds
// with the functions that call it directly, and cuts that `calls` line near
// 1,000 characters; with the call sites spread over a dozen hooks the labels
// ran past the cut and a listing was held for an incomplete footprint. Here
// each API has one caller and one short label, so the whole footprint fits.
// Nothing is hidden: every API is still named, and a wrapper only forwards.
//
// A wrapper takes `$` first, then the arguments the engine takes, and returns
// what the engine returns: a promise stays the engine's promise, a rejection
// stays its rejection. Each asks only for the slice of `$` it calls, so a
// caller holding less than the whole engine still type-checks. The names are
// short and unique across hooks/ on purpose (tests/api.test.ts pins the
// length); `$.state.*` goes through the kit's `read` and `update` instead.
//
// Every wrapper is a function declaration spelling `$.noun.fn(...)` at its call
// site: the engine follows `$` past an import only into a function declaration
// (an arrow bound to a const fails the load), and reads the API off that spelling.
//
// `getHome` is the one wrapper that forwards no argument: `$.env.get` takes a
// literal name and refuses a spread, so `getHome` fixes `"HOME"` inside.

/** The slice of `$` a wrapper calls: member `M` of noun `N`. */
type Slice<
  N extends keyof EngineInterface,
  M extends keyof EngineInterface[N],
> = Record<N, Pick<EngineInterface[N], M>>;

/** The arguments the engine's own `N.M` takes: a wrapper takes them as they are. */
type Args<
  N extends keyof EngineInterface,
  M extends keyof EngineInterface[N],
> = EngineInterface[N][M] extends (...args: infer A) => unknown ? A : never;

// clock
export function epochMs($: Slice<"clock", "now">) {
  return $.clock.now();
}

// command
export function cmds($: Slice<"command", "list">) {
  return $.command.list();
}

// env
export function getHome($: Slice<"env", "get">) {
  return $.env.get("HOME");
}

// fs (`fsRead` is the text form: the mod never reads bytes)
export function fsHas($: Slice<"fs", "exists">, ...a: Args<"fs", "exists">) {
  return $.fs.exists(...a);
}
export function fsList($: Slice<"fs", "list">, ...a: Args<"fs", "list">) {
  return $.fs.list(...a);
}
export function fsRead($: Slice<"fs", "read">, path: string) {
  return $.fs.read(path);
}
export function fsStat($: Slice<"fs", "stat">, ...a: Args<"fs", "stat">) {
  return $.fs.stat(...a);
}

// model
export function ask(
  $: Slice<"model", "complete">,
  ...a: Args<"model", "complete">
) {
  return $.model.complete(...a);
}

// prompt
export function fillBox(
  $: Slice<"prompt", "fill">,
  ...a: Args<"prompt", "fill">
) {
  return $.prompt.fill(...a);
}
export function readBox($: Slice<"prompt", "read">) {
  return $.prompt.read();
}
export function submit(
  $: Slice<"prompt", "submit">,
  ...a: Args<"prompt", "submit">
) {
  return $.prompt.submit(...a);
}

// session (`history` is the no-argument form: the main conversation's rows)
export function history($: Slice<"session", "messages">) {
  return $.session.messages();
}
export function sessMod($: Slice<"session", "model">) {
  return $.session.model();
}
export function rootDir($: Slice<"session", "root">) {
  return $.session.root();
}
export function usageOf(
  $: Slice<"session", "usage">,
  ...a: Args<"session", "usage">
) {
  return $.session.usage(...a);
}

// store
export function kvGet($: Slice<"store", "get">, ...a: Args<"store", "get">) {
  return $.store.get(...a);
}
export function kvSet($: Slice<"store", "set">, ...a: Args<"store", "set">) {
  return $.store.set(...a);
}
export function kvDel(
  $: Slice<"store", "delete">,
  ...a: Args<"store", "delete">
) {
  return $.store.delete(...a);
}
export function kvKeys($: Slice<"store", "keys">) {
  return $.store.keys();
}

// ui
export function redraw(
  $: Slice<"ui", "invalidate">,
  ...a: Args<"ui", "invalidate">
) {
  return $.ui.invalidate(...a);
}
export function log($: Slice<"ui", "log">, ...a: Args<"ui", "log">) {
  return $.ui.log(...a);
}
export function notify($: Slice<"ui", "toast">, ...a: Args<"ui", "toast">) {
  return $.ui.toast(...a);
}
export function surface<E extends ResolveInput>(
  $: Slice<"ui", "resolve">,
  e: E,
) {
  return $.ui.resolve(e);
}
