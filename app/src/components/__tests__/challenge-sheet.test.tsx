import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ChallengeSheet } from '../ChallengeSheet';
import { speciesOf } from '../../lib/data';

const createChallenge = vi.fn();
const declineChallenge = vi.fn();
const openDm = vi.fn();
const requestChannel = vi.fn();
const listTeams = vi.fn();
const saveTeam = vi.fn();
let formats: unknown[] = [];
let teams: unknown[] = [];

vi.mock('../../lib/saves', () => ({
  listServerFormats: async () => formats,
  listTeams: (...a: unknown[]) => listTeams(...a),
  saveTeam: (...a: unknown[]) => saveTeam(...a),
}));
vi.mock('../../lib/challenges', () => ({
  createChallenge: (...a: unknown[]) => createChallenge(...a),
  declineChallenge: (...a: unknown[]) => declineChallenge(...a),
}));
vi.mock('../../lib/channels', () => ({
  openDm: (...a: unknown[]) => openDm(...a),
  // Read by the ChannelListProvider `renderApp` mounts (signed out, never called with data).
  isChannelUnread: () => false,
  listChannelsWithActivity: async () => [],
  withDisplayNames: async (cs: unknown) => cs,
}));
vi.mock('../../state/ChatDockContext', () => ({
  useChatDockRequest: () => ({ requestChannel }),
  ChatDockRequestProvider: ({ children }: { children: unknown }) => children,
}));

const fmt = (id: string, base: string, size: number) => ({
  id, name: `Fmt ${id}`, version: 1, versionId: `v-${id}`, rulesHash: 'h',
  format: { base, composition: { size } },
});
// Real species, so the slots can name moves; IVs are irrelevant here.
const REFS = ['machamp', 'azumarill', 'medicham', 'altaria', 'registeel', 'swampert'];
const member = (ref: string) => ({
  ref, fast_move: speciesOf(ref)!.fastMoves[0].id, charge_moves: [] as string[], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: null,
});
const team = (id: string, league: string, size: number) => ({
  id, name: `Team ${id}`, league, size, members: REFS.slice(0, size).map(member),
});
const target = { id: 'ally', name: 'Ally' };

function open(onClose = vi.fn()) {
  renderApp(<ChallengeSheet target={target} onClose={onClose} />);
  return onClose;
}
async function choose(formatName = 'Fmt g3', teamName = 'Team t3') {
  fireEvent.change(await screen.findByLabelText('Format'), { target: { value: (await screen.findByRole('option', { name: formatName })).getAttribute('value') } });
  fireEvent.change(await screen.findByLabelText('Saved team'), { target: { value: (await screen.findByRole('option', { name: teamName })).getAttribute('value') } });
}

beforeEach(() => {
  createChallenge.mockReset().mockResolvedValue('ch1');
  declineChallenge.mockReset().mockResolvedValue(true);
  openDm.mockReset().mockResolvedValue('dm1');
  requestChannel.mockReset();
  formats = [fmt('g3', 'great', 3), fmt('u3', 'ultra', 3)];
  teams = [team('t3', 'great', 3), team('t6', 'great', 6), team('tu', 'ultra', 3)];
  // The server filters by size (`listTeams(size)`); the league filter is the component's.
  listTeams.mockReset().mockImplementation(async (n: number) => (teams as { size: number }[]).filter((t) => t.size === n));
});

describe('ChallengeSheet', () => {
  it('is a modal dialog named for the target, with focus moved in', async () => {
    open();
    const d = await screen.findByRole('dialog', { name: 'Challenge Ally' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('is portalled to document.body, outside the screen wrapper that would transform its backdrop', async () => {
    const onClose = vi.fn();
    renderApp(<div data-testid="screen" className="screen-enter"><ChallengeSheet target={target} onClose={onClose} /></div>);
    const d = await screen.findByRole('dialog', { name: 'Challenge Ally' });
    expect(screen.getByTestId('screen').contains(d)).toBe(false);
    expect(d.parentElement?.parentElement).toBe(document.body);
    fireEvent.mouseDown(d.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('defaults league to state.league and re-filters formats on change', async () => {
    open();
    const league = (await screen.findByLabelText('League')) as HTMLSelectElement;
    expect(league.value).toBe('great');
    expect(await screen.findByRole('option', { name: 'Fmt g3' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Fmt u3' })).toBeNull();
    fireEvent.change(league, { target: { value: 'ultra' } });
    expect(await screen.findByRole('option', { name: 'Fmt u3' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Fmt g3' })).toBeNull();
  });

  it('lists only teams matching the format size and league', async () => {
    open();
    fireEvent.change(await screen.findByLabelText('Format'), {
      target: { value: (await screen.findByRole('option', { name: 'Fmt g3' })).getAttribute('value') },
    });
    expect(await screen.findByRole('option', { name: 'Team t3' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Team t6' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Team tu' })).toBeNull();
    expect(listTeams).toHaveBeenCalledWith(3);
  });

  it('disables Send until a format and a team are chosen', async () => {
    open();
    const send = (await screen.findByRole('button', { name: 'Send challenge' })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await choose();
    await waitFor(() => expect(send.disabled).toBe(false));
  });

  it('a loaded team fills the slots, can be changed, and the slots are what is sent', async () => {
    open();
    await choose();
    expect(await screen.findByText('Machamp')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove slot 1' }));
    expect((screen.getByRole('button', { name: 'Send challenge' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '+ Add Pokémon' })).toBeTruthy();
  });

  it('can be built on the fly and saved from the sheet', async () => {
    saveTeam.mockResolvedValue('new');
    open();
    await choose();
    await screen.findByText('Machamp');
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));
    await waitFor(() => expect(saveTeam).toHaveBeenCalled());
    expect(saveTeam.mock.calls[0][0]).toMatchObject({ name: 'Mine', league: 'great', size: 3 });
    expect(saveTeam.mock.calls[0][0].members).toHaveLength(3);
    // "Mine" is not the loaded team's name, so this is a new team, not an overwrite of t3.
    expect(saveTeam.mock.calls[0][0].id).toBeUndefined();
  });

  it('Scheduled reveals a datetime-local and passes a Date; Now passes none', async () => {
    open();
    await choose();
    expect(screen.queryByLabelText('When')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    const when = screen.getByLabelText('When') as HTMLInputElement;
    expect(when.type).toBe('datetime-local');
    fireEvent.change(when, { target: { value: '2099-01-02T03:04' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(createChallenge).toHaveBeenCalled());
    expect(createChallenge.mock.calls[0][0].scheduledFor).toBeInstanceOf(Date);
  });

  it('sends, opens the DM, requests it, then closes — in that order', async () => {
    const onClose = open();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createChallenge).toHaveBeenCalledWith({
      targetId: 'ally', league: 'great', formatVersionId: 'v-g3',
      format: { base: 'great', composition: { size: 3 } },
      team: REFS.slice(0, 3).map(member), scheduledFor: undefined,
    });
    expect(openDm).toHaveBeenCalledWith('ally');
    expect(requestChannel).toHaveBeenCalledWith('dm1');
    const order = (m: { mock: { invocationCallOrder: number[] } }) => m.mock.invocationCallOrder[0];
    expect(order(createChallenge)).toBeLessThan(order(openDm));
    expect(order(openDm)).toBeLessThan(order(requestChannel));
    expect(order(requestChannel)).toBeLessThan(order(onClose as never));
  });

  it('shows a refusal in an alert and stays open', async () => {
    createChallenge.mockRejectedValue(new Error('a challenge needs a format you own or a public one'));
    const onClose = open();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Send challenge' }));
    expect((await screen.findByRole('alert')).textContent).toContain('a challenge needs a format you own or a public one');
    expect(onClose).not.toHaveBeenCalled();
    expect(openDm).not.toHaveBeenCalled();
  });

  it('after a sent challenge, a failed chat open cannot be retried into a second challenge', async () => {
    openDm.mockRejectedValue(new Error('no dm'));
    const onClose = open();
    await choose();
    const send = screen.getByRole('button', { name: 'Send challenge' }) as HTMLButtonElement;
    fireEvent.click(send);
    expect((await screen.findByRole('alert')).textContent).toMatch(/challenge sent.*no dm/i);
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(createChallenge).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('returns focus to the opener when it unmounts', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const view = renderApp(<ChallengeSheet target={target} onClose={vi.fn()} />);
    await screen.findByRole('dialog');
    expect(document.activeElement).not.toBe(trigger);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('closes on Escape and Cancel', async () => {
    const onClose = open();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('points to Formats and Teams when nothing is saved', async () => {
    formats = [];
    teams = [];
    open();
    expect(await screen.findByText(/save one on the Formats screen/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send challenge' }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe('as a counter', () => {
    const counter = (onClose = vi.fn()) => {
      renderApp(<ChallengeSheet target={target} counterOf="orig" defaultLeague="ultra" onClose={onClose} />);
      return onClose;
    };

    it('is named a counter, starts at the original league, and sends a counter', async () => {
      counter();
      expect(await screen.findByRole('dialog', { name: 'Counter Ally' })).toBeTruthy();
      expect(((await screen.findByLabelText('League')) as HTMLSelectElement).value).toBe('ultra');
      expect(screen.getByRole('button', { name: 'Send counter' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Send challenge' })).toBeNull();
    });

    it('creates the new challenge first, then declines the original, then opens the DM', async () => {
      const order: string[] = [];
      createChallenge.mockImplementation(async () => { order.push('create'); return 'ch2'; });
      declineChallenge.mockImplementation(async (id: string) => { order.push(`decline:${id}`); return true; });
      openDm.mockImplementation(async () => { order.push('dm'); return 'dm1'; });
      const onClose = counter();
      await choose('Fmt u3', 'Team tu');
      fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(order).toEqual(['create', 'decline:orig', 'dm']);
    });

    it('leaves their challenge alone when your counter is refused', async () => {
      createChallenge.mockRejectedValue(new Error('someone no longer challengeable'));
      const onClose = counter();
      await choose('Fmt u3', 'Team tu');
      fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/no longer challengeable/);
      expect(declineChallenge).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('says so when the counter went out but declining theirs failed, and cannot be sent twice', async () => {
      declineChallenge.mockRejectedValue(new Error('network'));
      counter();
      await choose('Fmt u3', 'Team tu');
      fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Counter sent.*network/);
      expect((screen.getByRole('button', { name: 'Send counter' }) as HTMLButtonElement).disabled).toBe(true);
      expect(createChallenge).toHaveBeenCalledTimes(1);
    });
  });
});
