import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { AddPokemonModal, MODAL_LIST_H } from '../AddPokemonModal';
import { SpeciesSearch } from '../SpeciesSearch';

/**
 * How big the add-to-team modal is, and how the results list fits inside it.
 *
 * jsdom applies no stylesheet, so nothing here asserts a rendered box — the
 * geometry was measured in the browser and is recorded in the CSS comments.
 * Two things a test *can* hold: the CSS rules that give the panel its size,
 * read as text, and the fitting arithmetic, which is JavaScript and runs the
 * same here as anywhere. The stubbed `getBoundingClientRect` in `test/setup.ts`
 * is what makes the second of those measurable at all.
 */

const css = () => readFileSync('src/styles/components.css', 'utf8');

/** The declaration block for a top-level selector. */
function block(selector: string): string {
  const i = css().search(new RegExp(`^\\${selector}\\s*\\{`, 'm'));
  expect(i, `${selector} not found at the top level`).toBeGreaterThan(-1);
  return css().slice(i, css().indexOf('}', i) + 1);
}

describe('add-modal sizing', () => {
  it('gives the panel a floor so the dropdown has somewhere to go', () => {
    // Sized to content, the search phase stood 217px tall and the 464px
    // dropdown ran off the bottom of the screen.
    const rule = block('.modal-panel');
    expect(rule).toMatch(/min-height:\s*min\(/);
    expect(rule).toMatch(/width:\s*min\(620px/);
  });

  it('lets the body fill the panel rather than sizing to its content', () => {
    // Without this the floor above just left dead space under a 104px body,
    // and the body kept a scrollbar in the phase with nothing to scroll.
    expect(block('.modal-body')).toMatch(/flex:\s*1/);
  });

  it('declares each of those selectors once at the top level', () => {
    // The .team-slots lesson: two rules for one selector, and the edit lands
    // on whichever you read rather than whichever wins.
    for (const sel of ['.modal-panel', '.modal-body', '.modal-search']) {
      expect(css().match(new RegExp(`^\\${sel}\\s*\\{`, 'gm')) ?? [], sel).toHaveLength(1);
    }
  });
});

describe('SpeciesSearch — fitting the list to the room it has', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  const realHeight = window.innerHeight;
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
    Object.defineProperty(window, 'innerHeight', { value: realHeight, configurable: true });
  });

  /** Put the field at a given position in a window of a given height. */
  const place = (top: number, bottom: number, innerHeight: number) => {
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if ((this as HTMLElement).classList?.contains('species-search')) {
        return { x: 0, y: top, width: 200, height: bottom - top, top, left: 0, right: 200, bottom, toJSON: () => ({}) } as DOMRect;
      }
      return realRect.call(this);
    };
  };

  const open = (ui: React.ReactElement) => {
    const { container } = renderApp(ui);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    return container;
  };
  const scroller = (c: ParentNode) => c.querySelector('.search-dropdown > div') as HTMLElement;

  it('never asks for a taller box than the window renders rows for', () => {
    // The invariant the whole thing rests on: rows past `listHeight` are never
    // mounted, so a taller box would end in blank space.
    const c = open(<SpeciesSearch id="plain" value="" onChange={() => {}} />);
    expect(parseFloat(scroller(c).style.maxHeight)).toBeLessThanOrEqual(420);
  });

  it('takes the room below the field when there is room', () => {
    place(100, 140, 900);
    const c = open(<SpeciesSearch id="roomy" value="" onChange={() => {}} listHeight={420} />);
    expect(scroller(c).style.maxHeight).toBe('420px');
    expect(c.querySelector('.search-dropdown')?.classList.contains('is-up')).toBe(false);
  });

  it('shrinks to the room below rather than running off the bottom', () => {
    // 1280x560 put a 420px list 252px below the fold with twelve rows
    // unreachable, which is the case this measures.
    place(100, 140, 400);
    const c = open(<SpeciesSearch id="tight" value="" onChange={() => {}} listHeight={420} />);
    const h = parseFloat(scroller(c).style.maxHeight);
    expect(h).toBeLessThan(420);
    expect(140 + h).toBeLessThanOrEqual(400);
  });

  it('opens upward when the field sits too low for any list beneath it', () => {
    place(600, 640, 700);
    const c = open(<SpeciesSearch id="low" value="" onChange={() => {}} listHeight={420} />);
    expect(c.querySelector('.search-dropdown')?.classList.contains('is-up')).toBe(true);
  });

  it('keeps a usable list rather than shrinking to nothing', () => {
    // Squeezed from both sides there is no good answer; three rows and an
    // overhang beats a two-row slot.
    place(80, 120, 200);
    const c = open(<SpeciesSearch id="squeezed" value="" onChange={() => {}} listHeight={420} />);
    expect(parseFloat(scroller(c).style.maxHeight)).toBe(52 * 3);
  });

  it('asks for exactly the room the panel has, and no more', () => {
    renderApp(<AddPokemonModal league="great" onCommit={() => {}} onClose={() => {}} />);
    const input = document.querySelector('.modal-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    const box = document.querySelector('.modal-search .search-dropdown > div') as HTMLElement;
    expect(parseFloat(box.style.maxHeight)).toBeLessThanOrEqual(MODAL_LIST_H);

    // The two move together or the dropdown escapes the panel again: the list
    // plus the chrome above and below it has to fit the panel's floor.
    const floor = Number(block('.modal-panel').match(/min-height:\s*min\((\d+)px/)![1]);
    const CHROME = 46 + 51 + 16 + 40 + 16; // head, foot, body padding, search, clearance
    expect(MODAL_LIST_H + CHROME).toBeLessThanOrEqual(floor);
  });
});
