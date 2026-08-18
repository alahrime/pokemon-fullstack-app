import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { BattleScreen } from '../BattleScreen';
import { INITIAL_STATE } from '../../state/AppState';
import { bestSpreadFor, defaultSpreadFor, getTable } from '../../lib/engine';
import { LEAGUE_BY_ID } from '../../lib/data';

/**
 * The roll the battle screen opens on, and the way back to the best one.
 *
 * Two earlier answers, both wrong for the same reason — neither described a
 * spread anyone fields. 15/15/15 is the worst common case in a capped league:
 * attack costs level under the cap, so a perfect Registeel is rank 3,656 of
 * 4,096 in Great. 10/10/10, the floor a raid or trade catch guarantees,
 * replaced it and was no better as a *default* — rank 2,918 on the opening
 * Kingdra, 27 CP under the cap, quietly deciding every breakpoint on the
 * screen.
 *
 * The rule now is the one a player uses: the best-ranked spread inside the top
 * thirty that comes within 5 CP of the cap. Master is exempt — no cap means no
 * trade-off and 15/15/15 is simply best.
 */

const sides = (c: HTMLElement) => [...c.querySelectorAll('.bt-side')] as HTMLElement[];
const ivText = (side: HTMLElement) => side.querySelector('.battle-mon-stats')!.textContent ?? '';
const rankBtn = (side: HTMLElement) => side.querySelector('.bt-iv-best') as HTMLButtonElement;
/**
 * The refs the screen opens on.
 *
 * Read from the initial state, not off the search input — that shows
 * `displayName(ref)`, so "Corviknight" rather than `corviknight`, and feeding
 * that to `bestSpreadFor` looks up a species that does not exist. The opening
 * matchup is a seeded draw, so these are stable across runs but not worth
 * hard-coding.
 */
const REFS = [INITIAL_STATE.battleA, INITIAL_STATE.battleB] as const;

describe('the opening roll', () => {
  it('opens on each side\'s own default rather than one spread for everyone', () => {
    for (const [ref, iv] of [[REFS[0], INITIAL_STATE.ivA], [REFS[1], INITIAL_STATE.ivB]] as const) {
      const d = defaultSpreadFor(ref, 'great');
      expect(iv, ref).toEqual({ a: d.a, d: d.d, s: d.s });
    }
  });

  it('is high-ranked and pressed against the cap, in every capped league', () => {
    for (const lg of ['great', 'ultra'] as const) {
      const cap = LEAGUE_BY_ID.get(lg)!.cap;
      for (const ref of ['registeel', 'azumarill', 'medicham']) {
        const d = defaultSpreadFor(ref, lg);
        expect(d.rank, `${ref} in ${lg}`).toBeLessThanOrEqual(30);
        // Within 5 CP of the limit — the reason for the rule. A species whose
        // table tops out below the cap keeps its best roll instead.
        const table = getTable(ref, lg);
        const reachable = table.all.slice(0, 30).some((e) => e.cp >= cap - 5);
        if (reachable) expect(d.cp, `${ref} in ${lg}`).toBeGreaterThanOrEqual(cap - 5);
      }
    }
  });

  it('is simply perfect in Master, where nothing is traded for level', () => {
    for (const ref of ['registeel', 'azumarill', 'medicham']) {
      const d = defaultSpreadFor(ref, 'master');
      expect({ a: d.a, d: d.d, s: d.s }, ref).toEqual({ a: 15, d: 15, s: 15 });
    }
  });

  it('renders on both sides at load', () => {
    const { container } = renderApp(<BattleScreen />);
    const want = sides(container).map((_, i) => {
      const d = defaultSpreadFor(i === 0 ? REFS[0] : REFS[1], 'great');
      return `${d.a}/${d.d}/${d.s}`;
    });
    sides(container).forEach((s, i) => expect(ivText(s)).toContain(want[i]));
  });
});

describe('the rank-1 button', () => {
  /**
   * Knock a side off its default so the button has something to do.
   *
   * The opening roll is usually rank 1 now — the default rule and the button
   * are aiming at nearly the same place — so at load the control is correctly
   * disabled. Everything below is about what it does once the roll has moved.
   */
  const nudge = (c: HTMLElement) => {
    // Far enough to move the rendered margin, which is a rounded percentage:
    // one defense point off rank 1 restores to the same displayed figure, so a
    // single click cannot show that the fight re-ran.
    for (let i = 0; i < 5; i++) {
      const step = sides(c)[0].querySelector('[aria-label="Increase Attack"]') as HTMLButtonElement;
      fireEvent.click(step);
    }
  };

  it('sets the roll to the rank-1 spread for that species and league', () => {
    const { container } = renderApp(<BattleScreen />);
    nudge(container);
    const side = sides(container)[0];
    const best = bestSpreadFor(REFS[0], 'great', false);

    fireEvent.click(rankBtn(side));
    const after = sides(container)[0];
    expect(ivText(after)).toContain(`${best.a}/${best.d}/${best.s}`);
    expect(after.querySelector('.bt-iv-rank')!.textContent).toContain('rank 1');
  });

  it('names the roll it is aiming at before you press it', () => {
    const { container } = renderApp(<BattleScreen />);
    nudge(container);
    const side = sides(container)[0];
    const best = bestSpreadFor(REFS[0], 'great', false);
    expect(rankBtn(side).getAttribute('title')).toContain(`${best.a}/${best.d}/${best.s}`);
  });

  it('disables on arrival rather than vanishing', () => {
    // A control that disappears when it succeeds leaves you unsure it fired.
    const { container } = renderApp(<BattleScreen />);
    nudge(container);
    expect(rankBtn(sides(container)[0]).disabled).toBe(false);
    fireEvent.click(rankBtn(sides(container)[0]));
    const btn = rankBtn(sides(container)[0]);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/already/i);
  });

  it('moves one side only', () => {
    const { container } = renderApp(<BattleScreen />);
    const other = defaultSpreadFor(REFS[1], 'great');
    nudge(container);
    fireEvent.click(rankBtn(sides(container)[0]));
    expect(ivText(sides(container)[1])).toContain(`${other.a}/${other.d}/${other.s}`);
  });

  it('re-runs the fight, since the roll is what the screen is asking about', () => {
    const { container } = renderApp(<BattleScreen />);
    nudge(container);
    const before = container.querySelector('.bt-margin')!.textContent;
    fireEvent.click(rankBtn(sides(container)[0]));
    expect(container.querySelector('.bt-margin')!.textContent).not.toBe(before);
  });

  it('aims at a different roll in an uncapped league', () => {
    // Great rewards a low attack IV because attack costs level under the cap.
    // Master has no cap, so rank 1 there really is 15/15/15 — the button has
    // to say so rather than assume perfection is always wrong.
    const great = bestSpreadFor('registeel', 'great', false);
    const master = bestSpreadFor('registeel', 'master', false);
    expect(master).toMatchObject({ a: 15, d: 15, s: 15 });
    expect(great.a).toBeLessThan(15);
  });
});
