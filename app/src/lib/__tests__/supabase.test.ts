import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The client's construction, not its behaviour.
 *
 * `createClient` is mocked at the package boundary so nothing here opens a
 * socket; what is under test is the reading of the environment and the failure
 * when it is absent. The module builds its client at import time, so every
 * case resets the module registry and imports again — a cached module would
 * report the first test's environment for all of them.
 */
const pkg = vi.hoisted(() => ({ createClient: vi.fn(() => ({ tag: 'client' })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: pkg.createClient }));

async function load() {
  vi.resetModules();
  pkg.createClient.mockClear();
  return import('../supabase');
}

afterEach(() => vi.unstubAllEnvs());

describe('the browser Supabase client', () => {
  it('is built from the configured URL and anon key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    const mod = await load();
    expect(pkg.createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'sb_publishable_test');
    expect(mod.supabase).toBe(pkg.createClient.mock.results[0].value);
  });

  it('refuses to start without a URL, and says where to look', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', undefined);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    await expect(load()).rejects.toThrow(/VITE_SUPABASE_URL[\s\S]*\.env\.example/);
    expect(pkg.createClient).not.toHaveBeenCalled();
  });

  it('refuses to start without an anon key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', undefined);
    await expect(load()).rejects.toThrow(/VITE_SUPABASE_ANON_KEY[\s\S]*\.env\.example/);
  });

  /**
   * An empty value is the shape a half-filled `.env.local` actually takes —
   * `VITE_SUPABASE_URL=` with nothing after it. It has to fail like an absent
   * one, or the client is built with an empty URL and fails later, somewhere
   * with no clue attached.
   */
  it('treats an empty value as missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_test');
    await expect(load()).rejects.toThrow(/VITE_SUPABASE_URL/);
  });

  /** The one key that must never be here. Named so the message is a warning. */
  it('names the service role key as the thing not to paste in', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', undefined);
    await expect(load()).rejects.toThrow(/SERVICE ROLE/i);
  });
});
