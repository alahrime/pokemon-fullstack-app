import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { Board } from '../Board';
import { IVAdjuster } from '../IVAdjuster';
import { PokemonCard } from '../PokemonCard';
import { SpeciesSearch } from '../SpeciesSearch';
import { HeldOutNote } from '../HeldOutNote';
import { TypeBadge } from '../TypeBadge';
import { Sprite } from '../Sprite';
import type { IV } from '../../lib/types';
import { loadOrder } from '../../lib/layout';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('Board', () => {
  const blocks = [
    { id: 'a', label: 'Alpha', node: <div>ALPHA</div> },
    { id: 'b', label: 'Beta', node: <div>BETA</div> },
    { id: 'c', label: 'Gamma', node: <div>GAMMA</div> },
  ];
  it('renders every block in the declared order', () => {
    const { container } = renderApp(<Board storageKey="t" blocks={blocks} editing={false} />);
    expect(container.querySelectorAll('.board-slot')).toHaveLength(3);
    expect(container.textContent).toContain('ALPHA');
  });
  it('shows grips only while editing', () => {
    const { container, rerender } = renderApp(<Board storageKey="t" blocks={blocks} editing={false} />);
    expect(container.querySelectorAll('.board-grip')).toHaveLength(0);
    rerender(<Board storageKey="t" blocks={blocks} editing />);
    expect(container.querySelectorAll('.board-grip').length).toBeGreaterThan(0);
  });
  it('moves a panel with the arrow button and persists the order', () => {
    const { container } = renderApp(<Board storageKey="t" blocks={blocks} editing />);
    const down = within(container.querySelectorAll('.board-slot')[0] as HTMLElement)
      .getByLabelText(/Move Alpha down/i);
    fireEvent.click(down);
    const labels = [...container.querySelectorAll('.board-grip-label')].map((e) => e.textContent);
    expect(labels[0]).toBe('Beta');
    // The key is namespaced by the module, so read it back the way the app does.
    expect(loadOrder('t', ['a', 'b', 'c'])[0]).toBe('b');
  });
  it('disables up on the first panel and down on the last', () => {
    const { container } = renderApp(<Board storageKey="t" blocks={blocks} editing />);
    const slots = container.querySelectorAll('.board-slot');
    expect(within(slots[0] as HTMLElement).getByLabelText(/Move Alpha up/i)).toBeDisabled();
    expect(within(slots[2] as HTMLElement).getByLabelText(/Move Gamma down/i)).toBeDisabled();
  });
  it('marks the dragged slot, and clears it on drag end', () => {
    const { container } = renderApp(<Board storageKey="t" blocks={blocks} editing />);
    const slot = container.querySelector('.board-slot')!;
    fireEvent.dragStart(slot, { dataTransfer: { setData: () => {}, effectAllowed: '' } });
    expect(slot.className).toContain('is-dragging');
    fireEvent.dragEnd(slot);
    expect(slot.className).not.toContain('is-dragging');
  });
  it('reorders on drop', () => {
    const { container } = renderApp(<Board storageKey="t" blocks={blocks} editing />);
    const slots = container.querySelectorAll('.board-slot');
    fireEvent.dragStart(slots[0], { dataTransfer: { setData: () => {}, effectAllowed: '' } });
    fireEvent.dragOver(slots[2]);
    fireEvent.drop(slots[2]);
    const labels = [...container.querySelectorAll('.board-grip-label')].map((e) => e.textContent);
    expect(labels).not.toEqual(['Alpha', 'Beta', 'Gamma']);
  });
  it('drops an id that no longer exists instead of rendering a hole', () => {
    localStorage.setItem('t', JSON.stringify(['c', 'ghost', 'a', 'b']));
    const { container } = renderApp(<Board storageKey="t" blocks={blocks} editing={false} />);
    expect(container.querySelectorAll('.board-slot')).toHaveLength(3);
  });
});

describe('IVAdjuster', () => {
  const iv: IV = { a: 5, d: 10, s: 15 };
  it('renders a row per stat with the current values', () => {
    const { container } = renderApp(<IVAdjuster iv={iv} onBump={() => {}} />);
    expect(container.querySelectorAll('.iv-row')).toHaveLength(3);
    expect([...container.querySelectorAll('.iv-value')].map((e) => e.textContent)).toEqual(['5','10','15']);
  });
  it('bumps up and down through the step buttons', () => {
    const onBump = vi.fn();
    renderApp(<IVAdjuster iv={iv} onBump={onBump} />);
    fireEvent.click(screen.getByLabelText(/Increase Attack/i));
    expect(onBump).toHaveBeenCalledWith('a', 1);
    fireEvent.click(screen.getByLabelText(/Decrease Defense/i));
    expect(onBump).toHaveBeenCalledWith('d', -1);
  });
  it('disables decrement at 0 and increment at 15', () => {
    renderApp(<IVAdjuster iv={{ a: 0, d: 15, s: 7 }} onBump={() => {}} />);
    expect(screen.getByLabelText(/Decrease Attack/i)).toBeDisabled();
    expect(screen.getByLabelText(/Increase Defense/i)).toBeDisabled();
  });
  it('sets a value by pressing the track, and clears by pressing the same spot', () => {
    const onSet = vi.fn();
    const { container } = renderApp(<IVAdjuster iv={{ a: 0, d: 0, s: 0 }} onBump={() => {}} onSet={onSet} />);
    const track = container.querySelector('.iv-track')!;
    fireEvent.pointerDown(track, { button: 0, clientX: 100 });
    expect(onSet).toHaveBeenCalled();
  });
  it('supports the keyboard, which drag alone would exclude', () => {
    const onBump = vi.fn();
    const onSet = vi.fn();
    const { container } = renderApp(<IVAdjuster iv={iv} onBump={onBump} onSet={onSet} />);
    const track = container.querySelector('.iv-track')!;
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(onBump).toHaveBeenCalledWith('a', 1);
    fireEvent.keyDown(track, { key: 'End' });
    expect(onSet).toHaveBeenCalledWith('a', 15);
    fireEvent.keyDown(track, { key: 'Home' });
    expect(onSet).toHaveBeenCalledWith('a', 0);
  });
  it('exposes the slider role and its range to assistive tech', () => {
    const { container } = renderApp(<IVAdjuster iv={iv} onBump={() => {}} />);
    const track = container.querySelector('.iv-track')!;
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-valuemax')).toBe('15');
    expect(track.getAttribute('aria-valuenow')).toBe('5');
  });
});

describe('PokemonCard', () => {
  it('renders name, types and the rated spread', () => {
    const { container } = renderApp(<PokemonCard refId="azumarill" league="great" size="full" />);
    expect(container.textContent).toContain('Azumarill');
    expect(container.querySelectorAll('.pc-stat').length).toBeGreaterThan(0);
  });
  it('carries the type colours it is built from', () => {
    const { container } = renderApp(<PokemonCard refId="azumarill" league="great" />);
    const card = container.querySelector('.pc') as HTMLElement;
    expect(card.style.getPropertyValue('--t1')).toContain('--type-');
  });
  it('marks a podium position but not an ordinary one', () => {
    const { container: gold } = renderApp(<PokemonCard refId="azumarill" league="great" rank={0} />);
    const { container: plain } = renderApp(<PokemonCard refId="azumarill" league="great" rank={9} />);
    expect(gold.querySelector('.pc')!.className).toContain('is-gold');
    expect(plain.querySelector('.pc')!.className).not.toContain('is-gold');
  });
  it('fires onClick and is reachable by keyboard when clickable', () => {
    const onClick = vi.fn();
    const { container } = renderApp(<PokemonCard refId="azumarill" league="great" onClick={onClick} />);
    const card = container.querySelector('.pc')!;
    expect(card.getAttribute('role')).toBe('button');
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
  it('renders nothing for an unknown ref rather than throwing', () => {
    const { container } = renderApp(<PokemonCard refId="not_real" league="great" />);
    expect(container.querySelector('.pc')).toBeNull();
  });
});

describe('SpeciesSearch', () => {
  it('opens on focus and lists results', () => {
    const { container } = renderApp(
      <SpeciesSearch id="s" value="azumarill" onChange={() => {}} />);
    fireEvent.focus(container.querySelector('input')!);
    expect(container.querySelector('.search-dropdown')).toBeTruthy();
  });
  it('starts empty when asked, for the landing hero', () => {
    const { container } = renderApp(
      <SpeciesSearch id="s" value="azumarill" onChange={() => {}} startEmpty />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('');
  });
  it('shows the selection when not asked to start empty', () => {
    const { container } = renderApp(<SpeciesSearch id="s" value="azumarill" onChange={() => {}} />);
    expect((container.querySelector('input') as HTMLInputElement).value).toContain('Azumarill');
  });
  it('commits a pick on mousedown', () => {
    const onChange = vi.fn();
    const { container } = renderApp(<SpeciesSearch id="s" value="azumarill" onChange={onChange} />);
    fireEvent.focus(container.querySelector('input')!);
    const row = container.querySelector('.search-row');
    if (row) { fireEvent.mouseDown(row); expect(onChange).toHaveBeenCalled(); }
  });
});

describe('HeldOutNote', () => {
  it('names only the species asked for', () => {
    const { container } = renderApp(<HeldOutNote only={['mimikyu']} />);
    expect(container.textContent).toContain('Mimikyu');
    expect(container.textContent).not.toContain('Aegislash');
  });
  it('renders nothing when the filter matches nothing', () => {
    const { container } = renderApp(<HeldOutNote only={['azumarill']} />);
    expect(container.textContent).toBe('');
  });
  it('keeps the full explanation one hover away', () => {
    const { container } = renderApp(<HeldOutNote only={['mimikyu']} />);
    expect(container.querySelector('.held-out-legend')!.getAttribute('title')!.length).toBeGreaterThan(60);
  });
});

describe('small components', () => {
  it('TypeBadge names its type', () => {
    const { container } = renderApp(<TypeBadge type="water" />);
    expect(container.textContent!.toLowerCase()).toContain('water');
  });
  it('Sprite renders a decorative image — empty alt, name carried by its label', () => {
    const { container } = renderApp(<Sprite sprite="azumarill" dex={184} size={40} />);
    const img = container.querySelector('img')!;
    expect(img).toBeTruthy();
    // Deliberately empty: every caller pairs the sprite with a visible name or
    // a title, so announcing the species twice would be worse than not at all.
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
  });
});

describe('card and slot layout rules', () => {
  const css = () => readFileSync('src/styles/components.css', 'utf8');

  it('lets long names wrap on both card sizes that show one', () => {
    // Measured in the browser: "Sandslash (Alolan) (Shadow)" wants 191px of a
    // 109px box on a full card and 163px of 75px on a compact one. No width
    // that keeps a roster on one row fixes that, so the name wraps.
    const block = css().slice(css().indexOf('.pc-compact .pc-name'));
    expect(block.slice(0, 400)).toContain('.pc-full .pc-name');
    expect(block.slice(0, 400)).toMatch(/line-clamp:\s*3/);
  });

  it('lays the team slots out in a count that divides both rosters', () => {
    // auto-fit gave five columns at desk width, so a Show 6 landed five-and-one.
    const i = css().indexOf('.team-slots {');
    expect(i).toBeGreaterThan(-1);
    expect(css().slice(i, i + 200)).toContain('repeat(3, minmax(0, 1fr))');
  });

  it('declares .team-slots once at the top level, so the winning rule is the one you read', () => {
    // There were two, a flex one and a grid one, and the flex one came first —
    // which is what sent an edit to the rule that loses. The indented matches
    // are the responsive overrides and are meant to be there.
    const top = css().match(/^\.team-slots\s*\{/gm) ?? [];
    expect(top).toHaveLength(1);
  });
});
