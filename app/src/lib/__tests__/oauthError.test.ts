import { describe, it, expect, afterEach } from 'vitest';
import { readOAuthUrlError, clearOAuthUrlError } from '../oauthError';

/**
 * Supabase reports a failed OAuth round trip on the URL, not through any API
 * call: `error`, `error_code` and `error_description` (`+`-encoded, per
 * `application/x-www-form-urlencoded`) land in the hash fragment for the
 * implicit flow this app used to request and the query string for PKCE. Which
 * one arrives is Supabase's choice, not this app's, so both must be read.
 */

function setUrl(hash: string, search: string) {
  window.history.replaceState(null, '', `/${search}${hash}`);
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('readOAuthUrlError', () => {
  it('reads error, error_code and error_description out of the hash fragment', () => {
    setUrl('#error=server_error&error_code=server_error&error_description=Unable+to+exchange+external+code', '');
    const err = readOAuthUrlError();
    expect(err).toEqual({ description: 'Unable to exchange external code', code: 'server_error' });
  });

  it('reads the same three keys out of the query string, for the PKCE flow', () => {
    setUrl('', '?error=access_denied&error_code=access_denied&error_description=User+denied+access');
    const err = readOAuthUrlError();
    expect(err).toEqual({ description: 'User denied access', code: 'access_denied' });
  });

  it('returns null when neither the hash nor the query string carry an OAuth error', () => {
    setUrl('', '?audit=sprites');
    expect(readOAuthUrlError()).toBeNull();
  });

  it('is fine with a `+`-free description too', () => {
    setUrl('#error=server_error&error_description=broken', '');
    expect(readOAuthUrlError()).toEqual({ description: 'broken', code: null });
  });
});

describe('clearOAuthUrlError', () => {
  it('strips the three OAuth keys from the hash, leaving the rest of the URL alone', () => {
    setUrl('#error=server_error&error_code=server_error&error_description=Unable+to+exchange+external+code', '?audit=sprites');
    clearOAuthUrlError();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?audit=sprites');
  });

  it('strips the three OAuth keys from the query string, leaving other params alone', () => {
    setUrl('', '?audit=sprites&error=access_denied&error_code=access_denied&error_description=User+denied+access');
    clearOAuthUrlError();
    expect(window.location.search).toBe('?audit=sprites');
    expect(window.location.hash).toBe('');
  });

  it('leaves a URL with no OAuth error untouched', () => {
    setUrl('', '?audit=sprites');
    clearOAuthUrlError();
    expect(window.location.search).toBe('?audit=sprites');
  });
});
