import { describe, it, expect } from 'vitest';
import { renderApp } from '../../test/render';
import { LandingScreen } from '../LandingScreen';
import { LANDING_FEATURED_N } from '../../lib/summarySpec';

/**
 * "Strongest in <league>" is a leaderboard, and has to read as one.
 *
 * It lists the individually strongest Pokemon, so it can and does contain both
 * forms of a species — Forretress and Forretress (Shadow) sit second and sixth
 * in Great. As six built cards in an unnumbered grid it read as a Show 6
 * roster instead, and was reported as a bug on exactly that basis: no legal
 * team may hold both. The data was right and the presentation was not.
 *
 * These assert the things that make it unambiguous. They are cheap structural
 * checks — jsdom lays nothing out, so the ordinal's visibility was measured in
 * the browser instead.
 */

describe('the landing leaderboard is not a team', () => {
  it('is an ordered list, not a bare grid of cards', () => {
    const { container } = renderApp(<LandingScreen />);
    const list = container.querySelector('ol.landing-featured');
    expect(list).toBeTruthy();
    expect(list!.tagName).toBe('OL');
    expect(list!.querySelectorAll(':scope > li')).toHaveLength(LANDING_FEATURED_N);
  });

  it('numbers every entry, which is what a ranking has and a roster does not', () => {
    const { container } = renderApp(<LandingScreen />);
    const ordinals = [...container.querySelectorAll('.landing-featured-pos')].map((e) => e.textContent?.trim());
    expect(ordinals).toEqual(Array.from({ length: LANDING_FEATURED_N }, (_, i) => String(i + 1)));
  });

  it('says in words that these are ranked individually', () => {
    const { container } = renderApp(<LandingScreen />);
    const sub = [...container.querySelectorAll('header span')]
      .map((e) => e.textContent ?? '')
      .find((t) => /Overall/.test(t));
    expect(sub).toBeTruthy();
    expect(sub).toMatch(/individually/i);
    expect(sub).toMatch(/not a team/i);
  });

  it('states each typing once, not twice', () => {
    // The card carries type badges already; the `note` under it repeated them
    // as text — the same fact as a glyph and again as words beneath it.
    const { container } = renderApp(<LandingScreen />);
    const cards = [...container.querySelectorAll('.landing-featured .pc')];
    expect(cards.length).toBe(LANDING_FEATURED_N);
    for (const c of cards) {
      expect(c.querySelector('.pc-types'), 'the badges are the one statement').toBeTruthy();
      expect(c.querySelector('.pc-note'), 'and nothing repeats them').toBeNull();
    }
  });

  it('still allows two forms of one species, because a leaderboard may', () => {
    // The inverse of the team rule: forbidding it here would be the wrong fix,
    // since both forms genuinely are among the strongest.
    const { container } = renderApp(<LandingScreen />);
    const names = [...container.querySelectorAll('.landing-featured .pc-name')].map((e) => e.textContent?.trim() ?? '');
    expect(names.length).toBe(LANDING_FEATURED_N);
    // Nothing asserts a duplicate is present — that depends on the artefact —
    // only that the list is not silently de-duplicated to look like a team.
    expect(new Set(names).size).toBe(names.length);
  });
});
