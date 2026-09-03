import { supabase } from './supabase';
import { rulesHash, type Format } from '../rules';
import type { LeagueId } from './types';
import type { StoredMember } from './teamCodec';

export interface SavedTeam {
  id: string;
  name: string;
  league: LeagueId;
  size: 3 | 6;
  members: StoredMember[];
}

/**
 * `owner_id` is never sent from here. It defaults to `auth.uid()` in the
 * database, so who owns a row is decided in one place; a client-supplied owner
 * is a second source of truth the policy then has to agree with.
 *
 * `size` is required, not optional: GBL and Show 6 render the same
 * TeamBuilderScreen and used to share one unfiltered list, which is how a
 * same-named 6-roster ended up in the GBL picker's overwrite prompt and lost
 * three members to a 3-roster save (task 5b, ledger Ruling 13). Filtering
 * server-side with `.eq('size', size)` means a screen never even RECEIVES a
 * roster of the other size — the scoping the overwrite prompt now depends on
 * for its safety happens here, not as a client-side afterthought.
 */
export async function listTeams(size: 3 | 6): Promise<SavedTeam[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, league, size, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
    .eq('size', size)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as { id: string; name: string; league: LeagueId; size: 3 | 6; team_members: (StoredMember & { slot: number })[] };
    return {
      id: r.id,
      name: r.name,
      league: r.league,
      size: r.size,
      members: [...r.team_members].sort((a, b) => a.slot - b.slot),
    };
  });
}

/**
 * A write failure, made sayable.
 *
 * A duplicate name reaching Postgres means the builder's own check missed it —
 * a second tab, or a list this tab read before that tab wrote. The index that
 * catches it is `teams_owner_name_uniq` (migration `20260902163500`), and what
 * PostgREST hands back is `duplicate key value violates unique constraint
 * "teams_owner_name_uniq"`, which is not a sentence to put in front of someone
 * who just named a roster.
 *
 * Matched on the constraint NAME as well as the code, so that a future unique
 * index on this table does not quietly inherit a message about roster names.
 * Everything else is passed through verbatim: folding every write error into
 * one friendly line would hide a connection failure behind a name clash.
 */
function writeError(error: { code?: string; message: string }, name: string): Error {
  if (error.code === '23505' && error.message.includes('teams_owner_name_uniq')) {
    return new Error(
      `A roster called "${name}" already exists. Open the saved list to refresh it, then save again to replace that roster.`,
    );
  }
  return new Error(error.message);
}

export async function saveTeam(t: {
  id?: string;
  name: string;
  league: LeagueId;
  size: 3 | 6;
  members: StoredMember[];
}): Promise<string> {
  let id = t.id;
  if (id) {
    const { error } = await supabase
      .from('teams')
      .update({ name: t.name, league: t.league, size: t.size, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw writeError(error, t.name);
    // UPSERT the new slots BEFORE deleting anything beyond the new length —
    // never delete-then-insert. The two writes are not one transaction, so
    // their order decides which failure direction is recoverable. Upsert
    // first: if the upsert fails, the OLD roster is untouched — nothing is
    // lost. Delete second, scoped to slots past the new length: if that
    // delete fails, the team is left with stale extra slots, which is
    // visible and easy to clean up by saving again. Reversing this order —
    // delete all, then insert — has a window where an insert failing after
    // a successful delete leaves the team with ZERO members, which is silent
    // data loss for someone who only meant to rename it. Do not "simplify"
    // this back to delete-first.
    if (t.members.length > 0) {
      const { error: upsertError } = await supabase
        .from('team_members')
        .upsert(
          t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })),
          { onConflict: 'team_id,slot' },
        );
      if (upsertError) throw new Error(upsertError.message);
    }
    const { error: clearError } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', id)
      .gt('slot', t.members.length);
    if (clearError) throw new Error(clearError.message);
  } else {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: t.name, league: t.league, size: t.size })
      .select('id')
      .single();
    if (error) throw writeError(error, t.name);
    id = (data as { id: string }).id;
    if (t.members.length > 0) {
      const { error: insertError } = await supabase
        .from('team_members')
        .insert(t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })));
      if (insertError) throw new Error(insertError.message);
    }
  }
  return id;
}

export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface SavedFormat {
  id: string;
  name: string;
  format: Format;
  version: number;
  /**
   * `format_versions.id` for that version — a different table from `id`
   * above, which is `formats.id`. This is the one a queue entry or a match
   * offer points its `format_version_id` foreign key at: what two people
   * agreed to play is an immutable VERSION, not a format whose next save
   * would silently change the rules of a match already in flight.
   */
  versionId: string;
  rulesHash: string;
}

export async function listServerFormats(): Promise<SavedFormat[]> {
  const { data, error } = await supabase
    .from('formats')
    .select('id, name, format_versions(id, version, rules, rules_hash)')
    .order('updated_at', { ascending: false })
    // Every save appends a version, so a format with a long edit history has
    // a `format_versions` row per edit — and this list re-runs after every
    // save and delete. Without these, the embed pulls every version's full
    // `rules` jsonb only to throw all but the newest away on the next line.
    // PostgREST orders and limits the embedded table itself when told which
    // table the modifier applies to.
    .order('version', { referencedTable: 'format_versions', ascending: false })
    .limit(1, { referencedTable: 'format_versions' });
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const r = row as {
      id: string;
      name: string;
      format_versions: { id: string; version: number; rules: Format; rules_hash: string }[];
    };
    // The current version is the highest one; there is no pointer column to
    // disagree with it. The query above should already hand back only that
    // one row, but re-selecting the max client-side costs nothing and is a
    // correctness backstop if the referenced-table ordering above ever
    // regresses.
    const latest = [...r.format_versions].sort((a, b) => b.version - a.version)[0];
    if (!latest) return [];
    return [
      {
        id: r.id,
        name: r.name,
        format: latest.rules,
        version: latest.version,
        versionId: latest.id,
        rulesHash: latest.rules_hash,
      },
    ];
  });
}

export async function saveServerFormat(f: { id?: string; name: string; format: Format }): Promise<string> {
  let id = f.id;
  if (id) {
    const { error } = await supabase
      .from('formats')
      .update({ name: f.name, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from('formats').insert({ name: f.name }).select('id').single();
    if (error) throw new Error(error.message);
    id = (data as { id: string }).id;
  }
  const { data: prior } = await supabase
    .from('format_versions')
    .select('version')
    .eq('format_id', id)
    .order('version', { ascending: false })
    .limit(1);
  const next = ((prior as { version: number }[] | null)?.[0]?.version ?? 0) + 1;
  // Append. A version is immutable in the database, so this is the only way to
  // change what a format says.
  const { error } = await supabase.from('format_versions').insert({
    format_id: id,
    version: next,
    rules: f.format,
    rules_hash: await rulesHash(f.format),
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function deleteServerFormat(id: string): Promise<void> {
  const { error } = await supabase.from('formats').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
