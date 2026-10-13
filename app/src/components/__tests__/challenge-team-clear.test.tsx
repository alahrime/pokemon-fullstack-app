import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../lib/saves', () => ({ listTeams: vi.fn().mockResolvedValue([]), saveTeam: vi.fn() }));
import { ChallengeTeam, emptySlots } from '../ChallengeTeam';

const member = (ref: string) => ({ ref, fast_move: 'COUNTER', charge_moves: ['ICE_PUNCH'], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: null });

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

describe('ChallengeTeam Clear all', () => {
  it('asks before clearing, and clears only on "Clear team"', async () => {
    const onChange = vi.fn();
    render(<ChallengeTeam league="great" size={3} slots={[member('medicham'), member('azumarill'), null]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear team' });
    expect(dialog.textContent).toContain('Clear all 2 Pokémon');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear team' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(emptySlots(3)));
  });
});
