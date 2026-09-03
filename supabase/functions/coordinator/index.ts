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
      const actual = await rulesHash(r.format_versions.rules);
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
  return Response.json({ verified, paired, swept });
});
