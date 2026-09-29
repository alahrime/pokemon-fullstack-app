import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import type { AddPokemonChoice } from '../../AddPokemonModal';

const H = vi.hoisted(() => ({ choices: [] as unknown[], registerRoster: vi.fn(), listTeams: vi.fn() }));
vi.mock('../../AddPokemonModal', () => ({
  AddPokemonModal: ({ onCommit, onClose }: { onCommit: (c: AddPokemonChoice) => void; onClose: () => void }) => (
    <button type="button" onClick={() => { onCommit(H.choices.shift() as AddPokemonChoice); onClose(); }}>stub-commit</button>
  ),
}));
vi.mock('../../../lib/tournaments', async (orig) => ({
  ...(await orig<typeof import('../../../lib/tournaments')>()), registerRoster: H.registerRoster,
}));
vi.mock('../../../lib/saves', () => ({ listTeams: H.listTeams }));

import { RosterForm } from '../RosterForm';
import { RULES_SCHEMA, type Format } from '../../../rules';
import { movesFor, SPECIES_BY_ID } from '../../../lib/data';
import { cpBounds, type RosterMember } from '../../../tournament/roster';
import type { Tournament } from '../../../lib/tournaments';

const FORMAT: Format = {
  schema: RULES_SCHEMA, base: 'great', pool: [], composition: { size: 6, uniqueSpecies: true }, selection: { mode: 'open' },
};
const T = { id: 't1', league: 'great' } as Tournament;
const SIX = ['azumarill', 'registeel', 'altaria', 'medicham', 'skarmory', 'stunfisk_galarian'];
const choice = (ref: string): AddPokemonChoice => {
  const s = SPECIES_BY_ID.get(ref)!;
  const m = movesFor(s, 'great');
  return { ref, fastIdx: s.fastMoves.findIndex((f) => f.id === m.fast.id), chargeIds: m.charges.map((c) => c.id), iv: { a: 15, d: 15, s: 15 } };
};
const asMember = (ref: string, cp = 1500): RosterMember => {
  const m = movesFor(SPECIES_BY_ID.get(ref)!, 'great');
  return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id), cp, bestBuddy: false };
};
const onSaved = vi.fn();
const onCancel = vi.fn();
const mount = (props: Partial<React.ComponentProps<typeof RosterForm>> = {}, tournament = T) =>
  render(<RosterForm tournament={tournament} format={FORMAT} league={tournament.league} onSaved={onSaved} onCancel={onCancel} {...props} />);
const cpInput = () => screen.getByLabelText('CP') as HTMLInputElement;
const setCp = (v: string) => fireEvent.change(cpInput(), { target: { value: v } });
const addOne = (ref: string, cp?: string) => {
  H.choices.push(choice(ref));
  fireEvent.click(screen.getAllByRole('button', { name: 'Add Pokémon' })[0]);
  fireEvent.click(screen.getByText('stub-commit'));
  if (cp !== undefined) setCp(cp);
  fireEvent.click(screen.getByRole('button', { name: 'Add to slot' }));
};
const fillSix = (refs = SIX) => refs.forEach((r) => addOne(r));

beforeEach(() => {
  H.choices.length = 0;
  H.registerRoster.mockReset().mockResolvedValue(1);
  H.listTeams.mockReset().mockResolvedValue([]);
  onSaved.mockReset(); onCancel.mockReset();
});
afterEach(cleanup);

describe('RosterForm', () => {
  it('has six slots and a disabled Save', () => {
    mount();
    expect(screen.getAllByText(/^Slot \d$/)).toHaveLength(6);
    expect((screen.getByRole('button', { name: 'Save roster' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for a CP within bounds; out of range disables Add and says the bound', () => {
    mount();
    H.choices.push(choice('azumarill'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Pokémon' })[0]);
    fireEvent.click(screen.getByText('stub-commit'));
    const add = screen.getByRole('button', { name: 'Add to slot' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(cpInput().value).toBe('1500');
    setCp('5');
    expect(add.disabled).toBe(true);
    expect(screen.getByText('CP must be between 10 and 1500')).toBeTruthy();
    setCp('1501');
    expect(add.disabled).toBe(true);
    setCp('1490');
    expect(add.disabled).toBe(false);
  });

  it('Best Buddy raises the ceiling where no league cap cuts it', () => {
    const master = { id: 't1', league: 'master' } as Tournament;
    mount({}, master);
    H.choices.push(choice('azumarill'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Pokémon' })[0]);
    fireEvent.click(screen.getByText('stub-commit'));
    expect(screen.getByText(`CP must be between 10 and ${cpBounds('azumarill', false).max}`)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Best Buddy'));
    expect(screen.getByText(`CP must be between 10 and ${cpBounds('azumarill', true).max}`)).toBeTruthy();
  });

  it('a duplicate species shows the format problem and blocks Save', () => {
    mount();
    fillSix(['azumarill', 'azumarill', 'altaria', 'medicham', 'skarmory', 'stunfisk_galarian']);
    expect(screen.getByText(/Azumarill and Azumarill are the same species/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save roster' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save registers exactly the six members', async () => {
    mount();
    fillSix();
    const save = screen.getByRole('button', { name: 'Save roster' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });
    expect(H.registerRoster).toHaveBeenCalledOnce();
    const [id, roster] = H.registerRoster.mock.calls[0];
    expect(id).toBe('t1');
    expect(roster).toEqual(SIX.map((r) => asMember(r)));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('shows a server error and stays open', async () => {
    H.registerRoster.mockRejectedValue(new Error('this tournament is full'));
    mount();
    fillSix();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save roster' })); });
    expect(screen.getByRole('alert').textContent).toContain('this tournament is full');
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save roster' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('imports a saved team, prompting a CP for each member', async () => {
    const stored = (ref: string) => {
      const m = asMember(ref);
      return { ref, fast_move: m.fast, charge_moves: m.charges, iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: null };
    };
    H.listTeams.mockResolvedValue([
      { id: 'a', name: 'Great six', league: 'great', size: 6, members: SIX.map(stored) },
      { id: 'b', name: 'Ultra six', league: 'ultra', size: 6, members: SIX.map(stored) },
    ]);
    mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import a saved team' })); });
    const pick = screen.getByLabelText('Saved team') as HTMLSelectElement;
    expect(within(pick).queryByText('Ultra six')).toBeNull();
    fireEvent.change(pick, { target: { value: 'a' } });
    for (const ref of SIX) {
      expect(screen.getByText(`Slot ${SIX.indexOf(ref) + 1}: ${SPECIES_BY_ID.get(ref)!.name}`)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Add to slot' }));
    }
    expect(screen.queryByLabelText('CP')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save roster' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save roster' })); });
    expect(H.registerRoster.mock.calls[0][1]).toEqual(SIX.map((r) => asMember(r)));
  });

  it('editing starts from the initial roster', () => {
    mount({ initial: SIX.map((r) => asMember(r, 1400)) });
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'Add Pokémon' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Save roster' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);
    expect(screen.getAllByRole('button', { name: 'Add Pokémon' })).toHaveLength(1);
  });

  it('is a labelled modal dialog that Escape closes', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Your roster' }).getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
