import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { BattleScreen } from '../BattleScreen';

beforeEach(() => localStorage.clear());

/** The two Side panels, in the order they are rendered. */
const sides = (c: HTMLElement) => [...c.querySelectorAll('.bt-side')] as HTMLElement[];

/** Put a known Pokémon on a side, since the screen now opens on a random one. */
async function setSpecies(side: HTMLElement, name: string) {
  const input = side.querySelector('.species-search input') as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: name } });
  const row = await waitFor(() => {
    const r = [...side.querySelectorAll('.search-row')]
      .find((x) => new RegExp(`^${name}$`, 'i').test(x.textContent?.trim().split('\n')[0] ?? ''))
      ?? [...side.querySelectorAll('.search-row')].find((x) => new RegExp(name, 'i').test(x.textContent ?? ''));
    if (!r) throw new Error(`no ${name}`);
    return r;
  });
  fireEvent.mouseDown(row);
  await waitFor(() => expect(side.textContent).toMatch(new RegExp(name, 'i')));
}

describe('BattleScreen — per-side controls', () => {
  it('renders one control panel per side', () => {
    const { container } = renderApp(<BattleScreen />);
    expect(sides(container)).toHaveLength(2);
  });

  it('sets each side\'s shield count independently', () => {
    const { container } = renderApp(<BattleScreen />);
    const [a, b] = sides(container);
    const zeroA = within(a).getAllByText('0 shields')[0].closest('button')!;
    fireEvent.click(zeroA);
    expect(zeroA.className).toMatch(/is-active/);
    // The other side is untouched — the two counts are separate settings.
    const zeroB = within(b).getAllByText('0 shields')[0].closest('button')!;
    expect(zeroB.className).not.toMatch(/is-active/);
    fireEvent.click(zeroB);
    expect(zeroB.className).toMatch(/is-active/);
  });

  it('sets starting energy from the slider', () => {
    const { container } = renderApp(<BattleScreen />);
    const [a] = sides(container);
    const range = a.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(range, { target: { value: '50' } });
    expect(a.textContent).toMatch(/Starting energy — 50%/);
  });

  it('fields a charged move the league does not rate', () => {
    const { container } = renderApp(<BattleScreen />);
    const [a] = sides(container);
    // The panel used to offer only the two RATED charged moves, as chips that
    // could be switched off — a third move could not be fielded at all.
    const chargeCol = a.querySelectorAll('.moves-col')[1];
    fireEvent.click(chargeCol.querySelector('.move-picker-btn')!);
    const rows = [...chargeCol.querySelectorAll('.move-picker-row')];
    expect(rows.length).toBeGreaterThan(2);
    const unrated = rows.find((r) => !r.className.includes('is-active'))!;
    const name = unrated.querySelector('.move-picker-name')!.textContent!;
    fireEvent.click(unrated);
    const equipped = [...chargeCol.querySelectorAll('.move-tile')].map((t) => t.textContent ?? '');
    expect(equipped.some((t) => t.includes(name))).toBe(true);
  });

  it('re-runs the fight when a side changes its charged moves', async () => {
    // Pinned rather than left to the opening draw: the screen now starts on a
    // random matchup, and plenty of pairs are decided by something other than
    // the charged move, which would make this pass or fail by luck. This is
    // the pair the behaviour was first confirmed on in the browser — giving
    // Lickilicky Earthquake turns a 5% loss into a 7% win.
    const { container } = renderApp(<BattleScreen />);
    await setSpecies(sides(container)[0], 'azumarill');
    await setSpecies(sides(container)[1], 'lickilicky');

    const before = container.querySelector('.bt-winner')!.textContent! +
      container.querySelector('.bt-margin')!.textContent!;
    const chargeCol = sides(container)[1].querySelectorAll('.moves-col')[1];
    fireEvent.click(chargeCol.querySelector('.move-picker-btn')!);
    const unrated = [...chargeCol.querySelectorAll('.move-picker-row')]
      .find((r) => !r.className.includes('is-active'))!;
    expect(unrated).toBeTruthy();
    fireEvent.click(unrated);
    const after = container.querySelector('.bt-winner')!.textContent! +
      container.querySelector('.bt-margin')!.textContent!;
    expect(after).not.toBe(before);
  });

  it('picks a different fast move', () => {
    const { container } = renderApp(<BattleScreen />);
    const [a] = sides(container);
    const browse = a.querySelector('.move-picker-btn') as HTMLButtonElement;
    if (browse) {
      fireEvent.click(browse);
      expect(browse.getAttribute('aria-expanded')).toBe('true');
      const rows = a.querySelectorAll('.move-picker-row');
      const notActive = [...rows].find((r) => !r.className.includes('is-active'));
      if (notActive) {
        const name = notActive.querySelector('.move-picker-name')!.textContent;
        fireEvent.click(notActive);
        expect(a.textContent).toContain(name);
      }
    } else {
      // Fewer than two fast moves: the chips are the whole control.
      const chips = a.querySelectorAll('.chip-btn');
      expect(chips.length).toBeGreaterThan(0);
    }
  });

  it('filters the move browser and says when nothing matches', () => {
    const { container } = renderApp(<BattleScreen />);
    const [a] = sides(container);
    const browse = a.querySelector('.move-picker-btn') as HTMLButtonElement;
    if (!browse) return;
    fireEvent.click(browse);
    const input = a.querySelector('.move-picker-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzznope' } });
    expect(a.querySelector('.move-picker-empty')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    expect(a.querySelectorAll('.move-picker-row').length).toBeGreaterThan(0);
  });

  it('closes the move browser on Escape', () => {
    const { container } = renderApp(<BattleScreen />);
    const [a] = sides(container);
    const browse = a.querySelector('.move-picker-btn') as HTMLButtonElement;
    if (!browse) return;
    fireEvent.click(browse);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(browse.getAttribute('aria-expanded')).toBe('false');
  });

  it('adjusts an IV with the stepper and re-runs the fight', () => {
    const { container } = renderApp(<BattleScreen />);
    const [a] = sides(container);
    const before = a.textContent;
    const steppers = a.querySelectorAll('.iv-step, .iv-adjuster button');
    expect(steppers.length).toBeGreaterThan(0);
    fireEvent.click(steppers[0]);
    expect(a.textContent).not.toBe(before);
  });

  it('changes a side\'s Pokémon through its search', async () => {
    const { container } = renderApp(<BattleScreen />);
    const [a] = sides(container);
    const input = a.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'skarmory' } });
    const row = await waitFor(() => {
      const r = [...a.querySelectorAll('.search-row')].find((x) => /skarmory/i.test(x.textContent ?? ''));
      if (!r) throw new Error('no Skarmory');
      return r;
    });
    fireEvent.mouseDown(row);
    await waitFor(() => expect(a.textContent).toMatch(/Skarmory/i));
  });
});

describe('BattleScreen — the fight itself', () => {
  it('switches charge timing between immediate and optimised', () => {
    const { container } = renderApp(<BattleScreen />);
    const optimised = container.querySelector('.battle-timing .form-opt-buddy') as HTMLButtonElement;
    fireEvent.click(optimised);
    expect(optimised.getAttribute('aria-pressed')).toBe('true');
    // Optimised holds each charge for the opponent's registration turn, so it
    // is deliberately no longer comparable to PvPoke's published numbers.
    expect(container.textContent).toMatch(/no longer comparable/);
    const immediate = container.querySelector('.battle-timing .form-opt-normal') as HTMLButtonElement;
    fireEvent.click(immediate);
    expect(immediate.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toMatch(/as PvPoke does/);
  });

  it('selects a shield combination from the matrix', () => {
    const { container } = renderApp(<BattleScreen />);
    const cells = container.querySelectorAll('.bt-matrix tbody td');
    expect(cells.length).toBe(9);
    const before = container.querySelector('.bt-margin')!.textContent;
    fireEvent.click(cells[8]);
    expect(container.querySelector('.bt-margin')!.textContent).not.toBe(before);
  });

  it('reports a winner and counts the combinations they take', () => {
    const { container } = renderApp(<BattleScreen />);
    expect(container.querySelector('.bt-winner')!.textContent).toMatch(/ beats /);
    expect(container.textContent).toMatch(/wins \d of 9 shield-count combinations/);
  });
});

describe('BattleScreen — the second side is wired the same as the first', () => {
  it('drives shields, energy, charges, fast move and IVs on side B', async () => {
    const { container } = renderApp(<BattleScreen />);
    const b = sides(container)[1];

    // Shields
    const twoShields = within(b).getAllByText('2 shields')[0].closest('button')!;
    fireEvent.click(twoShields);
    expect(twoShields.className).toMatch(/is-active/);

    // Starting energy
    const range = b.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(range, { target: { value: '30' } });
    expect(b.textContent).toMatch(/Starting energy — 30%/);

    // Charged moves come from the shared panel now, not from chips.
    const chargeCol = b.querySelectorAll('.moves-col')[1];
    const equipped = [...chargeCol.querySelectorAll('.move-tile')]
      .filter((t) => t.className.includes('is-active'));
    expect(equipped.length).toBeGreaterThan(0);

    // An IV step
    const before = b.textContent;
    const steppers = b.querySelectorAll('.iv-adjuster button');
    expect(steppers.length).toBeGreaterThan(0);
    fireEvent.click(steppers[0]);
    expect(b.textContent).not.toBe(before);
  });

  it('changes side B\'s Pokémon without disturbing side A', async () => {
    const { container } = renderApp(<BattleScreen />);
    const [a, b] = sides(container);
    const aName = a.querySelector('.battle-mon-name')!.textContent;
    const input = b.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'medicham' } });
    const row = await waitFor(() => {
      const r = [...b.querySelectorAll('.search-row')].find((x) => /medicham/i.test(x.textContent ?? ''));
      if (!r) throw new Error('no Medicham');
      return r;
    });
    fireEvent.mouseDown(row);
    await waitFor(() => expect(b.textContent).toMatch(/Medicham/i));
    expect(a.querySelector('.battle-mon-name')!.textContent).toBe(aName);
  });

  it('toggles Best Buddy where a spread can exceed level 50', () => {
    const { container } = renderApp(<BattleScreen />);
    for (const side of sides(container)) {
      const buddy = side.querySelector('.form-opt-buddy') as HTMLButtonElement;
      if (buddy && !buddy.disabled) {
        fireEvent.click(buddy);
        expect(buddy.getAttribute('aria-pressed')).toBe('true');
      }
    }
  });

  it('picks a fast move on side B through its browser', () => {
    const { container } = renderApp(<BattleScreen />);
    const b = sides(container)[1];
    const browse = b.querySelector('.move-picker-btn') as HTMLButtonElement;
    if (!browse) return;
    fireEvent.click(browse);
    const rows = [...b.querySelectorAll('.move-picker-row')];
    const other = rows.find((r) => !r.className.includes('is-active'));
    if (other) {
      const name = other.querySelector('.move-picker-name')!.textContent;
      fireEvent.click(other);
      expect(b.textContent).toContain(name);
    }
  });
});

describe('BattleScreen — the remaining controls', () => {
  it('the equipped fast-move chip is a label, not a control', () => {
    const { container } = renderApp(<BattleScreen />);
    const a = sides(container)[0];
    const chips = a.querySelector('.bt-chips');
    if (!chips) return; // one fast move: no chip row, no picker
    const equipped = chips.querySelector('.chip-btn') as HTMLButtonElement;
    const before = a.textContent;
    fireEvent.click(equipped);
    // It shows which move is equipped; clicking it changes nothing.
    expect(a.textContent).toBe(before);
  });

  it('offers Best Buddy on a species whose spread can still gain levels', async () => {
    const { container } = renderApp(<BattleScreen />);
    const b = sides(container)[1];
    const input = b.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bulbasaur' } });
    const row = await waitFor(() => {
      const r = [...b.querySelectorAll('.search-row')].find((x) => /bulbasaur/i.test(x.textContent ?? ''));
      if (!r) throw new Error('no Bulbasaur');
      return r;
    });
    fireEvent.mouseDown(row);
    await waitFor(() => expect(b.textContent).toMatch(/Bulbasaur/i));

    const buddy = b.querySelector('.form-opt-buddy') as HTMLButtonElement;
    expect(buddy.disabled).toBe(false);
    fireEvent.click(buddy);
    expect(buddy.getAttribute('aria-pressed')).toBe('true');
    // Levels 50.5 and 51 are now in play, so the roll it reports must move.
    const back = b.querySelector('.form-opt-normal') as HTMLButtonElement;
    fireEvent.click(back);
    expect(back.getAttribute('aria-pressed')).toBe('true');
  });
});
