import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { SpriteAudit } from '../SpriteAudit';
import { SPECIES, spriteFallbackUrl } from '../../lib/data';

/**
 * The sprite contact sheet, which `vitest.config.ts` used to exclude.
 *
 * It sat beside `Heatmap3D` in that list, and the README said out loud that the
 * two were not alike: the 3D view is a WebGL canvas jsdom cannot mount, while
 * this is an ordinary React screen behind the `?audit=sprites` flag with
 * nothing about it that resists a test. The thing it exists to report — which
 * slugs fall through to the dex image — is exactly a load event, and jsdom
 * fires those on command.
 */

const imgs = (c: HTMLElement) => [...c.querySelectorAll('.sa-img')] as HTMLImageElement[];

describe('SpriteAudit', () => {
  it('renders a cell per species and counts the roster', () => {
    const { container } = renderApp(<SpriteAudit />);
    expect(container.querySelectorAll('.sa-cell')).toHaveLength(SPECIES.length);
    expect(container.textContent).toContain(String(SPECIES.length));
  });

  it('filters by name and by id', () => {
    const { container } = renderApp(<SpriteAudit />);
    const input = container.querySelector('.sa-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'azumarill' } });
    const shown = container.querySelectorAll('.sa-cell');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(SPECIES.length);
    for (const cell of shown) expect(cell.textContent?.toLowerCase()).toContain('azumarill');

    // Ids are the other axis, and they are not always the display name.
    fireEvent.change(input, { target: { value: SPECIES[0].id } });
    expect(container.querySelectorAll('.sa-cell').length).toBeGreaterThan(0);
  });

  it('restores the full sheet when the filter is cleared', () => {
    const { container } = renderApp(<SpriteAudit />);
    const input = container.querySelector('.sa-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'azumarill' } });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(container.querySelectorAll('.sa-cell')).toHaveLength(SPECIES.length);
  });

  it('counts the slugs that load', () => {
    const { container } = renderApp(<SpriteAudit />);
    fireEvent.load(imgs(container)[0]);
    fireEvent.load(imgs(container)[1]);
    expect(container.textContent).toContain('2 primary slugs loaded');
  });

  it('falls back to the dex image and says which species missed', () => {
    const { container } = renderApp(<SpriteAudit />);
    const img = imgs(container)[0];
    fireEvent.error(img);
    expect(img.src).toContain(spriteFallbackUrl(SPECIES[0].dex));
    expect(img.dataset.fell).toBe('1');
    // The whole point of the screen: a miss is visible rather than a silently
    // degraded image.
    expect(container.querySelector('.sa-log')?.textContent).toContain(SPECIES[0].id);
    expect(container.textContent).toContain('1 fell back to the dex image');
  });

  it('reports each miss once, however many times the element errors', () => {
    const { container } = renderApp(<SpriteAudit />);
    const img = imgs(container)[0];
    fireEvent.error(img);
    const src = img.src;
    fireEvent.error(img);
    // Neither the log nor the src may change on the second failure — the
    // fallback must not be re-pointed at itself.
    expect(img.src).toBe(src);
    expect(container.textContent).toContain('1 fell back to the dex image');
  });

  it('copies the failing ids, which is what the button is for', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = renderApp(<SpriteAudit />);
    // No misses, no button.
    expect(screen.queryByRole('button', { name: /misses/i })).toBeNull();
    fireEvent.error(imgs(container)[0]);
    fireEvent.error(imgs(container)[1]);
    fireEvent.click(screen.getByRole('button', { name: /Copy 2 misses/i }));
    expect(writeText).toHaveBeenCalledWith(`${SPECIES[0].id}\n${SPECIES[1].id}`);
  });

  it('survives a browser with no clipboard rather than throwing on click', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { container } = renderApp(<SpriteAudit />);
    fireEvent.error(imgs(container)[0]);
    expect(() => fireEvent.click(screen.getByRole('button', { name: /Copy 1 miss/i }))).not.toThrow();
  });
});
