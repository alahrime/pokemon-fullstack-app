import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { BattleScreen } from '../BattleScreen';
import { MATRIX_STORE_KEY } from '../MatrixBattle';
import { bestSpreadFor } from '../../lib/engine';
import { META_SIZE } from '../../lib/battleMatrix';

/** Battle → Matrix, driven the way a player would: lists edited in place, a meta filled in, every view read. */

// Switching from 1v1 carries its pair onto the Matrix; most tests here are about the lists themselves, so only the
// ones that set `carry` see it.
let carry = false;
vi.mock('../../components/BattleModeTabs', async (orig) => {
  const real = await orig<typeof import('../../components/BattleModeTabs')>();
  return { ...real, peekCarried: () => (carry ? real.peekCarried() : null) };
});

const entry = (key: string, ref: string, a: number, d: number, s: number) => ({ key, ref, fastIdx: 0, chargeIds: [], iv: { a, d, s } });

function seed(left: unknown[], right: unknown[] = []) {
  localStorage.setItem(MATRIX_STORE_KEY, JSON.stringify({ great: { left: { entries: left, shields: 1 }, right: { entries: right, shields: 1 } } }));
}

async function openMatrix() {
  const view = renderApp(<BattleScreen />);
  fireEvent.click(screen.getByRole('tab', { name: /^Matrix/ }));
  await screen.findByRole('region', { name: 'Your Pokémon' }, { timeout: 10000 });
  return view;
}

const side = (name: 'Your Pokémon' | 'Opponents') => screen.getByRole('region', { name });

/** Open a FancySelect by its name and pick the option whose label starts with `option`. */
function choose(trigger: HTMLElement, option: string) {
  fireEvent.click(trigger);
  const list = screen.getByRole('listbox');
  const hit = within(list).getAllByRole('option').find((o) => o.querySelector('.fs-label')?.textContent === option);
  if (!hit) throw new Error(`no option "${option}"`);
  fireEvent.click(hit);
}
const shown = (trigger: HTMLElement) => trigger.querySelector('.fs-label')?.textContent;

beforeEach(() => {
  carry = false;
  localStorage.clear();
  URL.createObjectURL = (() => 'blob:x') as never;
  URL.revokeObjectURL = (() => {}) as never;
});

describe('Battle → Matrix', () => {
  it('switches modes, and asks for both sides before showing a matrix', async () => {
    await openMatrix();
    expect(screen.getByText(/Add at least one Pokémon on each side/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Matrix/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /^1v1/ }));
    expect(screen.queryByRole('region', { name: 'Your Pokémon' })).toBeNull();
    expect(screen.getByRole('tab', { name: /^1v1/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('puts Add above Quick Fill, and MAX RANK and Clear in the footer', async () => {
    await openMatrix();
    const left = side('Your Pokémon');
    const add = within(left).getByRole('button', { name: 'Add Pokémon' });
    const fill = within(left).getByRole('button', { name: 'Quick fill Your Pokémon' });
    expect(add.compareDocumentPosition(fill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const foot = left.querySelector('.bm-side-foot')!;
    expect(within(foot as HTMLElement).getByRole('button', { name: 'MAX RANK' })).toBeTruthy();
    expect(within(foot as HTMLElement).getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('quick-fills a side with a meta, fights every pairing, and can undo the fill', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6), entry('b', 'cramorant', 8, 11, 5)], [entry('z', 'azumarill', 0, 15, 15)]);
    const { container } = await openMatrix();
    const opp = side('Opponents');
    const trigger = within(opp).getByRole('button', { name: 'Quick fill Opponents' });
    choose(trigger, 'Great League meta');
    expect(shown(trigger)).toBe('Great League meta');
    expect(container.querySelectorAll('.is-right .bm-card').length).toBe(META_SIZE);
    await waitFor(() => expect(container.querySelectorAll('.bm-table tbody tr').length).toBe(2));
    expect(container.querySelectorAll('.bm-table tbody button.bm-val').length).toBe(2 * META_SIZE);
    expect(JSON.parse(localStorage.getItem(MATRIX_STORE_KEY)!).great.right.entries.length).toBe(META_SIZE);

    // The fill replaced a list of one, and says so with an Undo that puts it back.
    expect(within(opp).getByRole('status').textContent).toMatch(/Replaced 1 with Great League meta/);
    fireEvent.click(within(opp).getByRole('button', { name: 'Undo' }));
    expect(container.querySelectorAll('.is-right .bm-card').length).toBe(1);
  });

  it('edits IVs and moves on the card, sets MAX RANK, duplicates, removes and clears with an undo', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('z', 'azumarill', 0, 15, 15)]);
    await openMatrix();
    const left = side('Your Pokémon');
    // The Analyze screen's appraisal bars, with sword, shield and heart for labels.
    const ivs = within(left).getByRole('group', { name: 'Cramorant IVs' });
    expect(ivs.querySelectorAll('.iv-label.is-icon svg').length).toBe(3);
    fireEvent.click(within(ivs).getByRole('button', { name: 'Increase Attack' }));
    expect(within(ivs).getByRole('slider', { name: 'Attack' }).getAttribute('aria-valuenow')).toBe('9');
    fireEvent.keyDown(within(ivs).getByRole('slider', { name: 'Attack' }), { key: 'End' });
    expect(within(ivs).getByRole('slider', { name: 'Attack' }).getAttribute('aria-valuenow')).toBe('15');

    // Moves are picked on the card from custom lists: type icon, figures, and the second charged move can go.
    const fast = within(left).getByRole('button', { name: 'Cramorant fast move' });
    const before = shown(fast);
    fireEvent.click(fast);
    const other = within(screen.getByRole('listbox')).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'false')!;
    const otherName = other.querySelector('.fs-label')!.textContent!;
    expect(other.querySelector('.fs-fig')?.textContent).toMatch(/e\/t/);
    fireEvent.click(other);
    expect(shown(within(left).getByRole('button', { name: 'Cramorant fast move' }))).toBe(otherName);
    expect(otherName).not.toBe(before);
    choose(within(left).getByRole('button', { name: 'Cramorant charged move 2' }), 'None');
    expect(shown(within(left).getByRole('button', { name: 'Cramorant charged move 2' }))).toBe('None');

    fireEvent.click(within(left).getByRole('button', { name: 'Duplicate Cramorant' }));
    expect(within(left).getAllByRole('listitem').length).toBe(2);

    fireEvent.click(within(left).getByRole('button', { name: 'MAX RANK' }));
    const best = bestSpreadFor('cramorant', 'great');
    for (const g of within(left).getAllByRole('group', { name: 'Cramorant IVs' })) {
      expect(within(g).getByRole('slider', { name: 'Defense' }).getAttribute('aria-valuenow')).toBe(String(best.d));
    }
    expect(within(left).getAllByTitle('Rank 1 roll for this league').length).toBe(2);

    fireEvent.click(within(left).getAllByRole('button', { name: 'Remove Cramorant' })[0]);
    await waitFor(() => expect(within(left).getAllByRole('listitem').length).toBe(1));
    fireEvent.click(within(left).getByRole('button', { name: 'Clear' }));
    expect(within(left).getByText(/No Pokémon yet/)).toBeTruthy();
    expect(within(left).getByRole('status').textContent).toMatch(/Cleared 1/);
    fireEvent.click(within(left).getByRole('button', { name: 'Undo' }));
    expect(within(left).getAllByRole('listitem').length).toBe(1);
  });

  it('picks shields with icon toggles, by click or arrow key', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('x', 'azumarill', 0, 15, 15)]);
    await openMatrix();
    const group = within(side('Opponents')).getByRole('radiogroup', { name: 'Opponents shields' });
    const radio = (n: string) => within(group).getByRole('radio', { name: n });
    expect(radio('1 shield').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('2 shields'));
    expect(radio('2 shields').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('2 shields'), { key: 'ArrowRight' });
    expect(radio('No shields').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('No shields'), { key: 'ArrowLeft' });
    expect(radio('2 shields').getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(screen.getByText('1 v 2')).toBeTruthy());
  });

  it('swaps the sides, shields and all', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('x', 'azumarill', 0, 15, 15), entry('y', 'medicham', 0, 15, 15)]);
    const { container } = await openMatrix();
    fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    expect(container.querySelectorAll('.is-left .bm-card').length).toBe(2);
    expect(container.querySelectorAll('.is-right .bm-card').length).toBe(1);
    expect(within(side('Your Pokémon')).getByText('Azumarill')).toBeTruthy();
  });

  it('reads every view with its Differences, and re-baselines from a row', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6), entry('b', 'cramorant', 1, 2, 13), entry('c', 'jellicent', 1, 14, 14)],
      [entry('x', 'azumarill', 0, 15, 15), entry('y', 'medicham', 0, 15, 15), entry('w', 'registeel', 0, 15, 15)]);
    const { container } = await openMatrix();
    await waitFor(() => expect(container.querySelector('.bm-results.is-stale')).toBeNull());
    const diffs = screen.getByRole('region', { name: 'Differences' });
    expect(within(diffs).getByText('Baseline')).toBeTruthy();

    for (const tab of ['Breakpoints', 'Bulkpoints', 'CMP', 'Battle Rating']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('tab', { name: tab }).getAttribute('aria-selected')).toBe('true');
      expect(!!screen.queryByRole('button', { name: 'Move' })).toBe(tab === 'Breakpoints' || tab === 'Bulkpoints');
      expect(!!container.querySelector('.bm-table .bm-cmp')).toBe(tab === 'CMP');
      expect(screen.getByRole('button', { name: /Record/ }).textContent).toMatch(tab === 'CMP' ? /CMP Record/ : /^Record/);
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Breakpoints' }));
    choose(screen.getByRole('button', { name: 'Move' }), 'Charged Move 1');
    expect(within(diffs).getByText(/charged move 1/)).toBeTruthy();

    // Jellicent against a Cramorant baseline differs somewhere on damage, and its row tallies it.
    const jelly = container.querySelectorAll('.bm-diff-row')[2];
    expect(jelly.querySelectorAll('.bm-chip').length).toBeGreaterThan(0);
    expect(jelly.querySelector('.bm-tally')).toBeTruthy();

    // A different baseline: from the select, then by pressing a row.
    choose(within(diffs).getByRole('button', { name: 'Compare against' }), '3. Jellicent');
    expect(container.querySelectorAll('.bm-diff-row')[2].classList.contains('is-base')).toBe(true);
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.bm-diff-who')[1]);
    expect(container.querySelectorAll('.bm-diff-row')[1].classList.contains('is-base')).toBe(true);
  });

  it('opens a cell as that exact matchup on the 1v1 tab', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('x', 'azumarill', 0, 15, 15)]);
    const { container } = await openMatrix();
    fireEvent.click(within(side('Opponents')).getByRole('radio', { name: '2 shields' }));
    const cell = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>('.bm-table button.bm-val');
      if (!b || container.querySelector('.bm-results.is-stale')) throw new Error('not settled');
      return b;
    });
    expect(cell.getAttribute('aria-label')).toMatch(/Open in 1v1$/);
    fireEvent.click(cell);
    expect(screen.getByRole('tab', { name: /^1v1/ }).getAttribute('aria-selected')).toBe('true');
    const matchup = screen.getByRole('group', { name: 'Matchup' });
    expect(matchup.textContent).toMatch(/Cramorant/);
    expect(matchup.textContent).toMatch(/Azumarill/);
    expect(matchup.textContent).toMatch(/8\/9\/6/);
    expect(matchup.textContent).toMatch(/1v2/);
  });

  it('follows the app\'s charge-timing setting, and switches it', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('x', 'azumarill', 0, 15, 15)]);
    await openMatrix();
    const timing = screen.getByRole('group', { name: 'Charge timing' });
    const asap = within(timing).getByRole('button', { name: 'ASAP' });
    const optimal = within(timing).getByRole('button', { name: 'Optimal' });
    expect(optimal.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(asap);
    expect(asap.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(optimal);
    expect(optimal.getAttribute('aria-pressed')).toBe('true');
  });

  it('sorts by a column, toggles, and goes back to list order', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6), entry('c', 'jellicent', 1, 14, 14), entry('b', 'medicham', 0, 15, 15)],
      [entry('x', 'azumarill', 0, 15, 15), entry('y', 'registeel', 0, 15, 15)]);
    const { container } = await openMatrix();
    const order = () => [...container.querySelectorAll('.bm-table tbody .bm-pos')].map((n) => n.textContent);
    await waitFor(() => expect(order()).toEqual(['1', '2', '3']));
    expect(container.querySelectorAll('.bm-table .bm-crown').length).toBe(1);
    const heads = container.querySelectorAll<HTMLButtonElement>('.bm-colhead .bm-sort');
    fireEvent.mouseEnter(heads[0].parentElement!);
    expect(container.querySelectorAll('.is-col-lit').length).toBeGreaterThan(1);
    fireEvent.mouseLeave(container.querySelector('.bm-scroll')!);
    expect(container.querySelectorAll('.is-col-lit').length).toBe(0);
    fireEvent.click(heads[0]);
    const desc = order();
    fireEvent.click(heads[0]);
    expect(order()).toEqual([...desc].reverse());
    fireEvent.click(screen.getByRole('button', { name: /Record/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Bulkpoints' }));
    fireEvent.click(screen.getByRole('button', { name: 'Average' }));
    fireEvent.click(screen.getByRole('button', { name: /List order/ }));
    expect(order()).toEqual(['1', '2', '3']);
  });

  it('exports the view on show as CSV', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('x', 'azumarill', 0, 15, 15)]);
    await openMatrix();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export to CSV' }));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('adds through the Add Pokémon dialog and edits an entry in it', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)]);
    await openMatrix();
    fireEvent.click(within(side('Opponents')).getByRole('button', { name: 'Add Pokémon' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a Pokémon' });
    const input = dialog.querySelector('input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Medicham' } });
    const row = await waitFor(() => {
      const hit = [...document.querySelectorAll('.search-dropdown .search-row')].find((r) => /^Medicham$/i.test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''));
      if (!hit) throw new Error('no Medicham');
      return hit;
    }, { timeout: 10000 });
    fireEvent.mouseDown(row);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to opponents' }));
    expect(within(side('Opponents')).getByText('Medicham')).toBeTruthy();

    fireEvent.click(within(side('Your Pokémon')).getByTitle("Change Cramorant's species or form"));
    const edit = screen.getByRole('dialog', { name: 'Edit a Pokémon' });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save changes' }));
    expect(within(side('Your Pokémon')).getAllByRole('listitem').length).toBe(1);
  });

  it('ignores a stored list it cannot read', async () => {
    localStorage.setItem(MATRIX_STORE_KEY, '{not json');
    await openMatrix();
    expect(within(side('Your Pokémon')).getByText(/No Pokémon yet/)).toBeTruthy();
  });

  it('carries the 1v1 pair to the front of each side, once, and the X removes it', async () => {
    carry = true;
    // Rolls no default spread lands on, so whichever pair the opening draws, the carry cannot dedupe against them.
    seed([entry('a', 'cramorant', 3, 3, 3)], [entry('x', 'azumarill', 3, 3, 3)]);
    await openMatrix();
    const names = (s: 'Your Pokémon' | 'Opponents') =>
      [...side(s).querySelectorAll('.bm-card-name')].map((n) => n.textContent);
    const left = names('Your Pokémon');
    const right = names('Opponents');
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    expect(left[1]).toBe('Cramorant');
    expect(right[1]).toBe('Azumarill');
    // Back and forth with the same pair adds nothing.
    fireEvent.click(screen.getByRole('tab', { name: /^1v1/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Matrix/ }));
    await screen.findByRole('region', { name: 'Your Pokémon' }, { timeout: 10000 });
    expect(names('Your Pokémon')).toEqual(left);
    expect(names('Opponents')).toEqual(right);
    // The carried card is an ordinary card: its X removes it, and it stays gone after a remount.
    fireEvent.click(within(side('Your Pokémon')).getByRole('button', { name: `Remove ${left[0]}` }));
    await waitFor(() => expect(names('Your Pokémon')).toEqual(['Cramorant']));
    expect(JSON.parse(localStorage.getItem(MATRIX_STORE_KEY)!).great.left.entries).toHaveLength(1);
  });

  it('the + in an empty side opens the Add Pokémon dialog for that side', async () => {
    await openMatrix();
    fireEvent.click(within(side('Opponents')).getByRole('button', { name: 'Add a Pokémon to Opponents' }));
    expect(screen.getByRole('dialog', { name: 'Add a Pokémon' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to opponents' })).toBeTruthy();
  });
});
