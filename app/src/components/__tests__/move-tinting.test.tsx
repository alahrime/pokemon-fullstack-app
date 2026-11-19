import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { renderApp } from '../../test/render';
import { PokemonCard } from '../PokemonCard';
import { AddPokemonModal } from '../AddPokemonModal';
import { FancySelect } from '../FancySelect';
import { moveTypeStyle } from '../../lib/pokemonTypes';
import { SPECIES_BY_ID, movesFor } from '../../lib/data';

/**
 * Move chips are coloured by the MOVE's type, not the species'.
 *
 * They used to take `--t2`, the Pokemon's second type, so every move on a
 * Pokemon was the same colour — which is the one thing a move chip should not
 * say. Registeel is the sharp case: mono-Steel, carrying a Normal fast move
 * and a Fighting charged move, so a species-tinted card renders three chips in
 * one hue and a move-tinted one renders three different hues.
 *
 * jsdom applies no stylesheet, so what is asserted is the custom property the
 * chip carries; the resolved colours were read in the browser, in a dark theme
 * and a light one.
 */

describe('a move chip takes its own type', () => {
  it('gives each move its own hue, even on a mono-type Pokemon', () => {
    const { container } = renderApp(<PokemonCard refId="registeel" league="great" size="full" />);
    const chips = [...container.querySelectorAll('.pc-move')] as HTMLElement[];
    expect(chips.length).toBeGreaterThanOrEqual(3);
    const tints = chips.map((c) => c.style.getPropertyValue('--move-type'));
    expect(tints.every((t) => t.length > 0)).toBe(true);
    // Not all one colour — that is exactly the old behaviour.
    expect(new Set(tints).size).toBeGreaterThan(1);
  });

  it('takes the move’s type even when the species does not have it', () => {
    const sp = SPECIES_BY_ID.get('registeel')!;
    const rated = movesFor(sp, 'great', false);
    expect(sp.types).toEqual(['steel']);
    const offType = [rated.fast, ...rated.charges].find((m) => !sp.types.includes(m.type));
    expect(offType, 'Registeel should rate a move off its own typing').toBeTruthy();

    const { container } = renderApp(<PokemonCard refId="registeel" league="great" size="full" />);
    const chip = [...container.querySelectorAll('.pc-move')].find(
      (c) => c.querySelector('.pc-move-name')?.textContent === offType!.name,
    ) as HTMLElement;
    expect(chip.style.getPropertyValue('--move-type')).toBe(`var(--type-${offType!.type})`);
    expect(chip.style.getPropertyValue('--move-type')).not.toBe('var(--type-steel)');
  });

  it('falls back rather than resolving to nothing for an unknown type', () => {
    // `var(--type-)` would be invalid and the chip would lose its rail, so the
    // helper declines instead and the stylesheet keeps its own default.
    expect(moveTypeStyle('water')).toEqual({ '--move-type': 'var(--type-water)' });
    expect(moveTypeStyle('WATER')).toEqual({ '--move-type': 'var(--type-water)' });
    expect(moveTypeStyle('nonsense')).toEqual({});
    expect(moveTypeStyle('')).toEqual({});
  });

  it('distinguishes the fast move by weight, not by a different hue', () => {
    // Colouring it with the accent hid its type, which is the information this
    // is about — so the fast chip keeps its own colour and reads as primary
    // through the rail width and full-strength text instead.
    const css = readFileSync('src/styles/components.css', 'utf8');
    const i = css.search(/^\.pc-move-fast\s*\{/m);
    const rule = css.slice(i, css.indexOf('}', i)).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rule).toMatch(/border-left-width/);
    expect(rule).not.toMatch(/border-left-color:\s*var\(--color-accent\)/);
  });
});

/**
 * The same rule wherever a move sits in a container: the add-Pokémon chips and
 * the Matrix card's move selects carry the move's own `--move-type` and the
 * shared `.move-chip` class, so one stylesheet block colours all of them.
 */
describe('move containers outside the card take the move type too', () => {
  it('tints each move chip in the add-Pokémon dialog by its own type', () => {
    const sp = SPECIES_BY_ID.get('registeel')!;
    render(<AddPokemonModal league="great" initial={{ ref: 'registeel', chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } }}
      onCommit={vi.fn()} onClose={vi.fn()} />);
    const chips = [...document.querySelectorAll('.modal-moves .chip-btn')] as HTMLElement[];
    expect(chips.length).toBe(sp.fastMoves.length + new Set(sp.chargeMoves.map((m) => m.id)).size);
    for (const c of chips) expect(c.classList.contains('move-chip')).toBe(true);
    // Fast chips come first, in the species' own order.
    sp.fastMoves.forEach((m, i) => expect(chips[i].style.getPropertyValue('--move-type')).toBe(`var(--type-${m.type})`));
    // A mono-Steel body, and still more than one hue.
    expect(new Set(chips.map((c) => c.style.getPropertyValue('--move-type'))).size).toBeGreaterThan(1);
  });

  it('tints a select trigger by the chosen move, and each option by its own', () => {
    const options = [
      { value: 'a', label: 'Water Gun', tint: 'water' },
      { value: 'b', label: 'Ember', tint: 'fire' },
      { value: 'c', label: 'None' },
    ];
    const { rerender } = render(<FancySelect value="a" label="Fast move" options={options} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Fast move' });
    expect(trigger.classList.contains('move-chip')).toBe(true);
    expect(trigger.style.getPropertyValue('--move-type')).toBe('var(--type-water)');
    fireEvent.click(trigger);
    const opts = screen.getAllByRole('option') as HTMLElement[];
    expect(opts.map((o) => o.style.getPropertyValue('--move-type'))).toEqual(['var(--type-water)', 'var(--type-fire)', '']);
    // The option keeps its stagger index alongside the tint.
    expect(opts[1].style.getPropertyValue('--i')).toBe('1');
    // An untinted choice leaves the trigger plain.
    rerender(<FancySelect value="c" label="Fast move" options={options} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Fast move' }).classList.contains('move-chip')).toBe(false);
  });
});
