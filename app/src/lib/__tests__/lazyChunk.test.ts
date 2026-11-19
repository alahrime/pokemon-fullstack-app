import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkError, recoverChunk } from '../lazyChunk';

// The message each engine gives when a stale deploy's chunk comes back as index.html.
const stale = new TypeError('Failed to fetch dynamically imported module: https://x/assets/RankingsScreen-abc.js');

describe('recoverChunk', () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  afterEach(() => { reload.mockClear(); sessionStorage.clear(); });

  it('recognises chunk failures across browsers, and nothing else', () => {
    expect(isChunkError(stale)).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkError(new Error('x is undefined'))).toBe(false);
  });

  it('reloads once on a stale chunk and stays suspended, then lets a repeat failure through', async () => {
    let settled = false;
    void recoverChunk(stale).then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    // Still failing straight after the reload: no loop, the boundary gets it.
    expect(() => recoverChunk(stale)).toThrow(stale);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rethrows ordinary errors without reloading', () => {
    const e = new Error('render bug');
    expect(() => recoverChunk(e)).toThrow(e);
    expect(reload).not.toHaveBeenCalled();
  });
});
