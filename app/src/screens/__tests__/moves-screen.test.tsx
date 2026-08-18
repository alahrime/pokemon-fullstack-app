import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { MovesScreen } from '../MovesScreen';
import { CHARGE_MOVES, FAST_MOVES, SPECIES, UNSIMULATED_IDS, isSimulated } from '../../lib/data';

const components = readFileSync('src/styles/components.css', 'utf8');

beforeEach(() => localStorage.clear());

const rows = (c: HTMLElement) => [...c.querySelectorAll('.mv-row')];
const heads = (c: HTMLElement) => [...c.querySelectorAll('.mv-th')].map((h) => h.textContent?.replace(/[▼▲·]/g, '').trim());
const search = (c: HTMLElement) => c.querySelector('[aria-label="Search moves"]') as HTMLInputElement;
/** Open the kind listbox and pick one — it is an overlay, not a <select>. */
const chooseKind = (c: HTMLElement, want: 'fast' | 'charge') => {
  fireEvent.click(c.querySelector('[aria-label="Move kind"]')!);
  const label = want === 'fast' ? 'Fast moves' : 'Charge moves';
  fireEvent.click([...c.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes(label))!);
};
const nums = (row: Element) => [...row.querySelectorAll('.mv-num-text')].map((n) => n.textContent);

describe('the move catalogue', () => {
  it('holds every move a simulated species can throw, once each', () => {
    const fast = new Set(FAST_MOVES.map((m) => m.id));
    const charge = new Set(CHARGE_MOVES.map((m) => m.id));
    expect(fast.size).toBe(FAST_MOVES.length);
    expect(charge.size).toBe(CHARGE_MOVES.length);
    // The interned table keys on ID|stab, so a move learned by a same-type and
    // an off-type species is two entries there and must be one here.
    for (const s of SPECIES.filter((sp) => isSimulated(sp.id))) {
      for (const m of s.fastMoves) expect(fast.has(m.id), `${s.id} fast ${m.id}`).toBe(true);
      for (const m of s.chargeMoves) expect(charge.has(m.id), `${s.id} charge ${m.id}`).toBe(true);
    }
  });

  it('inherits the held-out species rather than restating them', () => {
    // Aegislash's stance-change moves are named "Air Slash" and "Psycho Cut"
    // like the real ones and carry 0 power. Listed, they are duplicate rows
    // with broken numbers for a species the engine will not model at all.
    const ids = new Set([...FAST_MOVES, ...CHARGE_MOVES].map((m) => m.id));
    for (const held of UNSIMULATED_IDS) {
      const sp = SPECIES.find((s) => s.id === held);
      if (!sp) continue;
      const exclusive = sp.fastMoves
        .concat(sp.chargeMoves as never[])
        .filter((m) => !SPECIES.some((o) => o.id !== held && isSimulated(o.id)
          && (o.fastMoves.some((x) => x.id === m.id) || o.chargeMoves.some((x) => x.id === m.id))));
      for (const m of exclusive) expect(ids.has(m.id), `${held} only: ${m.id}`).toBe(false);
    }
    // Names are unique once they are gone, which is what makes the table
    // readable in the first place.
    const names = [...FAST_MOVES, ...CHARGE_MOVES].map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('reports the move, not one learner of it: no STAB baked in', () => {
    // Vine Whip is 5 power. Bulbasaur throws it at 1.2, and that copy is what
    // the report screen reads — but the catalogue must not.
    for (const m of [...FAST_MOVES, ...CHARGE_MOVES]) expect(m.stab).toBe(1);
    const vine = FAST_MOVES.find((m) => m.id === 'VINE_WHIP')!;
    expect(vine.power).toBe(5);
  });

  it('splits the two kinds by the only thing that separates them — duration', () => {
    for (const m of FAST_MOVES) expect(typeof m.turns).toBe('number');
    for (const m of CHARGE_MOVES) expect((m as { turns?: number }).turns).toBeUndefined();
  });
});

describe('MovesScreen', () => {
  it('opens on fast moves, with the per-turn figures they alone have', () => {
    const { container } = renderApp(<MovesScreen />);
    expect(heads(container)).toEqual(['Move', 'Type', 'Dmg', 'Energy', 'Turns', 'DPT', 'EPT']);
    expect(rows(container).length).toBeGreaterThan(0);
  });

  it('swaps the columns with the kind, since a charge move has no turns', () => {
    const { container } = renderApp(<MovesScreen />);
    chooseKind(container, 'charge');
    expect(heads(container)).toEqual(['Move', 'Type', 'Dmg', 'Cost', 'DPE', 'Effect']);
  });

  it('searches names, types and archetypes alike', () => {
    const { container } = renderApp(<MovesScreen />);
    fireEvent.change(search(container), { target: { value: 'counter' } });
    expect(rows(container).map((r) => r.querySelector('.mv-name-text')!.textContent)).toContain('Counter');

    fireEvent.change(search(container), { target: { value: 'dragon' } });
    // Matched on type, not on the name — Dragon Breath would qualify either way.
    const types = rows(container).map((r) => r.querySelector('.mv-type-label')!.textContent);
    expect(types.every((t) => t === 'dragon')).toBe(true);
  });

  it('says so plainly when nothing matches', () => {
    const { container } = renderApp(<MovesScreen />);
    fireEvent.change(search(container), { target: { value: 'zzzz' } });
    expect(rows(container)).toHaveLength(0);
    expect(container.querySelector('.mv-empty')).toBeTruthy();
  });

  it('sorts by a column, and reverses it on a second press', () => {
    const { container } = renderApp(<MovesScreen />);
    const dmg = () => rows(container).map((r) => Number(nums(r)[0]));
    // Opens on damage, descending.
    const desc = dmg();
    expect([...desc].sort((a, b) => b - a)).toEqual(desc);
    const header = [...container.querySelectorAll('.mv-sort')].find((b) => b.textContent?.includes('Dmg'))!;
    fireEvent.click(header);
    const asc = dmg();
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);
  });

  it('keeps a sort the other kind also has, and drops one it does not', () => {
    const { container } = renderApp(<MovesScreen />);
    const by = (label: string) =>
      [...container.querySelectorAll('.mv-sort')].find((b) => b.textContent?.includes(label))!;
    fireEvent.click(by('EPT'));
    // EPT is a fast-move column; carrying it across would silently sort by
    // nothing, so the charge table falls back to damage.
    chooseKind(container, 'charge');
    const dmgHead = by('Dmg').closest('th')!;
    expect(dmgHead.getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(by('Cost'));
    chooseKind(container, 'fast');
    // Energy exists in both — that one is kept.
    expect(by('Energy').closest('th')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('pages the catalogue rather than rendering three hundred rows', () => {
    const { container } = renderApp(<MovesScreen />);
    expect(rows(container).length).toBeLessThanOrEqual(25);
    const range = container.querySelector('.pager-range')!.textContent!.replace(/\s+/g, ' ');
    expect(range).toMatch(new RegExp(`1–25 of ${FAST_MOVES.length} moves`));
    fireEvent.click(container.querySelector('[aria-label="Next page"]')!);
    expect(container.querySelector('.pager-range')!.textContent!.replace(/\s+/g, ' ')).toMatch(/26–50/);
  });

  it('returns to the first page when the query narrows under you', () => {
    const { container } = renderApp(<MovesScreen />);
    fireEvent.click(container.querySelector('[aria-label="Next page"]')!);
    fireEvent.change(search(container), { target: { value: 'water' } });
    expect(container.querySelector('.pager-range')!.textContent).toMatch(/^\s*1–/);
  });

  it('colours each row by its move type', () => {
    const { container } = renderApp(<MovesScreen />);
    const row = rows(container)[0];
    const type = row.querySelector('.mv-type-label')!.textContent;
    expect(row.getAttribute('style')).toContain(`--mv-type: var(--type-${type})`);
  });

  it('picks the kind from an overlay, and says which one is current', () => {
    const { container } = renderApp(<MovesScreen />);
    const trigger = container.querySelector('[aria-label="Move kind"]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="listbox"]')).toBeFalsy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const opts = [...container.querySelectorAll('[role="option"]')];
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    // Each option carries how much it holds, so the choice is informed.
    expect(opts[0].textContent).toContain(String(FAST_MOVES.length));
    expect(opts[1].textContent).toContain(String(CHARGE_MOVES.length));

    fireEvent.click(opts[1]);
    // Closes on commit rather than leaving a panel over the table.
    expect(container.querySelector('[role="listbox"]')).toBeFalsy();
    expect(trigger.textContent).toContain('Charge moves');
  });

  it('closes the kind overlay on Escape, without changing anything', () => {
    const { container } = renderApp(<MovesScreen />);
    const trigger = container.querySelector('[aria-label="Move kind"]')!;
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[role="listbox"]')).toBeFalsy();
    expect(trigger.textContent).toContain('Fast moves');
  });

  it('moves between kinds with the arrow keys, and commits on Enter', () => {
    const { container } = renderApp(<MovesScreen />);
    fireEvent.click(container.querySelector('[aria-label="Move kind"]')!);
    const opts = [...container.querySelectorAll('[role="option"]')];
    fireEvent.keyDown(opts[0], { key: 'ArrowDown' });
    fireEvent.keyDown(opts[1], { key: 'Enter' });
    expect(heads(container)).toEqual(['Move', 'Type', 'Dmg', 'Cost', 'DPE', 'Effect']);
  });

  it('declares its geometry, so a re-sort cannot move a column', () => {
    // jsdom lays nothing out, so what is held here is the contract the widths
    // come from; the positions themselves were measured in the browser, where
    // every column's left edge and width is identical across four sorts, a
    // page turn and a filter.
    const { container } = renderApp(<MovesScreen />);
    const table = container.querySelector('.mv-table')!;
    const colgroup = table.querySelector('colgroup')!;
    const colCount = table.querySelectorAll('thead th').length;
    expect(colgroup.querySelectorAll('col')).toHaveLength(colCount);
    // Every column but the name one is pinned; the name column takes the rest.
    const widths = [...colgroup.querySelectorAll('col')].map((c) => (c as HTMLElement).style.width);
    expect(widths.slice(1).every((w) => /^\d+px$/.test(w))).toBe(true);
    expect(components).toMatch(/\.mv-table\s*\{[^}]*table-layout:\s*fixed/);
    // Sized to content, the widths would be a function of whichever rows the
    // current sort surfaced — which is the bug this replaced.
    expect(components).not.toMatch(/\.mv-table\s*\{[^}]*table-layout:\s*auto/);
  });

  it('names the effect a charge move applies, and its odds', () => {
    const { container } = renderApp(<MovesScreen />);
    chooseKind(container, 'charge');
    fireEvent.change(search(container), { target: { value: 'acid spray' } });
    const cells = nums(rows(container)[0]);
    expect(cells.at(-1)).toBe('-2 def foe');
  });
});
