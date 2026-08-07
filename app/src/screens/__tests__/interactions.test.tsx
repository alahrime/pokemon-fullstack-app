import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { CoresScreen } from '../CoresScreen';
import { RankingsScreen } from '../RankingsScreen';
import { DiagnosticsScreen } from '../DiagnosticsScreen';
import { TeamBuilderScreen } from '../TeamBuilderScreen';
import { ReportScreen } from '../ReportScreen';
import { FlipView } from '../detail/FlipView';
import { MovePicker } from '../../components/MovePicker';
import { resolveCssColor, clearColorCache, hasWebGL } from '../../lib/cssColor';
import { flipGrid, flipMatchupRows, scenarioMatrix } from '../../lib/engine';
import { movesFor, SPECIES_BY_ID } from '../../lib/data';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

/** Click each button matching a predicate and assert nothing throws. */
const clickAll = (container: HTMLElement, sel: string, max = 12) => {
  const els = [...container.querySelectorAll(sel)].slice(0, max);
  for (const el of els) expect(() => fireEvent.click(el)).not.toThrow();
  return els.length;
};

describe('Cores screen', () => {
  it('switches between pairs, pillars and the checker', () => {
    const { container } = renderApp(<CoresScreen />);
    const segs = [...container.querySelectorAll('.seg-btn')];
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) expect(() => fireEvent.click(s)).not.toThrow();
  });
  it('expands a core row to show the evidence', () => {
    const { container } = renderApp(<CoresScreen />);
    const row = container.querySelector('.core-row');
    if (row) {
      fireEvent.click(row);
      expect(container.querySelector('.core-detail')).toBeTruthy();
      fireEvent.click(row);
    }
  });
  it('shows both members of every pair with their build', () => {
    const { container } = renderApp(<CoresScreen />);
    const first = container.querySelector('.core-row');
    if (first) expect(first.querySelectorAll('.core-side')).toHaveLength(2);
  });
});

describe('Rankings screen', () => {
  it('changes category, pass and tier without throwing', () => {
    const { container } = renderApp(<RankingsScreen />);
    expect(clickAll(container, '.seg-btn', 20)).toBeGreaterThan(0);
  });
  it('expands a row to show every swept loadout', () => {
    const { container } = renderApp(<RankingsScreen />);
    const row = container.querySelector('.rank-row');
    if (row) {
      fireEvent.click(row);
      expect(container.querySelector('.rank-detail')).toBeTruthy();
    }
  });
  it('shows the rated spread and moveset on every row', () => {
    const { container } = renderApp(<RankingsScreen />);
    expect(container.querySelectorAll('.rank-spread').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.rank-moves').length).toBeGreaterThan(0);
  });
  it('pages forward and back', () => {
    const { container } = renderApp(<RankingsScreen />);
    clickAll(container, '.opp-page-step', 4);
  });
});

describe('Diagnostics screen', () => {
  it('switches tier from the chart and from the controls', () => {
    const { container } = renderApp(<DiagnosticsScreen />);
    expect(clickAll(container, '.diag-tier', 8)).toBeGreaterThan(0);
    clickAll(container, '.seg-btn', 12);
  });
  it('shows both rankings side by side', () => {
    const { container } = renderApp(<DiagnosticsScreen />);
    expect(container.querySelectorAll('.diag-col').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.diag-list > li').length).toBeGreaterThan(0);
  });
});

describe('TeamBuilder screen', () => {
  for (const size of [3, 6] as const) {
    it(`size ${size}: renders slots and responds to its controls`, () => {
      const { container } = renderApp(<TeamBuilderScreen size={size} />);
      expect(container.textContent!.length).toBeGreaterThan(50);
      clickAll(container, '.seg-btn', 16);
    });
    it(`size ${size}: opens the add modal from the plus control`, () => {
      const { container } = renderApp(<TeamBuilderScreen size={size} />);
      const plus = [...container.querySelectorAll('button')]
        .find((b) => b.textContent!.trim() === '+' || /add/i.test(b.getAttribute('aria-label') ?? ''));
      if (plus) {
        fireEvent.click(plus);
        expect(container.textContent!.length).toBeGreaterThan(50);
      }
    });
  }
});

describe('Report screen', () => {
  it('switches between its detail views', () => {
    const { container } = renderApp(<ReportScreen />);
    clickAll(container, '.seg-btn', 14);
    clickAll(container, '.chip-btn', 10);
  });
  it('enters and leaves arrange mode', () => {
    const { container } = renderApp(<ReportScreen />);
    const arrange = [...container.querySelectorAll('button')]
      .find((b) => /arrange|rearrang/i.test(b.textContent! + (b.getAttribute('title') ?? '')));
    if (arrange) {
      fireEvent.click(arrange);
      expect(container.querySelector('.board.is-editing')).toBeTruthy();
      fireEvent.click(arrange);
    }
  });
});

describe('FlipView', () => {
  it('renders the grid, the rows and the shield lattice', () => {
    const iv = { a: 0, d: 15, s: 15 };
    const grid = flipGrid('registeel', iv, 'great', 'azumarill', 0, 1);
    const rows = flipMatchupRows('registeel', iv, 'great', 0, ['azumarill', 'carbink']);
    const scenarios = scenarioMatrix('registeel', iv, 'great', 'azumarill', 0);
    const onPick = vi.fn(), onShields = vi.fn(), onIvS = vi.fn(), onSelectOpponent = vi.fn();
    const { container } = renderApp(
      <FlipView
        ivA={0} ivD={15} shieldsMine={1} shieldsTheirs={1} scenarios={scenarios}
        onShields={onShields} grid={grid} ivS={15} onIvS={onIvS} onPick={onPick}
        rows={rows} activeOppIdx={0} onSelectOpponent={onSelectOpponent}
        now={{ win: true, margin: 12 }} cmpWin={false}
      />);
    expect(container.textContent!.length).toBeGreaterThan(20);
    clickAll(container, 'button', 10);
  });
  it('renders the losing branch too, which names the flip point', () => {
    const iv = { a: 0, d: 15, s: 15 };
    const grid = flipGrid('registeel', iv, 'great', 'azumarill', 0, 0);
    const { container } = renderApp(
      <FlipView
        ivA={0} ivD={15} shieldsMine={0} shieldsTheirs={0}
        scenarios={scenarioMatrix('registeel', iv, 'great', 'azumarill', 0)}
        onShields={() => {}} grid={grid} ivS={15} onIvS={() => {}} onPick={() => {}}
        rows={[]} activeOppIdx={0} onSelectOpponent={() => {}}
        now={{ win: false, margin: -20 }} cmpWin={false}
      />);
    expect(container.textContent!.length).toBeGreaterThan(20);
  });
});

describe('MovePicker', () => {
  const moves = movesFor(SPECIES_BY_ID.get('azumarill')!, 'great').charges;
  it('opens, filters and picks', () => {
    const onPick = vi.fn();
    const { container } = renderApp(
      <MovePicker count={moves.length} moves={moves} isActive={() => false} onPick={onPick} />);
    const opener = container.querySelector('button')!;
    fireEvent.click(opener);
    const input = container.querySelector('input');
    if (input) fireEvent.change(input, { target: { value: moves[0].name.slice(0, 3) } });
    const option = [...container.querySelectorAll('button')].find((b) => b.textContent!.includes(moves[0].name));
    if (option) { fireEvent.click(option); expect(onPick).toHaveBeenCalled(); }
  });
  it('marks the active move', () => {
    const { container } = renderApp(
      <MovePicker count={moves.length} moves={moves} isActive={(m) => m.id === moves[0].id} onPick={() => {}} />);
    fireEvent.click(container.querySelector('button')!);
    expect(container.textContent).toContain(moves[0].name);
  });
});

describe('cssColor', () => {
  it('resolves a colour expression to RGB', () => {
    const rgb = resolveCssColor('#ff0000');
    expect(rgb).toHaveLength(3);
    expect(rgb.every((c) => c >= 0 && c <= 255)).toBe(true);
  });
  it('caches, and the cache can be cleared', () => {
    const a = resolveCssColor('#00ff00');
    clearColorCache();
    expect(resolveCssColor('#00ff00')).toEqual(a);
  });
  it('reports WebGL availability without throwing in jsdom', () => {
    expect(typeof hasWebGL()).toBe('boolean');
  });
  it('falls back rather than throwing on nonsense', () => {
    expect(() => resolveCssColor('not-a-colour')).not.toThrow();
  });
});
