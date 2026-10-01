import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { speciesOf } from '../../lib/data';
import { ChallengeAcceptSheet } from '../ChallengeAcceptSheet';

const listTeams = vi.fn();
vi.mock('../../lib/saves', () => ({
  listTeams: (...a: unknown[]) => listTeams(...a),
  saveTeam: vi.fn(),
}));
// The editor is covered by add-pokemon-modal tests; here it only has to hand back a choice.
vi.mock('../AddPokemonModal', () => ({
  AddPokemonModal: (p: { onCommit: (c: unknown) => void; onClose: () => void }) => (
    <button onClick={() => { p.onCommit({ ref: 'machamp', chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 }, bestBuddy: true }); p.onClose(); }}>stub add</button>
  ),
  movesForChoice: (c: { ref: string }) => ({ fast: { name: 'Counter' }, charges: [{ name: c.ref }] }),
}));

const member = (ref: string) => ({
  ref, fast_move: speciesOf(ref)!.fastMoves[0].id, charge_moves: [] as string[], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: null,
});
const saved = { id: 't', name: 'Saved', league: 'great', size: 3, members: ['machamp', 'azumarill', 'altaria'].map(member) };

beforeEach(() => listTeams.mockReset().mockResolvedValue([saved]));

const open = (onAccept = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) => {
  render(<ChallengeAcceptSheet league="great" size={3} onAccept={onAccept} onClose={onClose} />);
  return { onAccept, onClose };
};
const acceptBtn = () => screen.getByRole('button', { name: 'Accept with this team' }) as HTMLButtonElement;

describe('ChallengeAcceptSheet', () => {
  it('cannot accept until every slot is filled — nothing is chosen for you', async () => {
    open();
    await screen.findByRole('option', { name: 'Saved' });
    expect(acceptBtn().disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: '+ Add Pokémon' })).toHaveLength(3);
  });

  it('accepts with a saved team picked from the dropdown', async () => {
    const { onAccept, onClose } = open();
    fireEvent.change(await screen.findByLabelText('Saved team'), { target: { value: 't' } });
    expect(acceptBtn().disabled).toBe(false);
    fireEvent.click(acceptBtn());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onAccept).toHaveBeenCalledWith(saved.members);
  });

  it('accepts with a team built slot by slot, Best Buddy carried through', async () => {
    const { onAccept } = open();
    await screen.findByRole('option', { name: 'Saved' });
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getAllByRole('button', { name: '+ Add Pokémon' })[0]);
      fireEvent.click(await screen.findByRole('button', { name: 'stub add' }));
    }
    fireEvent.click(acceptBtn());
    await waitFor(() => expect(onAccept).toHaveBeenCalled());
    const team = onAccept.mock.calls[0][0];
    expect(team).toHaveLength(3);
    expect(team.every((m: { best_buddy?: boolean }) => m.best_buddy === true)).toBe(true);
  });

  it('shows a refusal and stays open', async () => {
    const { onClose } = open(vi.fn().mockRejectedValue(new Error('roster mismatch')));
    fireEvent.change(await screen.findByLabelText('Saved team'), { target: { value: 't' } });
    fireEvent.click(acceptBtn());
    expect((await screen.findByRole('alert')).textContent).toBe('roster mismatch');
    expect(onClose).not.toHaveBeenCalled();
    expect(acceptBtn().disabled).toBe(false);
  });
});
