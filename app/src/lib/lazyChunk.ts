import { lazy, type ComponentType } from 'react';

/**
 * `React.lazy` that survives a deploy.
 *
 * Chunk names are content-hashed, and production deploys on every push. A tab
 * opened before a deploy still holds the old entry chunk, so its next lazy
 * screen asks for `RankingsScreen-<old hash>.js` — which no longer exists, and
 * the host's SPA fallback answers with index.html (200, text/html). The browser
 * rejects that as a module: "Failed to fetch dynamically imported module".
 *
 * Retrying the same URL cannot help (the module map caches the failure, and the
 * file is gone anyway), so the fix is a reload, which picks up the new entry
 * chunk. The screen lives in the URL hash, so the reload lands on the tab that
 * was clicked. A short sessionStorage guard stops a reload loop when the chunk
 * is genuinely unreachable (offline); then the error reaches the ErrorBoundary.
 */
const KEY = 'chunk-reload-at';
const LOOP_MS = 10_000;

export const isChunkError = (e: unknown) =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload/i.test(e.message);

export function recoverChunk<T>(e: unknown): Promise<T> {
  if (isChunkError(e)) {
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last > LOOP_MS) {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
      window.location.reload();
      // Stay suspended (loading screen up) until the reload replaces the page.
      return new Promise<T>(() => {});
    }
  }
  throw e;
}

export const lazyChunk = <T extends ComponentType<any>>(load: () => Promise<{ default: T }>) =>
  lazy(() => load().catch((e) => recoverChunk<{ default: T }>(e)));
