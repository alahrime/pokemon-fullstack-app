import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { InfoPopover } from '../InfoPopover';
import { RankingsScreen } from '../../screens/RankingsScreen';
import { CoresScreen } from '../../screens/CoresScreen';
import { TeamBuilderScreen } from '../../screens/TeamBuilderScreen';
import { TEAM_PASSES } from '../../lib/teams';
import { CATEGORIES, CATEGORY_MARK } from '../../lib/scenarios';

/**
 * The methodology, folded away.
 *
 * Four screens opened with several hundred words above the first Pokémon —
 * how a rating is built, what the adjustments are, why the composite is not a
 * battle rating. Measured on the rankings: the first Pokémon sat at y=829 and
 * now sits at y=540, so 289px of explanation came off the top.
 *
 * It is a disclosure rather than a tooltip because the content is paragraphs:
 * it has to be readable at length, selectable, scrollable and reachable by
 * keyboard. What is asserted here is that behaviour, plus that no screen
 * quietly dropped the text on the way.
 */

describe('the information mark', () => {
  it('starts closed and opens on click', () => {
    const { container } = renderApp(<InfoPopover>the long version</InfoPopover>);
    const mark = container.querySelector('.info-pop-mark') as HTMLButtonElement;
    expect(container.querySelector('.info-pop-panel')).toBeNull();
    expect(mark.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(mark);
    expect(container.querySelector('.info-pop-panel')!.textContent).toContain('the long version');
    expect(mark.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not open on hover alone', () => {
    // Hover is the one gesture a keyboard, a screen reader and a touch screen
    // cannot make, and hover-only content also fails WCAG 1.4.13. A press is
    // available to every input — and does not fire as a pointer crosses the
    // header on its way somewhere else.
    const { container } = renderApp(<InfoPopover>hovered</InfoPopover>);
    fireEvent.mouseEnter(container.querySelector('.info-pop') as HTMLElement);
    fireEvent.mouseOver(container.querySelector('.info-pop-mark') as HTMLElement);
    expect(container.querySelector('.info-pop-panel')).toBeNull();
  });

  it('opens from the keyboard, since that is the same press', () => {
    const { container } = renderApp(<InfoPopover>typed</InfoPopover>);
    const mark = container.querySelector('.info-pop-mark') as HTMLButtonElement;
    mark.focus();
    // Enter and Space on a focused <button> both dispatch a click.
    fireEvent.click(mark, { detail: 0 });
    expect(container.querySelector('.info-pop-panel')!.textContent).toContain('typed');
  });

  it('closes on Escape and on an outside click', () => {
    const { container } = renderApp(<InfoPopover>x</InfoPopover>);
    const open = () => fireEvent.click(container.querySelector('.info-pop-mark')!);

    open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.info-pop-panel')).toBeNull();

    open();
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('.info-pop-panel')).toBeNull();
  });

  it('names itself, so the mark is not a bare glyph to a screen reader', () => {
    const { container } = renderApp(<InfoPopover label="How this is measured">x</InfoPopover>);
    const mark = container.querySelector('.info-pop-mark')!;
    expect(mark.getAttribute('aria-label')).toBe('How this is measured');
    expect(mark.getAttribute('title')).toBe('How this is measured');
    fireEvent.click(mark);
    expect(container.querySelector('.info-pop-panel')!.getAttribute('role')).toBe('note');
  });
});

describe('the screens kept their explanations', () => {
  const opened = (c: HTMLElement) => {
    const marks = [...c.querySelectorAll('.info-pop-mark')] as HTMLButtonElement[];
    expect(marks.length, 'no information mark on this screen').toBeGreaterThan(0);
    marks.forEach((m) => fireEvent.click(m));
    return [...c.querySelectorAll('.info-pop-panel')].map((p) => p.textContent ?? '').join(' ');
  };

  it('the rankings still say how a rating is built', () => {
    const { container } = renderApp(<RankingsScreen />);
    const text = opened(container);
    expect(text).toMatch(/mean battle ratings/i);
    expect(text).toMatch(/soft-capped/i);
    expect(text).toMatch(/not a battle rating/i);
    // And the active category's own description leads it.
    expect(text).toContain(CATEGORIES[0].blurb);
  });

  it('the team builders still say what may be picked', () => {
    for (const size of [3, 6] as const) {
      const { container } = renderApp(<TeamBuilderScreen size={size} />);
      expect(opened(container)).toMatch(/measured against/i);
    }
  });

  it('the cores screen still explains lift', () => {
    const { container } = renderApp(<CoresScreen />);
    expect(opened(container)).toMatch(/lift/i);
  });

  it('none of them leaves a wall of text above the content', () => {
    // The panels are the only place a long passage may live now.
    for (const [name, ui] of [
      ['rankings', <RankingsScreen key="r" />],
      ['gbl', <TeamBuilderScreen key="g" size={3} />],
      ['show6', <TeamBuilderScreen key="s" size={6} />],
      ['cores', <CoresScreen key="c" />],
    ] as const) {
      const { container } = renderApp(ui);
      // No exemptions any more. The held-out notice used to need one — it was
      // four lines of prose about three missing species — and is now the same
      // one-line legend the battle screen carries, with its explanation in a
      // title attribute.
      const loose = [...container.querySelectorAll('p')].filter(
        (p) => !p.closest('.info-pop-panel') && (p.textContent ?? '').trim().length > 260,
      );
      expect(loose.map((p) => p.className), name).toEqual([]);
    }
  });
});

describe('the passes are named for what they do', () => {
  it('does not claim a derivative or a regression', () => {
    // Neither pass differentiates anything and there is no regression model.
    // Both are the same simulated chain against the same cutoff; the only
    // difference is whether opponents inside it are weighted.
    const labels = TEAM_PASSES.map((p) => p.label);
    expect(labels).toContain('Even field');
    expect(labels).toContain('Graded field');
    for (const l of labels) {
      expect(l).not.toMatch(/derivative|regression/i);
    }
  });

  it('keeps the artefact ids, which the generated data is keyed on', () => {
    expect(TEAM_PASSES.map((p) => p.id)).toEqual(['d1', 'd2', 'syn']);
  });

  it('gives every category a mark, so none renders a blank', () => {
    for (const c of CATEGORIES) {
      expect(CATEGORY_MARK[c.id], c.id).toBeTruthy();
    }
    // Distinct, or the marks index nothing.
    const marks = CATEGORIES.map((c) => CATEGORY_MARK[c.id]);
    expect(new Set(marks).size).toBe(marks.length);
  });
});
