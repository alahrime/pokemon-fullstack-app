import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { Heatmap } from '../Heatmap';
import { FormToggle } from '../FormToggle';
import { BestBuddyToggle } from '../BestBuddyToggle';
import { ThemeSwitch, MotionToggle } from '../ThemeSwitch';
import { SearchHelp } from '../SearchHelp';
import { MovePicker } from '../MovePicker';
import { SpeciesSearch } from '../SpeciesSearch';
import { Sprite } from '../Sprite';
import { TypeBadge } from '../TypeBadge';
import { spriteFallbackUrl, spriteUrl, SPECIES_BY_ID } from '../../lib/data';
import { TEAM_REV, TEAM_ENGINE_REV } from '../../lib/teams';
import { useAppState } from '../../state/AppState';

beforeEach(() => localStorage.clear());

describe('sprite sources', () => {
  it('falls back to the dex-numbered source when a slug has no artwork', () => {
    expect(spriteFallbackUrl(184)).toContain('/184.png');
    expect(spriteUrl('azumarill')).toContain('azumarill');
  });

  it('steps to the fallback art, then to the dex number, when the sources fail', () => {
    const { container } = renderApp(<Sprite sprite="azumarill" dex={184} size={30} />);
    const first = (container.querySelector('img') as HTMLImageElement).src;
    fireEvent.error(container.querySelector('img')!);
    const second = (container.querySelector('img') as HTMLImageElement).src;
    expect(second).not.toBe(first);
    expect(second).toContain('/184.png');
    // Out of artwork: the last resort is the number itself, not a broken image.
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeFalsy();
    expect(container.textContent).toBe('#184');
  });

  it('drops the type icon to its text badge when the image fails', () => {
    const { container } = renderApp(<TypeBadge type="water" />);
    const img = container.querySelector('img');
    if (img) {
      fireEvent.error(img);
      expect(container.querySelector('img')).toBeFalsy();
    }
    expect(container.textContent?.toLowerCase()).toContain('water');
  });
});

describe('teams artefact accessors', () => {
  it('reports the revision the artefact was built at', () => {
    expect(typeof TEAM_REV('great')).toBe('number');
    expect(typeof TEAM_ENGINE_REV('great')).toBe('number');
  });
});

describe('Heatmap', () => {
  const cells = [
    { a: 0, d: 0, tip: 'x', bg: '#111', isYou: false },
    { a: 1, d: 0, tip: 'y', bg: '#222', isYou: true },
  ] as never[];

  it('reports the roll that was clicked', () => {
    const onPick = vi.fn();
    const { container } = renderApp(<Heatmap cells={cells} onPick={onPick} />);
    const tiles = container.querySelectorAll('.heat-cell');
    expect(tiles).toHaveLength(2);
    fireEvent.click(tiles[1]);
    expect(onPick).toHaveBeenCalledWith(1, 0);
  });

  it('marks the current roll', () => {
    const { container } = renderApp(<Heatmap cells={cells} onPick={() => {}} />);
    expect(container.querySelectorAll('.heat-cell.is-you')).toHaveLength(1);
  });
});

describe('FormToggle', () => {
  it('switches back to Normal', () => {
    const onChange = vi.fn();
    const { container } = renderApp(
      <FormToggle shadow eligible onChange={onChange} speciesName="Venusaur" />);
    fireEvent.click(container.querySelector('.form-opt-normal')!);
    expect(onChange).toHaveBeenCalledWith(false);
  });
  it('disables Shadow for a species that has none', () => {
    const { container } = renderApp(
      <FormToggle shadow={false} eligible={false} onChange={() => {}} speciesName="Azumarill" />);
    expect((container.querySelector('.form-opt-shadow') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('BestBuddyToggle', () => {
  it('switches back to level 50', () => {
    const onChange = vi.fn();
    const { container } = renderApp(<BestBuddyToggle on eligible onChange={onChange} />);
    fireEvent.click(container.querySelector('.form-opt-normal')!);
    expect(onChange).toHaveBeenCalledWith(false);
  });
  it('reads as level 50 when no spread here can exceed it', () => {
    const { container } = renderApp(<BestBuddyToggle on eligible={false} onChange={() => {}} />);
    expect(container.querySelector('.form-opt-normal')!.getAttribute('aria-pressed')).toBe('true');
    expect((container.querySelector('.form-opt-buddy') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('theme controls', () => {
  it('applies a chosen theme to the document', () => {
    const { container } = renderApp(<ThemeSwitch />);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(1);
    const other = buttons.find((b) => !b.className.includes('is-active'))!;
    fireEvent.click(other);
    expect(other.className).toMatch(/is-active/);
  });

  it('toggles motion, which is a global setting', () => {
    const { container } = renderApp(<MotionToggle />);
    const btn = container.querySelector('button')!;
    const before = btn.textContent;
    fireEvent.click(btn);
    expect(btn.textContent).not.toBe(before);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('SearchHelp dismissal', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderApp(<SearchHelp open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a click outside, but not on the click that opened it', async () => {
    const onClose = vi.fn();
    renderApp(<SearchHelp open onClose={onClose} />);
    // The outside listener is deferred by a tick for exactly this reason.
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('listens for nothing while closed', () => {
    const onClose = vi.fn();
    renderApp(<SearchHelp open={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('MovePicker dismissal', () => {
  const moves = SPECIES_BY_ID.get('azumarill')!.chargeMoves;
  it('closes on a click outside the panel', async () => {
    const { container } = renderApp(
      <MovePicker count={moves.length} moves={moves} isActive={() => false} onPick={() => {}} />);
    const btn = container.querySelector('.move-picker-btn')!;
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));
  });
});

describe('SpeciesSearch list behaviour', () => {
  /** Open the dropdown on a query wide enough to need windowing. */
  const openWide = async (id: string) => {
    const r = renderApp(<SpeciesSearch id={id} value="azumarill" onChange={() => {}} />);
    const input = r.container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'water' } });
    // Debounced: the wide result set arrives a tick after the keystroke.
    await waitFor(() => expect(r.container.querySelectorAll('.search-row').length).toBeGreaterThan(1));
    return r.container;
  };

  it('tracks scroll position, since only the visible rows are rendered', async () => {
    const container = await openWide('sc');
    const list = container.querySelector('.search-dropdown div[style]') as HTMLElement;
    expect(list).toBeTruthy();
    const firstBefore = container.querySelector('.search-row')!.textContent;
    fireEvent.scroll(list, { target: { scrollTop: 600 } });
    // Scrolling re-windows the list rather than moving a fully-rendered one.
    expect(container.querySelector('.search-row')!.textContent).not.toBe(firstBefore);
  });

  it('makes the hovered row the active one', async () => {
    const container = await openWide('sh');
    const rows = container.querySelectorAll('.search-row');
    fireEvent.mouseEnter(rows[1]);
    expect(rows[1].className).toMatch(/is-active/);
  });

  it('closes its syntax help', async () => {
    const { container } = renderApp(<SpeciesSearch id="sy" value="azumarill" onChange={() => {}} />);
    const help = container.querySelector('.search-help-btn')!;
    fireEvent.click(help);
    expect(help.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(help.getAttribute('aria-expanded')).toBe('false'));
  });
});

describe('AppState.bumpIv', () => {
  function Probe() {
    const { state, bumpIv } = useAppState();
    return (
      <div>
        <span data-testid="atk">{state.iv.a}</span>
        <button onClick={() => bumpIv('a', 1)}>up</button>
        <button onClick={() => bumpIv('a', -1)}>down</button>
        <button onClick={() => bumpIv('a', 99)}>way up</button>
        <button onClick={() => bumpIv('a', -99)}>way down</button>
      </div>
    );
  }
  const read = (c: HTMLElement) => Number(c.querySelector('[data-testid="atk"]')!.textContent);

  it('steps an IV and clamps it to 0..15', () => {
    const { container, getByText } = renderApp(<Probe />);
    const start = read(container);
    fireEvent.click(getByText('up'));
    expect(read(container)).toBe(start + 1);
    fireEvent.click(getByText('down'));
    expect(read(container)).toBe(start);
    fireEvent.click(getByText('way up'));
    expect(read(container)).toBe(15);
    fireEvent.click(getByText('way down'));
    expect(read(container)).toBe(0);
  });
});
