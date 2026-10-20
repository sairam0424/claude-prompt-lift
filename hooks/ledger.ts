import type { EngineInterface } from "claude-code";
import { errorMessage } from "./gather";

/*
 * The day ledger: what every press on this machine cost, by local day, kept
 * in `$.store` across sessions for `status`'s `today:` line and the day cap.
 *
 * R24 (catalogue review of seed PR #341, finding 1): "The queue in
 * hooks/stats.ts serializes calls within one loaded module, but two sessions
 * have separate queues. Both can read the old shared row and write their own
 * increment: two paid calls leave only one recorded, so the machine-wide
 * daily limit can undercount spend." True: `$.store` is get/set/delete/keys
 * with no compare-and-set, and a hooks module is one instance per session
 * (and per hot reload), so no queue in a module can order two sessions'
 * writes to one row.
 *
 * So no two writers share a row. Each loaded module writes its own
 * `spend:<day>:<writerId>` row and the day's figure is the field-wise sum of
 * every `spend:<day>:*` row at read time: a session's increment can be lost
 * only to its own later write, which the R18 queue orders.
 *
 * - One row per writer, not one per call: a key per call would give the same
 *   guarantee at unbounded growth; a key per writer grows with the sessions
 *   of a day (bounded by the pruning below) and sums the same.
 * - The writer id is a nonce made once per loaded module, not
 *   `$.session.id()`: two module instances must never share a key whatever
 *   the host reports (a hot reload keeps the session id and makes a new
 *   instance; a resumed session may bring its id back; two instances given
 *   one id would overwrite each other as the single row did).
 * - The 0.4.0/0.4.1 single `stats` row (`{ byDay }`) is migrated once per
 *   instance, inside the queue on its first write: each day to
 *   `spend:<day>:legacy`, only when that key is absent, then `stats` is
 *   deleted. Two sessions migrating at once write identical content to the
 *   same key, so nothing is lost. Until a write has migrated a day, a read
 *   takes that day's row from `stats` in place of the absent legacy row, so
 *   a 0.4.2 session that has not pressed yet still sees the 0.4.1 day.
 * - Pruning on each write deletes every row of a day before the local
 *   calendar day seven days back (zero-padded days compare as strings): today
 *   and the last seven days stay, and the store holds at most that many days'
 *   writers. A refused delete is logged, not raised: the press is recorded by
 *   then, and the caller would report it lost.
 */

/**
 * A day's (or the session's) totals: `usd` adds only the calls the price
 * table covers; `unpriced` counts the calls it does not (R3).
 */
export type DayStats = { presses: number; usd: number; unpriced: number };

/**
 * The 0.4.x shape: one row holding every day, read to migrate it and, for a
 * day not yet migrated, by `dayTotal`.
 */
export type Stats = { byDay: Record<string, DayStats> };

/**
 * One writer's ledger: its id and the two facts that move as it writes. The
 * module makes one for itself; a test makes two against one store to stand
 * for two sessions (the kit loads a module once, so a second instance cannot
 * be imported). A value rather than closures because the engine lets `$`
 * flow only into functions declared at a file's top level or imported, never
 * into a method of an object (`ledger.recordPress($)`); so `queue` and
 * `isMigrated` are the two fields the mod reassigns in place, as the R18
 * queue variable was before.
 */
export type Ledger = {
  readonly writerId: string;
  /** The R18 queue's tail: settled (either way) before the next entry runs. */
  queue: Promise<unknown>;
  /**
   * Whether this writer has moved the 0.4.x row to legacy rows, or found
   * none to move.
   */
  isMigrated: boolean;
};

export const STATS_STORE_KEY = "stats";
export const EMPTY_DAY: DayStats = { presses: 0, usd: 0, unpriced: 0 };
const LEGACY_WRITER = "legacy";
const KEPT_DAYS = 7;
/** A `spend:<YYYY-MM-DD>:<writer>` key, its day captured. */
const SPEND_KEY = /^spend:(\d{4}-\d{2}-\d{2}):./;

/** The stats day key: the local `YYYY-MM-DD`, month and day padded (R6). */
export function dayOf(nowMs: number): string {
  const date = new Date(nowMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The store key of `writerId`'s row for `day`. */
export function spendKey(day: string, writerId: string): string {
  return `spend:${day}:${writerId}`;
}

/** The day of a `spend:<day>:<writer>` key; undefined for every other key. */
function dayOfKey(key: string): string | undefined {
  return SPEND_KEY.exec(key)?.[1];
}

/**
 * A fresh writer id: a UUID where the runtime has one, else time and chance
 * in base 36. Made once per loaded module (see the header).
 */
export function newWriterId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const time = Date.now().toString(36);
  const chance = Math.random().toString(36).slice(2, 10);
  return `${time}-${chance}`;
}

export function asStats(value: unknown): Stats {
  const byDay = (value as { byDay?: unknown } | null | undefined)?.byDay;
  const isRecord = typeof byDay === "object" && byDay !== null;
  return { byDay: isRecord ? (byDay as Record<string, DayStats>) : {} };
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * A stored value as a row: a field that is not a finite number reads as zero,
 * so a row written before unpriced calls were counted, or a malformed one,
 * never poisons the sum.
 */
function asDayRow(value: unknown): DayStats {
  if (typeof value !== "object" || value === null) {
    return EMPTY_DAY;
  }
  const row = value as Partial<Record<keyof DayStats, unknown>>;
  return {
    presses: finiteOrZero(row.presses),
    usd: finiteOrZero(row.usd),
    unpriced: finiteOrZero(row.unpriced),
  };
}

/** The day's row of a 0.4.x `stats` value, old rows read whole. */
export function dayRow(stats: Stats, day: string): DayStats {
  return asDayRow(stats.byDay[day]);
}

/** A call added to a row: priced, it adds its dollars; unpriced, a count. */
export function addCall(row: DayStats, usd: number | undefined): DayStats {
  return {
    presses: row.presses + 1,
    usd: usd === undefined ? row.usd : row.usd + usd,
    unpriced: usd === undefined ? row.unpriced + 1 : row.unpriced,
  };
}

function sumRows(rows: readonly DayStats[]): DayStats {
  return rows.reduce(
    (sum, row) => ({
      presses: sum.presses + row.presses,
      usd: sum.usd + row.usd,
      unpriced: sum.unpriced + row.unpriced,
    }),
    EMPTY_DAY,
  );
}

/**
 * What the whole machine spent on `day`: the field-wise sum of every writer's
 * row, this session's and every other's. The filter is the exact
 * `spend:<day>:` prefix, so neither another day's rows nor another key that
 * happens to contain the day is counted. A day with no legacy row is still
 * in the 0.4.x `stats` row, if anywhere, so that row's day is added instead:
 * a reader between another session's `set(legacy)` and `delete(stats)` sees
 * the legacy row and skips `stats`, so no interleaving counts the day twice;
 * one between its own key list and the `stats` read can under-read once.
 * The `stats` read is not a transient: every day after the upgrade day has
 * no legacy row, so each total costs one read of a missing key, by design
 * (caching "absent" here would hide a still-running 0.4.1 session's row).
 */
export async function dayTotal(
  $: EngineInterface,
  day: string,
): Promise<DayStats> {
  const prefix = spendKey(day, "");
  const keys = (await $.store.keys()).filter((key) => key.startsWith(prefix));
  const rows = await Promise.all(keys.map((key) => $.store.get(key)));
  const unmigrated = keys.includes(spendKey(day, LEGACY_WRITER))
    ? EMPTY_DAY
    : dayRow(asStats(await $.store.get(STATS_STORE_KEY)), day);
  return sumRows([...rows.map(asDayRow), unmigrated]);
}

/**
 * Deletes every row of a day before the local calendar day `KEPT_DAYS` back.
 * A calendar step, not `nowMs − 7 × 24 h`: at 23:30 the evening after clocks
 * go back, the latter lands at 00:30 the day after the seventh day back and
 * would prune that day's rows.
 */
async function prune($: EngineInterface, nowMs: number): Promise<void> {
  const d = new Date(nowMs);
  const cutoff = dayOf(
    new Date(d.getFullYear(), d.getMonth(), d.getDate() - KEPT_DAYS).getTime(),
  );
  for (const key of await $.store.keys()) {
    const day = dayOfKey(key);
    if (day !== undefined && day < cutoff) {
      await $.store.delete(key);
    }
  }
}

export function createLedger(writerId: string): Ledger {
  return { writerId, queue: Promise.resolve(), isMigrated: false };
}

/*
 * R18 (catalogue review of seed PR #341, finding 2): a writer's
 * read-modify-write runs one entry after the previous has settled (resolved
 * or rejected), so its second press reads the row its first wrote. `work`'s
 * own promise is returned (a caller still sees its own rejection) and the
 * tail is left resolved whatever `work` did, so a failed write never stalls
 * the next one.
 */
function serialized<T>(ledger: Ledger, work: () => Promise<T>): Promise<T> {
  const run = ledger.queue.then(work, work);
  ledger.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The 0.4.x row to per-day legacy rows, once per writer, inside its queue; a
 * failure leaves it due for the next write.
 */
async function migrateOnce(ledger: Ledger, $: EngineInterface): Promise<void> {
  if (ledger.isMigrated) {
    return;
  }
  const legacy = await $.store.get(STATS_STORE_KEY);
  if (legacy !== undefined) {
    const stats = asStats(legacy);
    for (const day of Object.keys(stats.byDay)) {
      const key = spendKey(day, LEGACY_WRITER);
      if ((await $.store.get(key)) === undefined) {
        await $.store.set(key, dayRow(stats, day));
      }
    }
    await $.store.delete(STATS_STORE_KEY);
  }
  ledger.isMigrated = true;
}

/**
 * One press, priced or not, added to `ledger`'s row for today: the 0.4.x row
 * migrated first if it is still there, the old rows pruned after. A prune
 * that fails is logged and swallowed: the press is recorded by then, and a
 * rejection here would reach record.ts as "recording its cost failed".
 */
export function recordPress(
  ledger: Ledger,
  $: EngineInterface,
  usd: number | undefined,
): Promise<void> {
  return serialized(ledger, async () => {
    const now = await $.clock.now();
    await migrateOnce(ledger, $);
    const key = spendKey(dayOf(now), ledger.writerId);
    const row = asDayRow(await $.store.get(key));
    await $.store.set(key, addCall(row, usd));
    try {
      await prune($, now);
    } catch (err) {
      $.ui.log(
        `prompt-lift: pruning old day rows failed: ${errorMessage(err)}`,
        { to: "debug" },
      );
    }
  });
}
