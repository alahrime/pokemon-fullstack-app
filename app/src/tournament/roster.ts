import type { Build, Format, Violation } from '../rules';
import { validateTeam } from '../rules';
import type { LeagueId } from '../lib/types';
import type { AddPokemonChoice } from '../components/AddPokemonModal';
import { CHARGE_MOVES, FAST_MOVES, displayName, speciesOf } from '../lib/data';
import { isPokemonType } from '../lib/pokemonTypes';
import { CPM, MAX_LEVEL_IDX, BB_MAX_LEVEL_IDX } from '../lib/cpm';

export const ROSTER_SIZE = 6;

/** The opponent-visible shape only: no IVs (the server refuses extra keys). */
export interface RosterMember { ref: string; fast: string; charges: string[]; cp: number; bestBuddy: boolean }

const cpAt = (atk: number, def: number, hp: number, cpm: number) =>
  Math.max(10, Math.floor((atk * Math.sqrt(def) * Math.sqrt(hp) * cpm * cpm) / 10));

/** The CP range a form can show: the floor, and the CP of a perfect 15/15/15 at
 *  level 50 (51 with Best Buddy). Loose on purpose — the organiser judges. */
export function cpBounds(ref: string, bestBuddy: boolean): { min: number; max: number } {
  const s = speciesOf(ref);
  if (!s) return { min: 10, max: 10 };
  const idx = bestBuddy ? BB_MAX_LEVEL_IDX : MAX_LEVEL_IDX;
  return { min: 10, max: cpAt(s.atk + 15, s.def + 15, s.hp + 15, CPM[idx]) };
}

export const leagueCap = (league: LeagueId): number | null =>
  league === 'great' ? 1500 : league === 'ultra' ? 2500 : null;

export const toBuilds = (roster: readonly RosterMember[]): Build[] =>
  roster.map((m) => ({ ref: m.ref, fast: m.fast, charges: [...m.charges] }));

export function memberFromChoice(choice: AddPokemonChoice, cp: number, bestBuddy: boolean): RosterMember {
  const s = speciesOf(choice.ref);
  return {
    ref: choice.ref,
    fast: s?.fastMoves[choice.fastIdx]?.id ?? '',
    charges: [...choice.chargeIds],
    cp,
    bestBuddy,
  };
}

const MOVE_NAMES = new Map<string, string>([...FAST_MOVES, ...CHARGE_MOVES].map((m) => [m.id, m.name]));
/** A move id as a person reads it; an unknown id is shown as given. */
const moveName = (id: string) => MOVE_NAMES.get(id) ?? id;

/** A rules selector ("fire", "type:fire & !flying", "@surf") as words. */
function describeSelect(select: string): string {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const atom = (raw: string): string => {
    let a = raw.trim().toLowerCase();
    let not = false;
    while (a.startsWith('!')) { not = !not; a = a.slice(1).trim(); }
    let text: string;
    if (a.startsWith('@')) text = `able to learn ${moveName(a.slice(1).toUpperCase().replace(/ /g, '_'))}`;
    else if (isPokemonType(a.replace(/^type:/, ''))) text = `${cap(a.replace(/^type:/, ''))}-type`;
    else text = cap(a.replace(/^[a-z]+:/, ''));
    return not ? `not ${text}` : text;
  };
  return select.split(',').map((or) => or.split('&').map(atom).join(' and ')).join(' or ');
}

export function describeViolation(v: Violation): string {
  switch (v.kind) {
    case 'size': return `the team has ${v.actual} Pokémon but the format wants ${v.expected}.`;
    case 'illegal-ref': return `${displayName(v.ref)} is not allowed in this format.`;
    case 'duplicate-species': return `${displayName(v.refs[0])} and ${displayName(v.refs[1])} are the same species, and the format allows one of each.`;
    case 'duplicate-family': return `${displayName(v.refs[0])} and ${displayName(v.refs[1])} are from the same evolution family, and the format allows one per family.`;
    case 'quota': {
      const need = v.min !== undefined && v.actual < v.min ? `at least ${v.min}` : `at most ${v.max}`;
      return `the format wants ${need} Pokémon matching ${describeSelect(v.select)} but the team has ${v.actual}.`;
    }
    case 'unknown-move': return `${displayName(v.ref)} does not learn ${moveName(v.move)}.`;
  }
}

export function checkRoster(
  roster: readonly RosterMember[], format: Format, league: LeagueId,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (roster.length !== ROSTER_SIZE) problems.push(`A roster is exactly ${ROSTER_SIZE} Pokémon (you have ${roster.length}).`);
  const cap = leagueCap(league);
  roster.forEach((m, i) => {
    const at = `Slot ${i + 1}`;
    const s = speciesOf(m.ref);
    if (!s) { problems.push(`${at}: unknown Pokémon.`); return; }
    if (!s.fastMoves.some((f) => f.id === m.fast)) problems.push(`${at}: ${displayName(m.ref)} does not learn ${moveName(m.fast)}.`);
    if (m.charges.length < 1 || m.charges.length > 2) problems.push(`${at}: pick one or two charged moves.`);
    for (const c of m.charges) {
      if (!s.chargeMoves.some((x) => x.id === c)) problems.push(`${at}: ${displayName(m.ref)} does not learn ${moveName(c)}.`);
    }
    if (!Number.isInteger(m.cp)) { problems.push(`${at}: CP must be a whole number.`); return; }
    const { min, max } = cpBounds(m.ref, m.bestBuddy);
    if (m.cp < min) problems.push(`${at}: CP is below ${min}.`);
    else if (m.cp > max) problems.push(`${at}: ${displayName(m.ref)} cannot reach CP ${m.cp}.`);
    if (cap !== null && m.cp > cap) problems.push(`${at}: CP ${m.cp} is over the ${cap} cap.`);
  });
  if (roster.length === ROSTER_SIZE) {
    for (const v of validateTeam(toBuilds(roster), format).violations) {
      problems.push(`Format: ${describeViolation(v)}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
