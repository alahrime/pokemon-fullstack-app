import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchTeams } from '../MatchTeams';
import { SPECIES, displayName } from '../../lib/data';
import type { PublicMember } from '../../lib/teamCodec';
import type { Profile } from '../../lib/profile';

const member = (ref: string): PublicMember => {
  const sp = SPECIES.find((s) => s.id === ref)!;
  return { ref, fast_move: sp.fastMoves[0].id, charge_moves: sp.chargeMoves.slice(0, 2).map((m) => m.id) };
};
const profile = (displayName: string, avatar: string | null): Profile => ({
  displayName, avatar, goUsername: 'x', createdAt: '2026-01-01', region: null, trainerLevel: null, xp: null,
  favoritePokemon: [], favoriteLeague: null, faction: null, specialty: null, pinnedTrophies: [],
});
const SIX = ['medicham', 'azumarill', 'registeel', 'politoed', 'lickilicky', 'walrein'];

function show(onOpenOpp = vi.fn()) {
  render(<MatchTeams me={profile('Misty', 'misty')} opp={profile('Ash', null)} myTeam={SIX.map(member)} oppTeam={[...SIX].reverse().map(member)}
    myCode="111122223333" oppCode={null} onOpenMe={vi.fn()} onOpenOpp={onOpenOpp} />);
}

describe('MatchTeams', () => {
  it('shows both trainers with their friend codes', () => {
    show();
    expect(screen.getByRole('region', { name: 'Your team' }).textContent).toMatch(/YOU.*Misty.*111122223333/);
    expect(screen.getByRole('region', { name: "Ash's team" }).textContent).toMatch(/OPPONENT.*Ash.*not set/);
  });

  it('draws all six a side, each with its fast move and charge moves', () => {
    show();
    const mine = within(screen.getByRole('region', { name: 'Your team' }));
    for (const ref of SIX) {
      const sp = SPECIES.find((s) => s.id === ref)!;
      const moves = mine.getByRole('list', { name: `${displayName(ref)}'s moves` });
      expect(within(moves).getAllByRole('listitem').map((li) => li.textContent))
        .toEqual([sp.fastMoves[0].name, ...sp.chargeMoves.slice(0, 2).map((m) => m.name)]);
    }
    expect(within(screen.getByRole('region', { name: "Ash's team" })).getAllByRole('list', { name: /'s moves$/ })).toHaveLength(6);
  });

  it('never prints a spread', () => {
    show();
    expect(screen.getByRole('region', { name: 'Versus' }).textContent).not.toMatch(/\d+\/\d+\/\d+/);
  });

  it("opens the opponent's profile from their name", () => {
    const open = vi.fn();
    show(open);
    fireEvent.click(screen.getByRole('button', { name: 'Ash' }));
    expect(open).toHaveBeenCalled();
  });

  it("names the league and format between the banners when it knows them", () => {
    render(<MatchTeams me={profile('Misty', null)} opp={profile('Ash', null)} myTeam={[member('medicham')]} oppTeam={[member('azumarill')]}
      myCode={null} oppCode={null} onOpenMe={vi.fn()} onOpenOpp={vi.fn()} league="ultra" format="Ultra League · 2500" />);
    expect(screen.getByRole('region', { name: 'Versus' }).textContent).toContain('Ultra League · 2500');
  });
});

describe('MatchTeams — on a phone', () => {
  // jsdom applies no stylesheet; the paired layout is chosen in JS from the media query.
  const phone = (q: string) => ({ matches: q === '(max-width: 820px)', media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false });
  let original: typeof window.matchMedia;
  beforeEach(() => { original = window.matchMedia; window.matchMedia = phone as unknown as typeof window.matchMedia; });
  afterEach(() => { window.matchMedia = original; });

  it('pairs the two sixes row by row, every Pokémon with all three moves', () => {
    show();
    const rows = screen.getByRole('region', { name: 'Versus' }).querySelectorAll('ol > li');
    expect(rows).toHaveLength(6);
    const reversed = [...SIX].reverse();
    rows.forEach((row, i) => {
      const [mine, theirs] = [...row.querySelectorAll(':scope > div > button')];
      for (const [cell, ref] of [[mine, SIX[i]], [theirs, reversed[i]]] as const) {
        const sp = SPECIES.find((s) => s.id === ref)!;
        expect(cell.getAttribute('aria-label')).toBe(`${displayName(ref)}: ${[sp.fastMoves[0].name, ...sp.chargeMoves.slice(0, 2).map((m) => m.name)].join(', ')}`);
      }
    });
    expect(screen.getByText('Misty')).toBeTruthy();
    expect(screen.getByText('111122223333')).toBeTruthy();
  });

  it('opens a tapped Pokémon into its full card under its row', () => {
    show();
    const cell = screen.getAllByRole('button', { name: new RegExp(`^${displayName('medicham')}:`) })[0];
    expect(cell.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(cell);
    expect(cell.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('list', { name: `${displayName('medicham')}'s moves` })).toBeTruthy();
  });
});
