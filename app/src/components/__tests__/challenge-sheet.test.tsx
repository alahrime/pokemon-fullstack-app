import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ChallengeSheet } from '../ChallengeSheet';

const createChallenge = vi.fn();
const openDm = vi.fn();
const requestChannel = vi.fn();
const listTeams = vi.fn();
let formats: unknown[] = [];
let teams: unknown[] = [];

vi.mock('../../lib/saves', () => ({
  listServerFormats: async () => formats,
  listTeams: (...a: unknown[]) => listTeams(...a),
}));
vi.mock('../../lib/challenges', () => ({ createChallenge: (...a: unknown[]) => createChallenge(...a) }));
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
const team = (id: string, league: string, size: number) => ({
  id, name: `Team ${id}`, league, size, members: [{ ref: id }],
});
const target = { id: 'ally', name: 'Ally' };

function open(onClose = vi.fn()) {
  renderApp(<ChallengeSheet target={target} onClose={onClose} />);
  return onClose;
}
async function choose(formatName = 'Fmt g3', teamName = 'Team t3') {
  fireEvent.change(await screen.findByLabelText('Format'), { target: { value: (await screen.findByRole('option', { name: formatName })).getAttribute('value') } });
  fireEvent.change(await screen.findByLabelText('Team'), { target: { value: (await screen.findByRole('option', { name: teamName })).getAttribute('value') } });
}

beforeEach(() => {
  createChallenge.mockReset().mockResolvedValue('ch1');
  openDm.mockReset().mockResolvedValue('dm1');
  requestChannel.mockReset();
  formats = [fmt('g3', 'great', 3), fmt('u3', 'ultra', 3)];
  teams = [team('t3', 'great', 3), team('t6', 'great', 6), team('tu', 'ultra', 3)];
  listTeams.mockReset().mockImplementation(async () => teams);
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

  it('Scheduled reveals a datetime-local and passes a Date; Now passes none', async () => {
    open();
    await choose();
    expect(screen.queryByLabelText('When')).toBeNull();
    fireEvent.click(screen.getByLabelText('Scheduled'));
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
      team: [{ ref: 't3' }], scheduledFor: undefined,
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
});
