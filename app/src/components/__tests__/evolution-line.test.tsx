import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EvolutionLine } from '../EvolutionLine';
import { LEAGUE_BY_ID, SPECIES_BY_ID, canPurify, lineOf } from '../../lib/data';
import { bestBuddyEligible, boostShown, buildTable, getEntry, onBuddyBoost, purifiedIv } from '../../lib/engine';

const sp = (id: string) => SPECIES_BY_ID.get(id)!;
const ids = (id: string) => lineOf(sp(id)).map((s) => s.id);

describe('evolution lines', () => {
  it('walks the links, whichever form is asked', () => {
    expect(ids('ursaluna')).toEqual(['teddiursa', 'ursaring', 'ursaluna']);
    expect(ids('garchomp_mega')).toEqual(ids('gible'));
    expect(ids('gible')).toContain('garchomp_mega');
  });

  it('keeps regional branches apart though they share a family id', () => {
    expect(ids('vulpix')).toEqual(['vulpix', 'ninetales']);
    expect(ids('vulpix_alolan')).toEqual(['vulpix_alolan', 'ninetales_alolan']);
  });

  it('connects through a form we do not ship', () => {
    expect(ids('vivillon')).toContain('scatterbug');
  });

  it('a Mega can be purified through its base form, though it is never a Shadow', () => {
    expect(sp('garchomp_mega').shadowEligible).toBe(false);
    expect(canPurify(sp('garchomp_mega'))).toBe(sp('garchomp').shadowEligible);
  });
});

describe('purifiedIv', () => {
  it('adds 2 to each stat, capped at 15', () => {
    expect(purifiedIv({ a: 0, d: 13, s: 14 })).toEqual({ a: 2, d: 15, s: 15 });
    expect(purifiedIv({ a: 15, d: 15, s: 15 })).toEqual({ a: 15, d: 15, s: 15 });
  });
});

describe('Mega level scaling', () => {
  it('scales a Mega down to the cap, at the level PvPoke gets', () => {
    const { entry } = getEntry('venusaur_mega', { a: 1, d: 15, s: 15 }, 'great');
    expect(entry.lvl).toBe(15);
    expect(entry.cp).toBeLessThanOrEqual(1500);
  });

  it('a Super Mega climbs to level 52 on its Mega Level, which is no Best Buddy boost', () => {
    const { entry } = getEntry('sableye_mega', { a: 15, d: 15, s: 15 }, 'ultra');
    expect(entry.lvl).toBe(52);
    expect(onBuddyBoost(sp('sableye_mega'), entry.lvl)).toBe(false);
    expect(onBuddyBoost(sp('azumarill'), 51)).toBe(true);
  });
});

describe('EvolutionLine', () => {
  const iv = { a: 13, d: 13, s: 13 };
  const open = (id: string, onPick = vi.fn()) =>
    render(<EvolutionLine species={sp(id)} iv={iv} bestBuddy={false} onPick={onPick} />);

  it('ranks the roll for each form in every league', () => {
    open('teddiursa');
    const row = screen.getByRole('button', { name: /Ursaluna/ });
    const { entry } = getEntry('ursaluna', iv, 'great');
    expect(row.textContent).toContain(`#${entry.rank.toLocaleString()}`);
    expect(row.querySelectorAll('.evo-line-cell')).toHaveLength(3);
  });

  it('renders nothing for a Pokémon with no line', () => {
    const { container } = open('tauros');
    expect(container.firstChild).toBeNull();
  });

  it('Purified shows the +2 rank against the rank it replaces, and opens that roll', () => {
    const onPick = vi.fn();
    open('teddiursa', onPick);
    fireEvent.click(screen.getByRole('switch', { name: /Purified/ }));
    const pure = getEntry('ursaluna', { a: 15, d: 15, s: 15 }, 'great').entry.rank;
    const was = getEntry('ursaluna', iv, 'great').entry.rank;
    const row = screen.getByRole('button', { name: /Ursaluna/ });
    expect(row.textContent).toContain(`#${pure.toLocaleString()} ${pure < was ? '▲' : '▼'}`);
    expect(row.textContent).toContain(`was #${was.toLocaleString()}`);
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith('ursaluna', { a: 15, d: 15, s: 15 });
  });

  it('offers no Purified switch when nothing in the line can be a Shadow', () => {
    const line = [...SPECIES_BY_ID.values()].find((s) => s.line && lineOf(s).length > 1 && !lineOf(s).some(canPurify))!;
    open(line.id);
    expect(screen.queryByRole('switch', { name: /Purified/ })).toBeNull();
  });
});

describe('Mega Level', () => {
  const lvl = (id: string, league: 'great' | 'ultra' | 'master', flag: boolean, iv = '15/15/15') =>
    buildTable(id, league, flag).all.find((e) => `${e.a}/${e.d}/${e.s}` === iv)!.lvl;
  const top = (id: string, league: 'ultra', flag: boolean) => {
    const e = buildTable(id, league, flag).all.find((x) => x.rank === 1)!;
    return `${e.a}/${e.d}/${e.s}`;
  };

  it('a Mega starts at Level 3 and the flag lifts it to 4; a Super Mega starts at 4 and the flag drops it to 3', () => {
    expect(lvl('venusaur_mega', 'master', false)).toBe(50);
    expect(lvl('venusaur_mega', 'master', true)).toBe(52);
    expect(lvl('sableye_mega', 'ultra', false)).toBe(52);
    expect(lvl('sableye_mega', 'ultra', true)).toBe(50);
  });

  it('Mega Level 4 can move rank 1 under a cap, as PvPoke has it for Mawile in Ultra', () => {
    expect(top('mawile_mega', 'ultra', false)).toBe('1/14/15');
    expect(top('mawile_mega', 'ultra', true)).toBe('0/15/14');
  });

  it('is only offered where it changes something', () => {
    const ultra = LEAGUE_BY_ID.get('ultra')!;
    const great = LEAGUE_BY_ID.get('great')!;
    expect(bestBuddyEligible(SPECIES_BY_ID.get('mawile_mega')!, ultra)).toBe(true);
    expect(bestBuddyEligible(SPECIES_BY_ID.get('sableye_mega')!, ultra)).toBe(true);
    expect(bestBuddyEligible(SPECIES_BY_ID.get('venusaur_mega')!, great)).toBe(false);
  });

  it('the toggle reads the flag through boostShown, the same way in both directions', () => {
    const sableye = SPECIES_BY_ID.get('sableye_mega')!;
    const venusaur = SPECIES_BY_ID.get('venusaur_mega')!;
    expect(boostShown(sableye, false)).toBe(true);
    expect(boostShown(sableye, boostShown(sableye, true))).toBe(true);
    expect(boostShown(venusaur, false)).toBe(false);
  });
});
