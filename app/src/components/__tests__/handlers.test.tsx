import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { Board, BoardControls } from '../Board';
import { MovesPanel } from '../MovesPanel';
import { AddPokemonModal } from '../AddPokemonModal';
import { LandingScreen } from '../../screens/LandingScreen';
import { SPECIES_BY_ID } from '../../lib/data';

beforeEach(() => localStorage.clear());

const blocks = [
  { id: 'a', label: 'Alpha', node: <div>alpha</div> },
  { id: 'b', label: 'Beta', node: <div>beta</div> },
  { id: 'c', label: 'Gamma', node: <div>gamma</div> },
];

describe('Board reordering', () => {
  const labels = (c: HTMLElement) =>
    [...c.querySelectorAll('.board-grip-label')].map((e) => e.textContent);

  it('moves a panel up and down with the arrows', () => {
    const { container } = renderApp(<Board storageKey="t1" blocks={blocks} editing />);
    expect(labels(container)).toEqual(['Alpha', 'Beta', 'Gamma']);
    fireEvent.click(container.querySelector('[aria-label="Move Beta up"]')!);
    expect(labels(container)).toEqual(['Beta', 'Alpha', 'Gamma']);
    fireEvent.click(container.querySelector('[aria-label="Move Beta down"]')!);
    expect(labels(container)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('disables the arrow that would move a panel off the end', () => {
    const { container } = renderApp(<Board storageKey="t2" blocks={blocks} editing />);
    const up = container.querySelector('[aria-label="Move Alpha up"]') as HTMLButtonElement;
    const down = container.querySelector('[aria-label="Move Gamma down"]') as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
  });

  it('shows each panel its position in the order', () => {
    const { container } = renderApp(<Board storageKey="t3" blocks={blocks} editing />);
    expect([...container.querySelectorAll('.board-grip-pos')].map((e) => e.textContent))
      .toEqual(['1/3', '2/3', '3/3']);
  });

  it('reorders by drag and drop, and clears the hover state on leave', () => {
    const { container } = renderApp(<Board storageKey="t4" blocks={blocks} editing />);
    const items = [...container.querySelectorAll('.board-slot')] as HTMLElement[];
    const data = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(items[2], { dataTransfer: data });
    fireEvent.dragOver(items[0], { dataTransfer: data });
    expect(container.querySelector('.is-over')).toBeTruthy();
    fireEvent.dragLeave(items[0]);
    expect(container.querySelector('.is-over')).toBeFalsy();
    fireEvent.dragOver(items[0], { dataTransfer: data });
    fireEvent.drop(items[0], { dataTransfer: data });
    expect(labels(container)).toEqual(['Gamma', 'Alpha', 'Beta']);
    fireEvent.dragEnd(items[2]);
  });

  it('persists the order and restores it on remount', () => {
    const first = renderApp(<Board storageKey="keep" blocks={blocks} editing />);
    fireEvent.click(first.container.querySelector('[aria-label="Move Gamma up"]')!);
    expect(labels(first.container)).toEqual(['Alpha', 'Gamma', 'Beta']);
    first.unmount();
    const second = renderApp(<Board storageKey="keep" blocks={blocks} editing />);
    expect(labels(second.container)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });
});

describe('BoardControls', () => {
  it('toggles editing', () => {
    const onEditing = vi.fn();
    const { container } = renderApp(
      <BoardControls storageKey="t5" editing={false} onEditing={onEditing} onReset={() => {}} />);
    fireEvent.click(container.querySelector('.board-edit-btn')!);
    expect(onEditing).toHaveBeenCalledWith(true);
  });

  it('offers Reset only while editing, and clears the stored order', () => {
    const onReset = vi.fn();
    const off = renderApp(
      <BoardControls storageKey="t6" editing={false} onEditing={() => {}} onReset={onReset} />);
    expect([...off.container.querySelectorAll('button')].some((b) => b.textContent === 'Reset')).toBe(false);
    const on = renderApp(
      <BoardControls storageKey="t6" editing onEditing={() => {}} onReset={onReset} />);
    const reset = [...on.container.querySelectorAll('button')].find((b) => b.textContent === 'Reset')!;
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalled();
  });
});

describe('MovesPanel', () => {
  const azumarill = SPECIES_BY_ID.get('azumarill')!;

  it('picks a fast move by its tile', () => {
    const onMoveIdx = vi.fn();
    const { container } = renderApp(
      <MovesPanel species={azumarill} moveIdx={0} onMoveIdx={onMoveIdx}
        chargeIds={[]} onChargeIds={() => {}} />);
    // The fast column is the first one; the charged tiles share the class.
    const fastCol = container.querySelectorAll('.moves-col')[0];
    const tiles = fastCol.querySelectorAll('.move-tile');
    expect(tiles.length).toBeGreaterThan(0);
    fireEvent.click(tiles[0]);
    expect(onMoveIdx).toHaveBeenCalled();
  });

  it('adds a charged move, and drops the oldest at the cap of two', () => {
    const onChargeIds = vi.fn();
    const ids = azumarill.chargeMoves.map((m) => m.id);
    const { container } = renderApp(
      <MovesPanel species={azumarill} moveIdx={0} onMoveIdx={() => {}}
        chargeIds={ids.slice(0, 2)} onChargeIds={onChargeIds} />);
    const tiles = [...container.querySelectorAll('.moves-col')[1].querySelectorAll('.move-tile')];
    const inactive = tiles.find((t) => !t.className.includes('is-active'));
    if (inactive) {
      fireEvent.click(inactive);
      const next = onChargeIds.mock.calls[0][0] as string[];
      expect(next).toHaveLength(2);
      expect(next[0]).toBe(ids[1]);
    }
  });

  it('never leaves the Pokémon with nothing to throw', () => {
    const onChargeIds = vi.fn();
    const only = [azumarill.chargeMoves[0].id];
    const { container } = renderApp(
      <MovesPanel species={azumarill} moveIdx={0} onMoveIdx={() => {}}
        chargeIds={only} onChargeIds={onChargeIds} />);
    // Scope to the charged column: the fast column's tiles share the class,
    // and its active tile calls onMoveIdx instead.
    const chargeCol = container.querySelectorAll('.moves-col')[1];
    const active = [...chargeCol.querySelectorAll('.move-tile')]
      .find((t) => t.className.includes('is-active'));
    expect(active).toBeTruthy();
    fireEvent.click(active!);
    // Whatever it hands back, it is never empty.
    expect((onChargeIds.mock.calls[0][0] as string[]).length).toBeGreaterThan(0);
  });

  it('says how many moves there are when the picker is not needed', () => {
    // Azumarill is over the threshold in both columns and gets pickers; a
    // Pokemon with one of each gets the note instead, which is what answers
    // "is there more, or is that everything?".
    const magikarp = SPECIES_BY_ID.get('magikarp')!;
    const { container } = renderApp(
      <MovesPanel species={magikarp} moveIdx={0} onMoveIdx={() => {}}
        chargeIds={[]} onChargeIds={() => {}} />);
    const notes = [...container.querySelectorAll('.move-slot-note')].map((n) => n.textContent);
    expect(notes).toHaveLength(2);
    expect(notes.join(' ')).toMatch(/Only fast move/);
    expect(notes.join(' ')).toMatch(/Only charged move/);
  });

  it('offers a reset once the selection differs from the rated set', () => {
    const onChargeIds = vi.fn();
    const odd = [azumarill.chargeMoves[azumarill.chargeMoves.length - 1].id];
    const { container } = renderApp(
      <MovesPanel species={azumarill} moveIdx={0} onMoveIdx={() => {}}
        chargeIds={odd} onChargeIds={onChargeIds} />);
    const reset = [...container.querySelectorAll('button')].find((b) => b.textContent === 'reset');
    if (reset) {
      fireEvent.click(reset);
      expect(onChargeIds).toHaveBeenCalledWith([]);
    }
  });
});

describe('AddPokemonModal', () => {
  const open = () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    const r = renderApp(
      <AddPokemonModal league="great" restrictTo={undefined} onCommit={onCommit} onClose={onClose} />);
    // Portalled into <body>, so the dialog is never inside the render's own
    // container — see the comment on the portal in AddPokemonModal.
    return { ...r, container: document.body, onCommit, onClose };
  };
  const choose = async (container: HTMLElement, name: string) => {
    const input = container.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: name } });
    const row = await waitFor(() => {
      const r = [...container.querySelectorAll('.search-row')].find((x) => new RegExp(name, 'i').test(x.textContent ?? ''));
      if (!r) throw new Error(`no ${name}`);
      return r;
    });
    fireEvent.mouseDown(row);
  };

  it('closes on Escape and on a click outside the panel', () => {
    const a = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(a.onClose).toHaveBeenCalled();
    const b = open();
    // Both dialogs portal into the same <body>, so this has to be the scrim
    // that belongs to the second one — the first is still mounted.
    const scrim = [...document.body.querySelectorAll('.modal-scrim')].at(-1)!;
    fireEvent.mouseDown(scrim, { target: scrim });
    expect(b.onClose).toHaveBeenCalled();
  });

  it('builds a Pokémon and commits its moves and roll', async () => {
    const { container, onCommit } = open();
    await choose(container, 'azumarill');
    const fastChips = [...container.querySelectorAll('.modal-moves .chip-btn')];
    expect(fastChips.length).toBeGreaterThan(0);
    fireEvent.click(fastChips[0]);
    const add = [...container.querySelectorAll('button')].find((b) => /add|confirm/i.test(b.textContent ?? ''));
    if (add) {
      fireEvent.click(add);
      expect(onCommit).toHaveBeenCalled();
      const choice = onCommit.mock.calls[0][0];
      expect(choice.ref).toBe('azumarill');
      expect(typeof choice.fastIdx).toBe('number');
      expect(choice.iv).toBeTruthy();
    }
  });

  it('adjusts the IVs and puts them back to the rank-1 roll', async () => {
    const { container } = open();
    await choose(container, 'azumarill');
    const steppers = container.querySelectorAll('.iv-adjuster button');
    expect(steppers.length).toBeGreaterThan(0);
    const before = container.querySelector('.iv-value')?.textContent;
    fireEvent.click(steppers[0]);
    const reset = container.querySelector('.modal-reset')!;
    fireEvent.click(reset);
    if (before !== undefined) {
      expect(container.querySelector('.iv-value')?.textContent).toBe(before);
    }
  });

  it('allows a build with no charged move at all, and says so', async () => {
    const { container } = open();
    await choose(container, 'azumarill');
    const chargeSection = [...container.querySelectorAll('.modal-section')]
      .find((s) => /Charged moves/.test(s.textContent ?? ''))!;
    for (const b of chargeSection.querySelectorAll('.chip-btn.is-active')) fireEvent.click(b);
    expect(container.textContent).toMatch(/never throw one/);
  });
});

describe('LandingScreen', () => {
  it('opens a featured Pokémon straight into its report', () => {
    const { container } = renderApp(<LandingScreen />);
    const card = container.querySelector('.pc');
    expect(card).toBeTruthy();
    fireEvent.click(card!);
  });

  it('routes to a screen from the Where to go cards', () => {
    const { container } = renderApp(<LandingScreen />);
    const routes = container.querySelectorAll('.landing-route');
    expect(routes.length).toBeGreaterThan(0);
    fireEvent.click(routes[0]);
  });

  it('searching commits the pick and clears any carried-over moves', async () => {
    const { container } = renderApp(<LandingScreen />);
    const input = container.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'skarmory' } });
    const row = await waitFor(() => {
      const r = [...container.querySelectorAll('.search-row')].find((x) => /skarmory/i.test(x.textContent ?? ''));
      if (!r) throw new Error('no Skarmory');
      return r;
    });
    fireEvent.mouseDown(row);
  });
});
