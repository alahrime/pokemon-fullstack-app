/**
 * An OAuth round trip that Supabase reports as failed, entirely through the
 * URL it redirects back to — there is no API call to catch this from.
 *
 * `error`, `error_code` and `error_description` land in the hash fragment for
 * the implicit flow and the query string for PKCE; this app does not choose
 * which, Supabase does, so both must be read. `error_description` arrives
 * `application/x-www-form-urlencoded` — `+` for spaces — which is exactly why
 * `Unable+to+exchange+external+code` must never reach a human unmodified;
 * `URLSearchParams` decodes it correctly on the way in.
 *
 * `supabase-js` (`@supabase/auth-js`'s `_getSessionFromURL`) only clears the
 * URL on a *successful* callback — on an error it throws before reaching that
 * code, so the error survives in the address bar indefinitely, not just for
 * one tick. Confirmed against the running dev server: loading
 * `http://localhost:5173/#error=server_error&error_description=test+message`
 * left that hash in place, byte for byte, seconds after the client had run.
 * Reading it from inside a mounted component is therefore not a race — but
 * this app still needs to clear it once read, or a later refresh would show a
 * stale failure as if it had just happened again.
 */

export interface OAuthUrlError {
  /** Readable text — already `+`-decoded. Never the raw provider string. */
  description: string;
  /** The part that tells a bad client secret apart from a disallowed redirect. */
  code: string | null;
}

/** The only three keys this reads or clears; everything else on the URL is left alone. */
const ERROR_KEYS = ['error', 'error_code', 'error_description'] as const;

function paramsFrom(raw: string): URLSearchParams {
  // Both `location.hash` and `location.search` include their leading
  // `#`/`?`, which `URLSearchParams` would otherwise fold into the first key.
  return new URLSearchParams(raw.replace(/^[#?]/, ''));
}

function extract(params: URLSearchParams): OAuthUrlError | null {
  const error = params.get('error');
  const description = params.get('error_description');
  const code = params.get('error_code');
  if (error === null && description === null && code === null) return null;
  return { description: description ?? error ?? 'Sign-in failed.', code };
}

/**
 * Reads an OAuth error off the current URL, checking the hash fragment first
 * and then the query string. Returns null when neither carries one.
 */
export function readOAuthUrlError(loc: Location = window.location): OAuthUrlError | null {
  return extract(paramsFrom(loc.hash)) ?? extract(paramsFrom(loc.search));
}

/**
 * Strips the OAuth error keys from both the hash and the query string,
 * leaving any other param (`?audit=sprites`) untouched. A no-op when there is
 * nothing to strip. Call this only after the value has been captured — it is
 * the only copy.
 */
export function clearOAuthUrlError(loc: Location = window.location): void {
  const hash = paramsFrom(loc.hash);
  const search = paramsFrom(loc.search);
  let changed = false;
  for (const key of ERROR_KEYS) {
    if (hash.has(key)) {
      hash.delete(key);
      changed = true;
    }
    if (search.has(key)) {
      search.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  const url = new URL(loc.href);
  url.hash = hash.toString();
  url.search = search.toString();
  window.history.replaceState(window.history.state, '', url.toString());
}
