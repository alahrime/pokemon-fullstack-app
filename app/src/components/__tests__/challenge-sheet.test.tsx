import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ChallengeSheet } from '../ChallengeSheet';
import { speciesOf } from '../../lib/data';
import { PRESET_FORMATS } from '../../lib/presetFormats';

const createChallenge = vi.fn();
const declineChallenge = vi.fn();
const openDm = vi.fn();
const requestChannel = vi.fn();
const listTeams = vi.fn();
const saveTeam = vi.fn();
const versionFor = vi.fn();
let formats: unknown[] = [];
let teams: unknown[] = [];

vi.mock('../../lib/saves', () => ({
  listServerFormats: async () => formats,
  listTeams: (...a: unknown[]) => listTeams(...a),
  saveTeam: (...a: unknown[]) => saveTeam(...a),
  saveServerFormat: vi.fn(),
}));
vi.mock('../../lib/presetFormats', async (orig) => ({
  ...(await orig<typeof import('../../lib/presetFormats')>()),
  versionFor: (...a: unknown[]) => versionFor(...a),
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
  format: { schema: 1, base, pool: [], composition: { size }, selection: { mode: 'open' } },
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
const formatBox = () => screen.findByRole('combobox', { name: 'Format' });
const optionNames = async () => {
  fireEvent.click(await formatBox());
  return within(screen.getByRole('listbox', { name: 'Format' })).getAllByRole('option').map((o) => o.textContent?.replace(' ✓', '').replace(/(1500 CP|2500 CP|No cap)$/, '').trim());
};
async function pickFormat(name: string) {
  fireEvent.click(await formatBox());
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) }));
}
/** The Format select starts on the plain league; pass a name only to move off it. */
async function choose(teamName = 'Team t3', formatName?: string) {
  if (formatName) await pickFormat(formatName);
  fireEvent.change(await screen.findByLabelText('Saved team'), { target: { value: (await screen.findByRole('option', { name: teamName })).getAttribute('value') } });
}
const great = () => screen.findByRole('option', { name: 'Team t3' });

beforeEach(() => {
  createChallenge.mockReset().mockResolvedValue('ch1');
  declineChallenge.mockReset().mockResolvedValue(true);
  versionFor.mockReset().mockResolvedValue('v-preset');
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
  it('starts on the plain league, so a team can be built with no format chosen', async () => {
    open();
    expect((await formatBox()).textContent).toMatch(/Great League/);
    expect(screen.queryByLabelText('League')).toBeNull();
    expect(screen.getAllByRole('button', { name: '+ Add Pokémon' })).toHaveLength(3);
    await great();
    expect(listTeams).toHaveBeenCalledWith(3);
  });

  it('lists the standard cups in PvPoke order, then your own formats, each with its league emblem', async () => {
    open();
    const names = await optionNames();
    expect(names.slice(0, 12)).toEqual(['Great League', 'Ultra League', 'Master League', 'Mega Great League', 'Mega Ultra League', 'Mega Master League', 'Mega Color Cup', 'Retro Cup', 'LAIC 2027 Championship Series Cup', 'Battle Frontier (Spectral)', 'Battle Frontier (Cauldron)', 'Battle Frontier (Master)']);
    expect(names).toContain('Fmt g3');
    for (const o of within(screen.getByRole('listbox', { name: 'Format' })).getAllByRole('option')) expect(o.querySelector('svg')).toBeTruthy();
  });

  it('colours a cup by the types it is made of, and a plain league by its ball', async () => {
    open();
    await formatBox().then((b) => fireEvent.click(b));
    const style = (name: RegExp) => (within(screen.getByRole('listbox', { name: 'Format' })).getByRole('option', { name }) as HTMLElement).getAttribute('style') ?? '';
    const cauldron = style(/Cauldron/);
    for (const t of ['bug', 'dark', 'fairy', 'ghost', 'poison']) expect(cauldron).toContain(`--type-${t}`);
    expect(style(/^Ultra League/)).toContain('--lg-ultra');
    // Cauldron plays under Ultra's cap, so it wears Ultra's emblem.
    const list = within(screen.getByRole('listbox', { name: 'Format' }));
    expect(list.getByRole('option', { name: /Cauldron/ }).querySelector('svg')?.innerHTML).toBe(list.getByRole('option', { name: /^Ultra League/ }).querySelector('svg')?.innerHTML);
  });

  it('a format of your own that is only a copy of a cup is not listed twice', async () => {
    const { PRESET_FORMATS } = await import('../../lib/presetFormats');
    const { rulesHash } = await import('../../rules');
    formats = [{ ...fmt('copy', 'great', 3), name: 'Retro copy', rulesHash: await rulesHash(PRESET_FORMATS.find((p) => p.key === 'retro')!.format) }, fmt('g3', 'great', 3)];
    open();
    // The cups' hashes are computed asynchronously; until they are, a copy still shows.
    await waitFor(async () => {
      fireEvent.click(await formatBox());
      const names = within(screen.getByRole('listbox', { name: 'Format' })).getAllByRole('option').map((o) => o.textContent ?? '');
      fireEvent.click(await formatBox());
      expect(names.some((n) => n.startsWith('Fmt g3'))).toBe(true);
      expect(names.some((n) => n.startsWith('Retro copy'))).toBe(false);
    });
  });

  it('follows the format to its league: Ultra League lists ultra teams only', async () => {
    open();
    await screen.findByRole('option', { name: 'Team t3' });
    await pickFormat('Ultra League');
    expect(await screen.findByRole('option', { name: 'Team tu' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Team t3' })).toBeNull();
  });

  it('a slot count from a six-Pokémon format lists six-Pokémon teams', async () => {
    formats = [fmt('g6', 'great', 6)];
    open();
    await screen.findByRole('option', { name: 'Team t3' });
    await pickFormat('Fmt g6');
    expect(await screen.findByRole('option', { name: 'Team t6' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '+ Add Pokémon' })).toHaveLength(6);
  });

  it('disables Send until the team is full', async () => {
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
      targetId: 'ally', league: 'great', formatVersionId: 'v-preset',
      format: PRESET_FORMATS[0].format,
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

  it('a cup is saved to your formats on first use; your own format is used as it is', async () => {
    open();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(createChallenge).toHaveBeenCalled());
    expect(versionFor).toHaveBeenCalledTimes(1);
    expect(versionFor.mock.calls[0][0].name).toBe('Great League');
  });

  it('offers GBL (3) and Show 6 (6): six slots, three brought, saved as its own format on send', async () => {
    open();
    expect(screen.getAllByRole('button', { name: '+ Add Pokémon' })).toHaveLength(3);
    fireEvent.click(await screen.findByRole('button', { name: 'Show 6 · 6' }));
    expect(screen.getAllByRole('button', { name: '+ Add Pokémon' })).toHaveLength(6);
    expect(await screen.findByRole('option', { name: 'Team t6' })).toBeTruthy();
    fireEvent.change(await screen.findByLabelText('Saved team'), { target: { value: 't6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(createChallenge).toHaveBeenCalled());
    const sent = createChallenge.mock.calls[0][0];
    expect(sent.format.composition).toMatchObject({ size: 6, bring: 3 });
    expect(sent.team).toHaveLength(6);
    expect(versionFor.mock.calls[0][0].name).toBe('Great League · Show 6');
  });

  it('a six-Pokémon format of your own starts on Show 6 and can be sent as GBL', async () => {
    formats = [fmt('g6', 'great', 6)];
    open();
    await pickFormat('Fmt g6');
    expect(screen.getByRole('button', { name: 'Show 6 · 6' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'GBL · 3' }));
    expect(screen.getAllByRole('button', { name: '+ Add Pokémon' })).toHaveLength(3);
  });

  it('your own format goes out on its own version, with no cup saved', async () => {
    open();
    await choose('Team t3', 'Fmt g3');
    fireEvent.click(screen.getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(createChallenge).toHaveBeenCalled());
    expect(createChallenge.mock.calls[0][0].formatVersionId).toBe('v-g3');
    expect(versionFor).not.toHaveBeenCalled();
  });

  it('a cup binds the team: a Pokémon it bans blocks Send and says so', async () => {
    teams = [{ ...team('t3', 'great', 3), members: ['umbreon', 'azumarill', 'altaria'].map(member) }];
    open();
    await choose('Team t3', 'Retro Cup');
    expect((await screen.findByText(/Umbreon is not allowed in this format/i)).className).toContain('roster-problem');
    expect((screen.getByRole('button', { name: 'Send challenge' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('nothing is saved: the builder is still there to build from scratch', async () => {
    formats = [];
    teams = [];
    open();
    expect(await screen.findByText(/No saved 3-Pokémon teams for this league/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '+ Add Pokémon' })).toHaveLength(3);
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
      expect((await formatBox()).textContent).toMatch(/Ultra League/);
      expect(screen.getByRole('button', { name: 'Send counter' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Send challenge' })).toBeNull();
    });

    it('creates the new challenge first, then declines the original, then opens the DM', async () => {
      const order: string[] = [];
      createChallenge.mockImplementation(async () => { order.push('create'); return 'ch2'; });
      declineChallenge.mockImplementation(async (id: string) => { order.push(`decline:${id}`); return true; });
      openDm.mockImplementation(async () => { order.push('dm'); return 'dm1'; });
      const onClose = counter();
      await choose('Team tu');
      fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(order).toEqual(['create', 'decline:orig', 'dm']);
    });

    it('leaves their challenge alone when your counter is refused', async () => {
      createChallenge.mockRejectedValue(new Error('someone no longer challengeable'));
      const onClose = counter();
      await choose('Team tu');
      fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/no longer challengeable/);
      expect(declineChallenge).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('says so when the counter went out but declining theirs failed, and cannot be sent twice', async () => {
      declineChallenge.mockRejectedValue(new Error('network'));
      counter();
      await choose('Team tu');
      fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Counter sent.*network/);
      expect((screen.getByRole('button', { name: 'Send counter' }) as HTMLButtonElement).disabled).toBe(true);
      expect(createChallenge).toHaveBeenCalledTimes(1);
    });
  });
});
