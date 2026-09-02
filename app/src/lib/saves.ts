import { supabase } from './supabase';
import { canonicalize, type Format } from '../rules';
import type { LeagueId } from './types';
import type { StoredMember } from './teamCodec';

export interface SavedTeam {
  id: string;
  name: string;
  league: LeagueId;
  members: StoredMember[];
}

/**
 * `owner_id` is never sent from here. It defaults to `auth.uid()` in the
 * database, so who owns a row is decided in one place; a client-supplied owner
 * is a second source of truth the policy then has to agree with.
 */
export async function listTeams(): Promise<SavedTeam[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, league, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as { id: string; name: string; league: LeagueId; team_members: (StoredMember & { slot: number })[] };
    return {
      id: r.id,
      name: r.name,
      league: r.league,
      members: [...r.team_members].sort((a, b) => a.slot - b.slot),
    };
  });
}

export async function saveTeam(t: {
  id?: string;
  name: string;
  league: LeagueId;
  members: StoredMember[];
}): Promise<string> {
  let id = t.id;
  if (id) {
    const { error } = await supabase
      .from('teams')
      .update({ name: t.name, league: t.league, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    // Slots are positional and the roster may have shrunk, so the old rows go
    // rather than being upserted over — an upsert would leave a stale slot 3
    // behind when a three becomes a two.
    const { error: clearError } = await supabase.from('team_members').delete().eq('team_id', id);
    if (clearError) throw new Error(clearError.message);
  } else {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: t.name, league: t.league })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    id = (data as { id: string }).id;
  }
  if (t.members.length > 0) {
    const { error } = await supabase
      .from('team_members')
      .insert(t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })));
    if (error) throw new Error(error.message);
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
  rulesHash: string;
}

export async function listServerFormats(): Promise<SavedFormat[]> {
  const { data, error } = await supabase
    .from('formats')
    .select('id, name, format_versions(version, rules, rules_hash)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const r = row as { id: string; name: string; format_versions: { version: number; rules: Format; rules_hash: string }[] };
    // The current version is the highest one; there is no pointer column to
    // disagree with it.
    const latest = [...r.format_versions].sort((a, b) => b.version - a.version)[0];
    if (!latest) return [];
    return [{ id: r.id, name: r.name, format: latest.rules, version: latest.version, rulesHash: latest.rules_hash }];
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
    rules_hash: canonicalize(f.format),
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function deleteServerFormat(id: string): Promise<void> {
  const { error } = await supabase.from('formats').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
