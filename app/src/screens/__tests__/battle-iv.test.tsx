import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { BattleScreen } from '../BattleScreen';
import { INITIAL_STATE } from '../../state/AppState';
import { bestSpreadFor, getEntry } from '../../lib/engine';

/**
 * The roll the battle screen opens on, and the way back to the best one.
 *
 * It opened on 15/15/15, which is the worst common case in a capped league:
 * attack costs level under the cap, so a perfect Registeel is rank 3,656 of
 * 4,096 in Great. Opening there argued the opposite of what the rest of the
 * app demonstrates. 10/10/10 is the floor the game guarantees on a raid,
 * research or trade catch — a roll people actually hold — and it is rank 1 in
 * no league, so the button always has something to do.
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
  it('is not perfect, and is the same on both sides', () => {
    expect(INITIAL_STATE.ivA).toEqual({ a: 10, d: 10, s: 10 });
    expect(INITIAL_STATE.ivB).toEqual(INITIAL_STATE.ivA);
    expect(INITIAL_STATE.ivA).not.toEqual({ a: 15, d: 15, s: 15 });
  });

  it('is a roll the game actually hands out, and never rank 1', () => {
    // 10/10/10 is the guaranteed floor for a raid, research or trade catch.
    // If it happened to be rank 1 somewhere, the button would be dead there.
    for (const lg of ['great', 'ultra', 'master'] as const) {
      for (const ref of ['registeel', 'azumarill', 'medicham']) {
        const { entry } = getEntry(ref, INITIAL_STATE.ivA, lg);
        expect(entry.rank, `${ref} in ${lg}`).toBeGreaterThan(1);
      }
    }
  });

  it('renders on both sides at load', () => {
    const { container } = renderApp(<BattleScreen />);
    for (const s of sides(container)) expect(ivText(s)).toContain('10/10/10');
  });
});

describe('the rank-1 button', () => {
  it('sets the roll to the rank-1 spread for that species and league', () => {
    const { container } = renderApp(<BattleScreen />);
    const side = sides(container)[0];
    const best = bestSpreadFor(REFS[0], 'great', false);

    fireEvent.click(rankBtn(side));
    const after = sides(container)[0];
    expect(ivText(after)).toContain(`${best.a}/${best.d}/${best.s}`);
    expect(after.querySelector('.bt-iv-rank')!.textContent).toContain('rank 1');
  });

  it('names the roll it is aiming at before you press it', () => {
    const { container } = renderApp(<BattleScreen />);
    const side = sides(container)[0];
    const best = bestSpreadFor(REFS[0], 'great', false);
    expect(rankBtn(side).getAttribute('title')).toContain(`${best.a}/${best.d}/${best.s}`);
  });

  it('disables on arrival rather than vanishing', () => {
    // A control that disappears when it succeeds leaves you unsure it fired.
    const { container } = renderApp(<BattleScreen />);
    expect(rankBtn(sides(container)[0]).disabled).toBe(false);
    fireEvent.click(rankBtn(sides(container)[0]));
    const btn = rankBtn(sides(container)[0]);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/already/i);
  });

  it('moves one side only', () => {
    const { container } = renderApp(<BattleScreen />);
    fireEvent.click(rankBtn(sides(container)[0]));
    expect(ivText(sides(container)[1])).toContain('10/10/10');
  });

  it('re-runs the fight, since the roll is what the screen is asking about', () => {
    const { container } = renderApp(<BattleScreen />);
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
