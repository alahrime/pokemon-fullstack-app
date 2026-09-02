import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { RULES_SCHEMA, type Format } from '../../rules';

/**
 * The dual-store migration: local formats move to the server for a signed-in
 * user, without ever losing or duplicating what localStorage already holds.
 *
 * `../../lib/saves` is mocked at the module boundary, the same way
 * `team-saves.test.tsx` mocks it — the round trip through Supabase belongs to
 * `saves.test.ts`. `formatStore` is NOT mocked: it is real localStorage
 * (jsdom provides it), because the property under test is what actually ends
 * up there, not what a mock claims ended up there.
 */

const savesApi = vi.hoisted(() => ({
  listServerFormats: vi.fn(),
  saveServerFormat: vi.fn(),
  deleteServerFormat: vi.fn(),
}));
vi.mock('../../lib/saves', () => savesApi);

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

function fakeSession(email: string): Session {
  return { access_token: 'tok', user: { id: 'user-1', email } } as unknown as Session;
}

function fakeClient(session: Session | null) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  pkg.client = { auth };
  return auth;
}

// No `as Format` cast: every required field is present, so the annotation
// alone type-checks — a cast would hide the next real mismatch.
const FORMAT: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

/**
 * `lib/supabase` builds its client once at import time, and `formatStore`
 * keeps a module-scoped monotonic counter — both need a fresh module graph
 * per test, the same reason sign-in.test.tsx and team-saves.test.tsx reset
 * modules and import dynamically inside the harness.
 */
async function harness(session: Session | null) {
  fakeClient(session);
  vi.resetModules();
  const formatStore = await import('../formatStore');
  const { SessionProvider } = await import('../SessionContext');
  const { useFormats, MIGRATED_KEY } = await import('../useFormats');
  return { formatStore, SessionProvider, useFormats, MIGRATED_KEY };
}

/**
 * `renderHook` itself only flushes a synchronous first render. `SessionProvider`
 * resolves who is signed in asynchronously (`getSession()`), which means the
 * hook's effect runs once for "nobody yet" and again once the real session
 * lands — a mount not wrapped in an async `act` can let a test's `waitFor`
 * observe the FIRST, transient `loading: false` instead of the second, real
 * one. Wrapping in `act(async () => …)`, the same way sign-in.test.tsx and
 * team-saves.test.tsx wrap their `render(...)`, drains that whole chain
 * before the mount call returns.
 */
async function mountFormats(useFormats: () => unknown, SessionProvider: ComponentType<{ children: ReactNode }>) {
  let hook!: ReturnType<typeof renderHook>;
  await act(async () => {
    hook = renderHook(() => useFormats(), {
      wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>,
    });
  });
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  savesApi.listServerFormats.mockReset().mockResolvedValue([]);
  savesApi.saveServerFormat.mockReset().mockImplementation(async () => 'server-id');
  savesApi.deleteServerFormat.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('migration ordering — the safety property', () => {
  /**
   * If MIGRATED_KEY were written before the upload resolved (or independent
   * of it), a failed upload would still be marked done and lost forever on
   * retry. A test that only checks the end state ("both formats ended up on
   * the server") cannot tell that apart from this — it has to compare WHEN
   * each write happened, not just THAT it happened.
   *
   * Both `saveServerFormat` (a `vi.fn()`) and `localStorage.setItem` (spied
   * with `vi.spyOn`) are Vitest mocks, so Vitest's shared invocation-order
   * counter lets their calls be compared directly: if the correct call
   * ordering were violated by swapping "mark" and "upload", this assertion —
   * not merely the end-state one — is what catches it.
   */
  it("appends a format's local id to MIGRATED_KEY only after its own upload resolves", async () => {
    const { formatStore, SessionProvider, useFormats, MIGRATED_KEY } = await harness(
      fakeSession('ash@example.com'),
    );
    const a = formatStore.saveFormat('Format A', FORMAT);
    const b = formatStore.saveFormat('Format B', FORMAT);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const { result } = await mountFormats(useFormats, SessionProvider);
      await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

      expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(2);

      const uploadOrder = (name: string) => {
        const i = savesApi.saveServerFormat.mock.calls.findIndex(
          (args) => (args[0] as { name: string }).name === name,
        );
        expect(i).toBeGreaterThanOrEqual(0);
        return savesApi.saveServerFormat.mock.invocationCallOrder[i];
      };

      const migratedOrderContaining = (id: string) => {
        const calls = setItemSpy.mock.calls
          .map((args, i) => ({ key: args[0], value: args[1] as string, order: setItemSpy.mock.invocationCallOrder[i] }))
          .filter((c) => c.key === MIGRATED_KEY);
        const hit = calls.find((c) => {
          try {
            return (JSON.parse(c.value) as unknown[]).includes(id);
          } catch {
            return false;
          }
        });
        expect(hit).toBeTruthy();
        return hit!.order;
      };

      // For EACH format, its own upload's call order must precede the first
      // MIGRATED_KEY write that records its id — not just "some upload
      // happened before some write."
      expect(migratedOrderContaining(a.id)).toBeGreaterThan(uploadOrder('Format A'));
      expect(migratedOrderContaining(b.id)).toBeGreaterThan(uploadOrder('Format B'));
    } finally {
      setItemSpy.mockRestore();
    }
  });
});

/**
 * The defect this round exists to fix: React StrictMode (or a real remount —
 * a user navigating off the Formats screen and straight back while a
 * migration is still uploading) mounts this hook twice for the SAME signed-in
 * user before the first mount's migration has finished. Each mount used to
 * read `MIGRATED_KEY` independently, see it empty, and upload every local
 * format itself — two formats became four server rows.
 *
 * A test that only checks the end state ("both formats ended up on the
 * server") cannot see this: four calls and two calls both leave two rows
 * behind if `saveServerFormat`'s mock is a naive upsert-by-name. The count of
 * calls to `saveServerFormat` is the only thing that distinguishes "shared
 * one attempt" from "raced two attempts," which is why this test asserts
 * that count directly rather than the resulting list.
 */
describe('two mounts of the same signed-in user, overlapping mid-migration', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('calls saveServerFormat exactly once per local format across both mounts, not once per mount', async () => {
    const { formatStore, SessionProvider, useFormats } = await harness(fakeSession('ash@example.com'));
    formatStore.saveFormat('Format A', FORMAT);
    formatStore.saveFormat('Format B', FORMAT);

    // Each call to saveServerFormat gets its own controllable promise, so the
    // test decides exactly when each upload resolves rather than racing
    // against real microtask timing.
    const pending: ReturnType<typeof deferred<string>>[] = [];
    savesApi.saveServerFormat.mockImplementation(() => {
      const d = deferred<string>();
      pending.push(d);
      return d.promise;
    });

    // First mount starts the migration and stalls on Format A's upload,
    // which has not been resolved yet.
    const first = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(1));

    // Second mount, for the SAME user id, arrives while that upload is still
    // in flight — the exact race the module-level lock exists to close.
    const second = await mountFormats(useFormats, SessionProvider);

    // Let any microtask queued by the second mount's effect run before
    // asserting nothing new was called — if the guard were missing, the
    // second mount's own `readMigrated()` + upload loop would fire here.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(1);

    // Resolve the uploads one at a time, the way real network responses
    // would arrive, and let both mounts settle.
    pending[0].resolve('server-a');
    await waitFor(() => expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(2));
    pending[1].resolve('server-b');
    await waitFor(() => expect((first.result.current as { loading: boolean }).loading).toBe(false));
    await waitFor(() => expect((second.result.current as { loading: boolean }).loading).toBe(false));

    // The assertion that actually distinguishes "shared one attempt" from
    // "two independent attempts": exactly one call per local format, not one
    // per (format × mount).
    expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(2);
    const names = savesApi.saveServerFormat.mock.calls.map((c) => (c[0] as { name: string }).name).sort();
    expect(names).toEqual(['Format A', 'Format B']);

    first.unmount();
    second.unmount();
  });
});

describe('signed out', () => {
  it('source is local, formats come from formatStore, and saving writes to localStorage and never touches the client', async () => {
    const { formatStore, SessionProvider, useFormats } = await harness(null);
    formatStore.saveFormat('Local One', FORMAT);

    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    const api = result.current as {
      source: string;
      formats: { name: string }[];
      save: (name: string, format: Format, id?: string) => Promise<string>;
    };
    expect(api.source).toBe('local');
    expect(api.formats.map((f) => f.name)).toEqual(['Local One']);

    await act(async () => {
      await api.save('Local Two', FORMAT);
    });

    expect(formatStore.listFormats().map((f) => f.name)).toEqual(
      expect.arrayContaining(['Local One', 'Local Two']),
    );
    expect(savesApi.listServerFormats).not.toHaveBeenCalled();
    expect(savesApi.saveServerFormat).not.toHaveBeenCalled();
    expect(savesApi.deleteServerFormat).not.toHaveBeenCalled();
  });

  /**
   * The regression a first pass of this hook shipped: `save` returned
   * `Promise<void>`, so the screen had nowhere to learn the id a fresh save
   * had just been given, and a second Save without reloading minted a new
   * entry instead of updating the first. The count is what distinguishes an
   * update from a duplicate — asserting only that a second save "did
   * something" would pass under either behaviour.
   */
  it('a second save without reloading updates the same entry rather than creating a duplicate', async () => {
    const { formatStore, SessionProvider, useFormats } = await harness(null);
    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    const api = result.current as {
      save: (name: string, format: Format, id?: string) => Promise<string>;
    };

    let editing: string | undefined;
    await act(async () => {
      editing = await api.save('Format A', FORMAT);
    });
    await act(async () => {
      await api.save('Format A v2', FORMAT, editing);
    });

    const all = formatStore.listFormats();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Format A v2');
  });
});

describe('signed in with nothing local', () => {
  it('source is server, and listServerFormats is what is read', async () => {
    savesApi.listServerFormats.mockResolvedValue([
      { id: 'srv-1', name: 'Remote Format', format: FORMAT, version: 1, rulesHash: 'x' },
    ]);
    const { SessionProvider, useFormats } = await harness(fakeSession('ash@example.com'));

    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    const api = result.current as { source: string; formats: { id: string; name: string }[] };
    expect(api.source).toBe('server');
    expect(api.formats).toEqual([{ id: 'srv-1', name: 'Remote Format', format: FORMAT }]);
  });
});

describe('signed in with two local formats and nothing migrated yet', () => {
  it('uploads both exactly once, and MIGRATED_KEY records their local ids', async () => {
    const { formatStore, SessionProvider, useFormats, MIGRATED_KEY } = await harness(
      fakeSession('ash@example.com'),
    );
    const a = formatStore.saveFormat('Format A', FORMAT);
    const b = formatStore.saveFormat('Format B', FORMAT);

    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(2);
    const uploadedNames = savesApi.saveServerFormat.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(uploadedNames.sort()).toEqual(['Format A', 'Format B']);

    const recorded = JSON.parse(localStorage.getItem(MIGRATED_KEY) ?? '[]') as string[];
    expect(recorded.sort()).toEqual([a.id, b.id].sort());
  });
});

describe('after a successful migration', () => {
  it('the local copy still exists — a migration that deletes loses work when the second upload fails', async () => {
    const { formatStore, SessionProvider, useFormats } = await harness(fakeSession('ash@example.com'));
    const a = formatStore.saveFormat('Format A', FORMAT);
    const b = formatStore.saveFormat('Format B', FORMAT);

    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    const localIds = formatStore.listFormats().map((f) => f.id);
    expect(localIds).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});

describe('a second sign-in', () => {
  it('does not upload already-migrated formats again', async () => {
    const { formatStore, SessionProvider, useFormats } = await harness(fakeSession('ash@example.com'));
    formatStore.saveFormat('Format A', FORMAT);
    formatStore.saveFormat('Format B', FORMAT);

    const first = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((first.result.current as { loading: boolean }).loading).toBe(false));
    expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(2);
    first.unmount();

    // A fresh mount of the hook, as a second sign-in would produce — same
    // localStorage (formatStore's rows AND MIGRATED_KEY both persist across
    // it, since nothing here clears them).
    const second = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((second.result.current as { loading: boolean }).loading).toBe(false));

    expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(2);
    second.unmount();
  });
});

describe('a failed upload', () => {
  it('leaves MIGRATED_KEY untouched so it retries next time, and surfaces error rather than throwing into the screen', async () => {
    savesApi.saveServerFormat.mockRejectedValue(new Error('network is down'));
    const { formatStore, SessionProvider, useFormats, MIGRATED_KEY } = await harness(
      fakeSession('ash@example.com'),
    );
    const a = formatStore.saveFormat('Format A', FORMAT);

    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    const api = result.current as { error: string | null; formats: { id: string; name: string }[]; source: string };
    expect(api.error).toBeTruthy();
    expect(api.error).toMatch(/network is down/);

    // Untouched, not "written but empty" — MIGRATED_KEY was never set at all.
    expect(localStorage.getItem(MIGRATED_KEY)).toBeNull();
    // The local copy is unaffected by the failed attempt, so a retry has
    // something to retry.
    expect(formatStore.listFormats().map((f) => f.id)).toContain(a.id);

    // Additive, not a blank screen: the catch used to return with `formats`
    // stuck at its initial `[]`, leaving a signed-in user whose local
    // formats are sitting right there on disk staring at nothing and no clue
    // why. This is the assertion that actually distinguishes the fix — the
    // three above all held even when `formats` stayed empty.
    expect(api.formats.map((f) => f.id)).toContain(a.id);
    expect(api.source).toBe('local');
  });

  it('falls back to local formats when listServerFormats fails even though the migration itself succeeded', async () => {
    // A distinct path through the same catch: every local format uploads
    // fine, and the failure is the read immediately after.
    savesApi.listServerFormats.mockRejectedValue(new Error('gateway timeout'));
    const { formatStore, SessionProvider, useFormats } = await harness(fakeSession('ash@example.com'));
    const a = formatStore.saveFormat('Format A', FORMAT);

    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    const api = result.current as { error: string | null; formats: { id: string; name: string }[]; source: string };
    expect(api.error).toMatch(/gateway timeout/);
    expect(api.formats.map((f) => f.id)).toContain(a.id);
    expect(api.source).toBe('local');
  });
});

describe('migration with nothing local', () => {
  it('is skipped entirely — no upload call is made at all', async () => {
    const { SessionProvider, useFormats, MIGRATED_KEY } = await harness(fakeSession('ash@example.com'));

    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    expect(savesApi.saveServerFormat).not.toHaveBeenCalled();
    expect(localStorage.getItem(MIGRATED_KEY)).toBeNull();
  });
});

describe('a second save without reloading, signed in', () => {
  it("passes the id the first save's server row got, not undefined, so the server updates rather than duplicates", async () => {
    const { SessionProvider, useFormats } = await harness(fakeSession('ash@example.com'));
    const { result } = await mountFormats(useFormats, SessionProvider);
    await waitFor(() => expect((result.current as { loading: boolean }).loading).toBe(false));

    const api = result.current as {
      save: (name: string, format: Format, id?: string) => Promise<string>;
    };

    let editing: string | undefined;
    await act(async () => {
      editing = await api.save('Format A', FORMAT);
    });
    // The default beforeEach mock resolves every saveServerFormat call to
    // the same fixed id — good enough here, since what is under test is
    // whether the SCREEN-LEVEL id round-trips into the second call's
    // argument, not what the server happens to hand back.
    expect(editing).toBeTruthy();
    expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(1);
    expect((savesApi.saveServerFormat.mock.calls[0][0] as { id?: string }).id).toBeUndefined();

    await act(async () => {
      await api.save('Format A v2', FORMAT, editing);
    });

    expect(savesApi.saveServerFormat).toHaveBeenCalledTimes(2);
    const secondCallArg = savesApi.saveServerFormat.mock.calls[1][0] as { id?: string; name: string };
    expect(secondCallArg.id).toBe(editing);
    expect(secondCallArg.id).not.toBeUndefined();
    expect(secondCallArg.name).toBe('Format A v2');
  });
});
