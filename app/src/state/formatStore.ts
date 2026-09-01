import { RULES_SCHEMA, type Format } from '../rules';

export const STORAGE_KEY = 'paragon.formats.v1';

let monotonic = 0;

export interface StoredFormat {
  id: string;
  name: string;
  format: Format;
  updatedAt: number;
  _seq?: number;
}

/**
 * Formats, kept in localStorage until there is a server to keep them on.
 *
 * Two things this deliberately does not do. It does not throw on bad input:
 * storage can be corrupted, cleared or written by an older build, and a format
 * list that explodes takes the whole screen with it — an empty list is a
 * recoverable state and an exception is not. And it does not migrate unknown
 * schema versions, it drops them, because guessing at the meaning of a ruleset
 * silently changes which teams are legal.
 */
function read(): StoredFormat[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const formats = parsed.filter(
      (x): x is StoredFormat =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as StoredFormat).id === 'string' &&
        typeof (x as StoredFormat).name === 'string' &&
        !!(x as StoredFormat).format &&
        (x as StoredFormat).format.schema === RULES_SCHEMA &&
        // Shallow structural check: validate the format has a body, not just a schema number.
        // This mirrors app/src/lib/artefact.ts, which validates presence of the keys each
        // reader depends on rather than deep-walking the contents. Storage can be written
        // by an older build that lacked fields; this guards against a format that passes
        // the schema check but lacks pool, composition, or selection, which would crash
        // when lintFormat() or the builder screen dereferences them.
        Array.isArray((x as StoredFormat).format.pool) &&
        !!((x as StoredFormat).format.composition) &&
        typeof (x as StoredFormat).format.composition === 'object' &&
        !!((x as StoredFormat).format.selection) &&
        typeof (x as StoredFormat).format.selection === 'object',
    );
    // Restore monotonic counter from stored sequence numbers
    const maxSeq = Math.max(0, ...formats.map((f) => f._seq ?? 0));
    monotonic = maxSeq;
    return formats;
  } catch {
    return [];
  }
}

function write(all: StoredFormat[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A full or unavailable quota is not worth taking the screen down for.
  }
}

/** Saved formats, most recently updated first. */
export function listFormats(): StoredFormat[] {
  return read().sort((a, b) => {
    const timeDiff = b.updatedAt - a.updatedAt;
    if (timeDiff !== 0) return timeDiff;
    // Tiebreaker: use sequence number for stable ordering
    return (b._seq ?? 0) - (a._seq ?? 0);
  });
}

export function saveFormat(name: string, format: Format, id?: string): StoredFormat {
  const all = read();
  monotonic++;
  const entry: StoredFormat = {
    id: id ?? `f${monotonic.toString(36)}`,
    name,
    format,
    updatedAt: Date.now(),
    _seq: monotonic,
  };
  write([...all.filter((x) => x.id !== entry.id), entry]);
  return entry;
}

export function deleteFormat(id: string): void {
  write(read().filter((x) => x.id !== id));
}
