import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  favoritePokemon: [], favoriteLeague: null, faction: null, specialty: null,
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
});
