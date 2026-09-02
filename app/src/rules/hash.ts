import { canonicalize } from './canonical';
import type { Format } from './types';

/**
 * The queue identity of a format.
 *
 * `canonicalize` decides what "the same rules" means — key order irrelevant,
 * notes irrelevant, clause order significant. This only compresses that string
 * into something worth indexing.
 *
 * `crypto.subtle` rather than a Node import on purpose: this exact function
 * runs in the browser AND in the Edge Function that recomputes the hash it
 * refuses to take on trust. Two implementations would be two answers.
 */
export async function rulesHash(format: Format): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(format));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
