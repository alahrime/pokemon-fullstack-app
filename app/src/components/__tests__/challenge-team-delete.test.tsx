import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const S = vi.hoisted(() => ({ listTeams: vi.fn(), saveTeam: vi.fn(), deleteTeam: vi.fn() }));
vi.mock('../../lib/saves', () => S);
import { ChallengeTeam, emptySlots } from '../ChallengeTeam';

const member = (ref: string) => ({ ref, fast_move: 'COUNTER', charge_moves: ['ICE_PUNCH'], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: null });
const core = { id: 't1', name: 'Core', league: 'great', size: 3, members: [member('medicham'), member('azumarill'), member('registeel')] };

afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('ChallengeTeam Delete', () => {
  it('deletes the saved team picked, after asking, and leaves the slots it loaded', async () => {
    S.listTeams.mockResolvedValueOnce([core]).mockResolvedValue([]);
    S.deleteTeam.mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(<ChallengeTeam league="great" size={3} slots={emptySlots(3)} onChange={onChange} />);
    await screen.findByRole('option', { name: 'Core' });
    // Nothing picked: nothing to delete.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Saved team'), { target: { value: 't1' } });
    expect(onChange).toHaveBeenCalledWith(core.members);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alertdialog', { name: 'Delete team' })).textContent).toContain('Delete "Core"?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(S.deleteTeam).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete team' }));
    await waitFor(() => expect(S.deleteTeam).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Core' })).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('Deleted “Core”');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('says so when the delete fails, and keeps the team', async () => {
    S.listTeams.mockResolvedValue([core]);
    S.deleteTeam.mockRejectedValue(new Error('network down'));
    render(<ChallengeTeam league="great" size={3} slots={emptySlots(3)} onChange={() => {}} />);
    await screen.findByRole('option', { name: 'Core' });
    fireEvent.change(screen.getByLabelText('Saved team'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete team' }));
    expect((await screen.findByRole('alert')).textContent).toBe('network down');
    expect(screen.getByRole('option', { name: 'Core' })).toBeTruthy();
  });
});
