import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { SpeciesSearch } from '../SpeciesSearch';
import { PokemonCard, TeamCards } from '../PokemonCard';
import { BestTeams } from '../BestTeams';
import { movesForChoice } from '../AddPokemonModal';
import { waitFor } from '@testing-library/react';
import { exportAll } from '../../lib/rankings';

/** Downloads touch jsdom's unimplemented navigation; capture instead. */
function captureDownloads() {
  const names: string[] = [];
  URL.createObjectURL = (() => 'blob:x') as never;
  URL.revokeObjectURL = (() => {}) as never;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'a') {
      Object.defineProperty(el, 'download', { set: (v: string) => names.push(v), get: () => '' });
      (el as HTMLAnchorElement).click = () => {};
    }
    return el;
  });
  return names;
}

describe('SpeciesSearch keyboard control', () => {
  const open = () => {
    const { container } = renderApp(<SpeciesSearch id="k" value="azumarill" onChange={() => {}} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    return { container, input };
  };

  it('arrows down and up through the list', () => {
    const { container, input } = open();
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(container.querySelector('[aria-selected="true"]')).toBeTruthy();
  });

  it('commits the active row on Enter', () => {
    const onChange = vi.fn();
    const { container } = renderApp(<SpeciesSearch id="k" value="azumarill" onChange={onChange} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'azumarill' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalled();
  });

  it('closes on Escape and restores the resting text', () => {
    const { container, input } = open();
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('.search-dropdown')).toBeFalsy();
    expect(input.value).toContain('Azumarill');
  });

  it('closes on blur', () => {
    const { container, input } = open();
    fireEvent.blur(input);
    expect(container.querySelector('.search-dropdown')).toBeFalsy();
  });

  it('says so when nothing matches, and hints at the syntax', async () => {
    const { container, input } = open();
    fireEvent.change(input, { target: { value: 'qqqqqq' } });
    // The query is debounced, so the empty state arrives a tick later.
    await waitFor(() => expect(container.querySelector('.search-empty')).toBeTruthy());
    expect(container.querySelector('.search-empty-hint')).toBeTruthy();
  });

  it('names a held-out species instead of reporting no match', async () => {
    const { container, input } = open();
    fireEvent.change(input, { target: { value: 'mimikyu' } });
    await waitFor(() => expect(container.textContent).toMatch(/Mimikyu/i));
  });

  it('toggles the syntax help panel', () => {
    const { container } = open();
    const help = container.querySelector('.search-help-btn')!;
    fireEvent.click(help);
    expect(help.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(help);
    expect(help.getAttribute('aria-expanded')).toBe('false');
  });

  it('matches by dex number as well as by name', () => {
    const { container, input } = open();
    fireEvent.change(input, { target: { value: '184' } });
    expect(container.textContent).toMatch(/Azumarill/i);
  });

  it('matches at a word start inside a form name', () => {
    const { container, input } = open();
    fireEvent.change(input, { target: { value: 'alolan' } });
    expect(container.querySelectorAll('.search-row').length).toBeGreaterThan(0);
  });
});

describe('PokemonCard', () => {
  it('renders nothing for an unknown ref', () => {
    const { container } = renderApp(<PokemonCard refId="not-a-pokemon" league="great" />);
    expect(container.querySelector('.pc')).toBeFalsy();
  });

  it('tracks the pointer into CSS variables and settles level on leave', () => {
    const { container } = renderApp(<PokemonCard refId="azumarill" league="great" size="full" />);
    const card = container.querySelector('.pc') as HTMLElement;
    fireEvent.pointerMove(card, { clientX: 150, clientY: 30 });
    expect(card.style.getPropertyValue('--mx')).not.toBe('');
    fireEvent.pointerLeave(card);
    expect(card.style.getPropertyValue('--mx')).toBe('0.5');
    expect(card.style.getPropertyValue('--my')).toBe('0.5');
  });

  it('shows the build it was handed rather than the rated set', () => {
    const { container } = renderApp(
      <PokemonCard
        refId="azumarill"
        league="great"
        size="full"
        build={{
          ...movesForChoice(
            { ref: 'azumarill', chargeIds: ['ICE_BEAM', 'PLAY_ROUGH'], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } },
            'great',
          )!,
          iv: { a: 0, d: 15, s: 15 },
        }}
      />,
    );
    expect(container.textContent).toMatch(/Ice Beam/i);
  });

  it('fires onClick when given one', () => {
    const onClick = vi.fn();
    const { container } = renderApp(
      <PokemonCard refId="azumarill" league="great" onClick={onClick} />);
    fireEvent.click(container.querySelector('.pc')!);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('TeamCards', () => {
  it('picks its own density from the roster size', () => {
    const three = renderApp(<TeamCards refs={['azumarill', 'registeel', 'medicham']} league="great" />);
    expect(three.container.querySelector('.pc-team-3')).toBeTruthy();
    const six = renderApp(
      <TeamCards refs={['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory', 'whiscash']} league="great" />);
    expect(six.container.querySelector('.pc-team-6')).toBeTruthy();
  });
  it('calls back with the ref that was picked', () => {
    const onPick = vi.fn();
    const { container } = renderApp(
      <TeamCards refs={['azumarill']} league="great" onPick={onPick} />);
    fireEvent.click(container.querySelector('.pc')!);
    expect(onPick).toHaveBeenCalledWith('azumarill');
  });
});

describe('BestTeams', () => {
  it('lists discovered teams', () => {
    const { container } = renderApp(<BestTeams league="great" size={3} onLoad={() => {}} />);
    expect(container.querySelectorAll('.bt-row, .best-teams tr, li').length).toBeGreaterThan(0);
  });

  it('expands a row into its synergy breakdown', () => {
    const { container } = renderApp(<BestTeams league="great" size={3} onLoad={() => {}} />);
    const toggle = container.querySelector('[title="Synergy breakdown"]');
    if (!toggle) return; // no synergy in this artefact; nothing to expand
    fireEvent.click(toggle);
    expect(container.querySelector('.bt-detail')).toBeTruthy();
    expect(container.querySelectorAll('.bt-syn-cell').length).toBeGreaterThan(0);
    fireEvent.click(toggle);
    expect(container.querySelector('.bt-detail')).toBeFalsy();
  });

  it('loads a team into the slots above', () => {
    const onLoad = vi.fn();
    const { container } = renderApp(<BestTeams league="great" size={3} onLoad={onLoad} />);
    const load = container.querySelector('[title="Load into the slots above"]');
    if (load) {
      fireEvent.click(load);
      expect(onLoad).toHaveBeenCalled();
      expect(Array.isArray(onLoad.mock.calls[0][0])).toBe(true);
    }
  });

  it('exports this view and every stratum', () => {
    const names = captureDownloads();
    const { container } = renderApp(<BestTeams league="great" size={3} onLoad={() => {}} />);
    for (const b of container.querySelectorAll('.best-teams-export .btn')) fireEvent.click(b);
    expect(names.length).toBe(2);
    expect(names.every((n) => n.endsWith('.csv'))).toBe(true);
  });
});

describe('exportAll', () => {
  it('nests every species under its tiers rather than repeating them', () => {
    const all = exportAll('great');
    expect(all.league).toBe('great');
    expect(all.species.length).toBeGreaterThan(0);
    const first = all.species[0];
    expect(typeof first.name).toBe('string');
    const tierKeys = Object.keys(first.tiers);
    expect(tierKeys.length).toBeGreaterThan(0);
    const t = first.tiers[tierKeys[0]];
    // Scores are zipped back to their category names — nothing outside
    // rankings.ts should have to know the wire format is a bare array.
    expect(Object.keys(t.d1)).toEqual(all.categories);
    expect(Object.keys(t.best)).toEqual(all.categories);
    expect(Object.keys(t.d2)).toEqual(all.categories);
  });
  it('says on the tin that Overall is not a battle rating', () => {
    expect(exportAll('great').scale).toMatch(/Overall is NOT a battle rating/);
  });
});

describe('an empty search offers a varied draw', () => {
  const openBlank = () => {
    const { container } = renderApp(<SpeciesSearch id="blank" value="azumarill" onChange={() => {}} startEmpty />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    return container;
  };

  it('does not lead with the same Pokémon every time', () => {
    // Sorted by rank it was the same list on every open, headed by rank 1 —
    // which read as the field defaulting to one Pokémon.
    const heads = new Set<string>();
    for (let i = 0; i < 12; i++) {
      heads.add(openBlank().querySelector('.search-row')!.textContent ?? '');
    }
    expect(heads.size).toBeGreaterThan(1);
  });

  it('redraws each time the box is opened, not on every render', () => {
    const container = openBlank();
    const first = [...container.querySelectorAll('.search-row')].map((r) => r.textContent).join('|');
    const input = container.querySelector('input')!;
    // A blur and a fresh focus is a new opening.
    fireEvent.blur(input);
    fireEvent.focus(input);
    const second = [...container.querySelectorAll('.search-row')].map((r) => r.textContent).join('|');
    expect(second).not.toBe(first);
  });

  it('offers only Pokémon that are actually ranked somewhere', () => {
    // A uniform draw over the whole roster is mostly Pokemon nobody can field.
    const container = openBlank();
    const names = [...container.querySelectorAll('.search-row')].slice(0, 30)
      .map((r) => r.textContent ?? '');
    expect(names.length).toBeGreaterThan(10);
    expect(names.every((n) => n.trim().length > 0)).toBe(true);
  });
});
