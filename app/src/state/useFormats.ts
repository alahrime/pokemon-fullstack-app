import { useCallback, useEffect, useState } from 'react';
import type { Format } from '../rules';
import { useSession } from './SessionContext';
import { deleteFormat, listFormats, saveFormat } from './formatStore';
import { deleteServerFormat, listServerFormats, saveServerFormat } from '../lib/saves';

export const MIGRATED_KEY = 'paragon.formats.migrated.v1';

export interface FormatsApi {
  formats: { id: string; name: string; format: Format }[];
  source: 'local' | 'server';
  loading: boolean;
  migrating: boolean;
  error: string | null;
  save: (name: string, format: Format, id?: string) => Promise<string>;
  remove: (id: string) => Promise<void>;
}

/**
 * Read the set of local ids already uploaded. Never throws: storage can be
 * corrupted, cleared, or written by an older build, and a migration that
 * explodes on a bad read is worse than one that just retries everything.
 */
function readMigrated(): string[] {
  try {
    const raw = localStorage.getItem(MIGRATED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function writeMigrated(ids: string[]): void {
  try {
    localStorage.setItem(MIGRATED_KEY, JSON.stringify(ids));
  } catch {
    // A full or unavailable quota is not worth taking the screen down for.
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * One migration attempt per signed-in user, held OUTSIDE React state and
 * shared across every mount of this hook.
 *
 * The bug this guards against: two mounts of the SAME hook — React
 * StrictMode's synchronous mount/cleanup/mount-again, or a real remount from
 * navigating away and back while a migration is still in flight — each call
 * `readMigrated()` before either has written anything, each compute the same
 * `missing` list, and each upload every one of them. `live` cannot catch
 * this: it is a flag on ONE effect closure, and the second mount is a
 * different closure with its own fresh `live = true`, unaware the first
 * run's uploads are still going. The only thing that survives a remount is
 * module scope, so the lock has to live here, not in a hook.
 *
 * Keyed by user id so a different signed-in user gets an independent
 * attempt, and cleared when an attempt settles so a LATER sign-in — by the
 * same user, after signing out and creating new local work — starts a fresh
 * one rather than being locked out forever by the first.
 */
const inFlightMigrations = new Map<string, Promise<void>>();

function migrate(userId: string, local: { id: string; name: string; format: Format }[]): Promise<void> {
  const existing = inFlightMigrations.get(userId);
  if (existing) return existing;

  const attempt = (async () => {
    const migrated = readMigrated();
    const missing = local.filter((f) => !migrated.includes(f.id));
    const done = [...migrated];
    for (const f of missing) {
      // eslint-disable-next-line no-await-in-loop -- one at a time, on
      // purpose: MIGRATED_KEY must only ever record an id whose upload has
      // already resolved, and a concurrent batch would make that ordering
      // unobservable per-format.
      await saveServerFormat({ name: f.name, format: f.format });
      done.push(f.id);
      writeMigrated(done);
    }
  })();

  // Stored SYNCHRONOUSLY, before this function returns and before `attempt`
  // reaches its first `await` — a second call for the same user id arriving
  // before this attempt settles, even one arriving in the very next
  // synchronous tick (StrictMode's remount), MUST see this entry already
  // present. That is the entire property this fixes.
  inFlightMigrations.set(userId, attempt);
  // `attempt` itself is fine: every caller reaches it via `await
  // migrate(...)` inside `run()`'s own try/catch, which attaches a real
  // handler and surfaces a rejection through `error` as usual. The problem
  // is this cleanup chain: `.finally()` returns a NEW derived promise that
  // rejects with the same reason if `attempt` rejects, and nothing else
  // holds a reference to THAT promise — Node reports it as unhandled even
  // though `attempt` was handled everywhere it matters. The trailing
  // `.catch(() => {})` only silences that derived promise; it does not touch
  // `attempt`, so it can't hide the rejection from anyone awaiting it.
  attempt
    .finally(() => {
      if (inFlightMigrations.get(userId) === attempt) {
        inFlightMigrations.delete(userId);
      }
    })
    .catch(() => {
      // No-op: see comment above.
    });
  return attempt;
}

/**
 * Formats for the signed-in user: local for a signed-out visitor, server for
 * a signed-in one, with a one-way migration between the two the first time a
 * local-format author signs in.
 *
 * The migration's failure mode is silent duplication or silent data loss, not
 * an error — so its two safety properties are load-bearing, not incidental:
 *
 * 1. A local id is appended to MIGRATED_KEY only AFTER its own upload
 *    resolves, one format at a time. Marking first (or marking as a batch
 *    after the whole loop) would mean a failed upload is permanently skipped
 *    on the next retry, because it already looks migrated.
 * 2. The local copy is never deleted. A migration that deletes loses work
 *    the moment a LATER upload in the same batch fails — the ones already
 *    removed cannot be retried from anywhere.
 */
export function useFormats(): FormatsApi {
  const { user } = useSession();
  const [formats, setFormats] = useState<{ id: string; name: string; format: Format }[]>([]);
  const [source, setSource] = useState<'local' | 'server'>('local');
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        if (!user) {
          if (!live) return;
          setFormats(listFormats().map((f) => ({ id: f.id, name: f.name, format: f.format })));
          setSource('local');
          return;
        }

        if (live) setMigrating(true);
        // Whatever mount actually does the uploading, EVERY mount for this
        // user id awaits the same shared attempt — see `migrate` above.
        await migrate(user.id, listFormats());

        const server = await listServerFormats();
        if (!live) return;
        setFormats(server.map((s) => ({ id: s.id, name: s.name, format: s.format })));
        setSource('server');
      } catch (e) {
        if (!live) return;
        setError(messageOf(e));
        // Additive, not replacing: a failed migration upload or a failed
        // listServerFormats leaves this catch with formats still at its
        // initial `[]` and nothing to say why. The user's local formats are
        // still sitting on disk right where `migrate()` left them (it never
        // deletes what it uploads) — show those rather than an empty screen
        // that gives no sign anything is wrong except the separate `error`
        // string.
        setFormats(listFormats().map((f) => ({ id: f.id, name: f.name, format: f.format })));
        setSource('local');
      } finally {
        if (live) {
          setLoading(false);
          setMigrating(false);
        }
      }
    }

    void run();
    return () => {
      live = false;
    };
    // Re-run only when who is signed in actually changes, not on every render
    // that happens to hold a structurally-equal-but-new session object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const save = useCallback(
    async (name: string, format: Format, id?: string) => {
      if (!user) {
        const entry = saveFormat(name, format, id);
        setFormats(listFormats().map((f) => ({ id: f.id, name: f.name, format: f.format })));
        setSource('local');
        return entry.id;
      }
      try {
        const savedId = await saveServerFormat({ id, name, format });
        const server = await listServerFormats();
        setFormats(server.map((s) => ({ id: s.id, name: s.name, format: s.format })));
        setSource('server');
        return savedId;
      } catch (e) {
        setError(messageOf(e));
        // The caller (the screen) still awaits a string back; without a
        // saved id to report, the id it already had is the correct thing to
        // hand back — it lets a retry with the SAME id go through as an
        // update rather than minting a duplicate on the next click.
        return id ?? '';
      }
    },
    [user],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) {
        deleteFormat(id);
        setFormats(listFormats().map((f) => ({ id: f.id, name: f.name, format: f.format })));
        setSource('local');
        return;
      }
      try {
        await deleteServerFormat(id);
        const server = await listServerFormats();
        setFormats(server.map((s) => ({ id: s.id, name: s.name, format: s.format })));
        setSource('server');
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [user],
  );

  return { formats, source, loading, migrating, error, save, remove };
}
