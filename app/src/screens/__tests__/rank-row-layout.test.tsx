import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderApp } from '../../test/render';
import { RankingsScreen } from '../RankingsScreen';

/**
 * The rankings row reads across, not down.
 *
 * The Pokémon cell was 585px wide and its content stopped at 285: a 156px
 * stack of name, types, spread and moves, then 357px of nothing before the
 * score. Sprite, identity and moves are three columns now, the sprite is 84px
 * rather than 56, and the gap to the score is 8px.
 *
 * jsdom lays none of that out — the widths were measured in the browser — so
 * what is asserted here is the structure that produces it.
 */

const css = readFileSync('src/styles/components.css', 'utf8');

/**
 * An at-rule's body, brace-matched.
 *
 * A fixed-length slice was the first attempt and it ran off the end of the
 * `@container` block into the density rules after it, which mention exactly
 * the selectors this test asserts are absent.
 */
function balanced(src: string, opener: string): string {
  const at = src.indexOf(opener);
  expect(at, `${opener} not found`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`${opener} is unbalanced`);
}

describe('the rankings row', () => {
  it('puts the moves beside the identity, not inside it', () => {
    const { container } = renderApp(<RankingsScreen />);
    const cell = container.querySelector('.rank-name')!;
    const kids = [...cell.children].map((c) => c.className);
    expect(kids).toHaveLength(3);
    expect(kids[0]).toContain('rank-art');
    expect(kids[1]).toContain('rank-id');
    expect(kids[2]).toContain('pc-moves');
    // The old shape: moves nested inside the identity stack.
    expect(cell.querySelector('.rank-id .pc-moves')).toBeNull();
  });

  it('keeps name, types and the roll together in that identity column', () => {
    const { container } = renderApp(<RankingsScreen />);
    const id = container.querySelector('.rank-id')!;
    expect(id.querySelector('.rank-name-text')).toBeTruthy();
    expect(id.querySelector('.rank-types')).toBeTruthy();
    expect(id.querySelector('.rank-spread')).toBeTruthy();
  });

  it('lays the cell out as three columns rather than a flex stack', () => {
    const i = css.search(/^\.rank-name\s*\{/m);
    const rule = css.slice(i, css.indexOf('}', i)).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rule).toMatch(/display:\s*grid/);
    // Identity hugs its text so both gaps around it are the same 12px; the
    // moves take what is left so the cell is filled.
    expect(rule).toMatch(/grid-template-columns:\s*auto\s+minmax\(0,\s*max-content\)\s+minmax\(0,\s*1fr\)/);
  });

  it('caps the move chip, so a count run stays beside its own move name', () => {
    // A chip is `space-between`: its width is the distance between a name and
    // its numbers. Unbounded that was 328px at 1900 — the name at one end of
    // the row and its count at the other. Capped it is 50-98px.
    expect(css).toMatch(/\.rank-moves \.pc-move \{ max-width: \d+rem; \}/);
  });

  it('states its column widths instead of letting the table guess', () => {
    // Auto layout shares spare width in proportion to content, so the widest
    // column — the Pokemon one — absorbed most of it: 848px holding 470px of
    // build at 1900, with the difference sitting before the score.
    const i = css.search(/^\.rankings-table\s*\{/m);
    const rule = css.slice(i, css.indexOf('}', i));
    expect(rule).toMatch(/table-layout:\s*fixed/);
    expect(css).toMatch(/\.rank-col-mon \{ width: \d+rem; \}/);
  });

  it('gives the sprite the room the wider cell freed', () => {
    const i = css.search(/^\.rank-art\s*\{/m);
    const rule = css.slice(i, css.indexOf('}', i));
    expect(rule).toMatch(/width:\s*84px/);
    expect(rule).toMatch(/height:\s*84px/);
  });
});

describe('the team card splits when its own width allows', () => {
  it('asks the card, not the window', () => {
    // The same component is a 393px team slot, a 323px member of a discovered
    // three and a 184px member of a six — at one viewport. A media query
    // cannot tell those apart.
    const i = css.search(/^\.pc\s*\{/m);
    const rule = css.slice(i, css.indexOf('}', i));
    expect(rule).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container \(min-width: 420px\)/);
  });

  it('only splits the full size, since the small ones have no room', () => {
    const block = balanced(css, '@container (min-width: 420px)');
    expect(block).toMatch(/\.pc-full \.pc-body/);
    expect(block).toMatch(/grid-template-areas/);
    // Compact and mini are never given the two-column treatment.
    expect(block).not.toMatch(/\.pc-compact|\.pc-mini/);
  });
});
