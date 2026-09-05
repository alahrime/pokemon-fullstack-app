import { createClient } from 'jsr:@supabase/supabase-js@2';
// The esbuild output carries no type declarations, so Deno sees `any` here.
// That is deliberate and is exactly why Task 9 exists: the only thing checking
// that this is the same function the browser runs is a test that runs both.
// @ts-types="./rules.bundle.d.ts"
import { rulesHash } from './rules.bundle.js';

/**
 * The coordinator tick.
 *
 * Runs as the service role, which bypasses every policy — so it must be the
 * only thing here that needs to. It does exactly what SQL cannot: recompute a
 * format's hash with the client's own code. Everything else is a function call.
 */
Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let verified = 0;
  for (const table of ['queue_entries', 'match_offers'] as const) {
    const { data, error } = await admin
      .from(table)
      .select('id, claimed_hash, format_versions!inner(rules)')
      .is('verified_hash', null)
      .limit(200);
    if (error) return new Response(error.message, { status: 500 });

    for (const row of data ?? []) {
      const r = row as unknown as { id: string; claimed_hash: string; format_versions: { rules: unknown } };
      let actual: string;
      try {
        actual = await rulesHash(r.format_versions.rules);
      } catch {
        // `format_versions.rules` is `jsonb not null` with no shape
        // constraint, and `canonicalize()` dereferences `f.pool.map(...)`,
        // `f.composition` and `f.selection` unguarded. Anyone can save `{}`
        // there. Unwrapped, the TypeError rejects this handler — which does
        // not merely skip the row: the `pair_queue_entries` and
        // `sweep_expired` calls sit AFTER this loop, so the whole tick dies,
        // the row keeps `verified_hash null` and is re-read every minute
        // forever, and one user permanently disables verification, pairing
        // and expiry for everybody. The catch is the whole point; what to do
        // inside it is the smaller question.
        //
        // DELETE, on the same branch as a wrong hash, rather than skip.
        // `claimed_hash` asserts a value derived from these rules. If the
        // rules cannot be canonicalized at all then no client running this
        // same code could have derived ANY hash from them, so the claim is
        // not merely wrong, it is unverifiable by construction — the same
        // consequence as a lie, reached by a different route, and the row can
        // never become eligible however many ticks it sees.
        //
        // Skipping is the tempting answer and it is the one that rots. A
        // skipped queue entry does expire out within ten minutes, but a
        // skipped OFFER does not: `sweep_expired` moves it to 'lapsed' and
        // leaves the row, and this query filters on `verified_hash is null`
        // with no state filter, so every unhashable offer ever posted stays
        // in the candidate set permanently and eventually fills the 200-row
        // window — starving every honest row behind it. That is the same
        // denial this catch exists to prevent, arriving more slowly.
        await admin.from(table).delete().eq('id', r.id);
        continue;
      }
      if (actual !== r.claimed_hash) {
        // The claim was wrong. Drop the entry rather than correcting it: a
        // client that computed a different hash disagrees with the server about
        // what its own format IS, and silently requeueing it under the real
        // hash would put someone into a match on terms they did not compute.
        await admin.from(table).delete().eq('id', r.id);
        continue;
      }
      await admin.from(table).update({ verified_hash: actual }).eq('id', r.id);
      verified++;
    }
  }

  const { data: paired } = await admin.rpc('pair_queue_entries');
  const { data: swept } = await admin.rpc('sweep_expired');
  const { data: sweptMatches } = await admin.rpc('sweep_matches');
  return Response.json({ verified, paired, swept, matches: sweptMatches ?? 0 });
});
