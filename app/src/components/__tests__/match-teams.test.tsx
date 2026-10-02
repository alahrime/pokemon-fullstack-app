import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchTeams } from '../MatchTeams';
import { SPECIES } from '../../lib/data';
import type { StoredMember } from '../../lib/teamCodec';

const member = (ref: string): StoredMember => {
  const sp = SPECIES.find((s) => s.id === ref)!;
  return { ref, fast_move: sp.fastMoves[0].id, charge_moves: [sp.chargeMoves[0].id], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: null };
};

describe('MatchTeams', () => {
  it('shows both teams with their friend codes', () => {
    render(<MatchTeams myTeam={[member('medicham')]} oppTeam={[member('azumarill')]} myCode="111122223333" oppCode={null} oppName="Ash" />);
    expect(screen.getByRole('region', { name: 'Your team' }).textContent).toMatch(/111122223333/);
    expect(screen.getByRole('region', { name: "Ash's team" }).textContent).toMatch(/not set/);
  });
  it('renders nothing without both rosters', () => {
    const { container } = render(<MatchTeams myTeam={[member('medicham')]} myCode={null} oppCode={null} oppName="x" />);
    expect(container.firstChild).toBeNull();
  });
});
