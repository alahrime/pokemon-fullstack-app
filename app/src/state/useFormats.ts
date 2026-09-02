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

        const migrated = readMigrated();
        const local = listFormats();
        const missing = local.filter((f) => !migrated.includes(f.id));

        if (missing.length > 0) {
          if (live) setMigrating(true);
          const done = [...migrated];
          for (const f of missing) {
            // eslint-disable-next-line no-await-in-loop -- one at a time, on
            // purpose: MIGRATED_KEY must only ever record an id whose upload
            // has already resolved, and a concurrent batch would make that
            // ordering unobservable per-format.
            await saveServerFormat({ name: f.name, format: f.format });
            done.push(f.id);
            writeMigrated(done);
          }
        }

        const server = await listServerFormats();
        if (!live) return;
        setFormats(server.map((s) => ({ id: s.id, name: s.name, format: s.format })));
        setSource('server');
      } catch (e) {
        if (!live) return;
        setError(messageOf(e));
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
