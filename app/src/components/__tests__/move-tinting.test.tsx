import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderApp } from '../../test/render';
import { PokemonCard } from '../PokemonCard';
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
    const rated = movesFor(sp, 'great');
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
