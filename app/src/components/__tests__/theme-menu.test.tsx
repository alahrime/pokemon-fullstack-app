import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ThemeMenu } from '../ThemeMenu';
import { THEMES } from '../../state/ThemeContext';

beforeEach(() => localStorage.clear());

describe('ThemeMenu', () => {
  const open = () => {
    const r = renderApp(<ThemeMenu />);
    fireEvent.click(r.container.querySelector('.theme-menu-btn')!);
    return r;
  };

  it('stays collapsed until asked', () => {
    const { container } = renderApp(<ThemeMenu />);
    expect(container.querySelector('.theme-menu-panel')).toBeFalsy();
    expect(container.querySelector('.theme-menu-btn')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('offers every registered theme', () => {
    const { container } = open();
    const swatches = [...container.querySelectorAll('.theme-swatch')];
    expect(swatches).toHaveLength(THEMES.length);
    expect(swatches.map((s) => s.querySelector('.theme-swatch-name')!.textContent))
      .toEqual(THEMES.map((t) => t.label));
  });

  it('previews each theme in its own palette, not the active one', () => {
    const { container } = open();
    // The attribute belongs on the tile alone. On the button it also recoloured
    // the label, which made every light theme's name unreadable on a dark panel.
    const faces = [...container.querySelectorAll('.theme-swatch-face')];
    expect(faces.map((f) => f.getAttribute('data-theme'))).toEqual(THEMES.map((t) => t.id));
    expect([...container.querySelectorAll('.theme-swatch[data-theme]')]).toHaveLength(0);
  });

  it('applies a theme and closes', () => {
    const { container } = open();
    const pick = [...container.querySelectorAll('.theme-swatch')]
      .find((s) => s.getAttribute('aria-pressed') === 'false')!;
    const id = pick.querySelector('.theme-swatch-face')!.getAttribute('data-theme');
    fireEvent.click(pick);
    expect(container.querySelector('.theme-menu-panel')).toBeFalsy();
    expect(document.documentElement.getAttribute('data-theme')).toBe(id);
  });

  it('marks exactly one theme as current', () => {
    const { container } = open();
    expect(container.querySelectorAll('.theme-swatch[aria-pressed="true"]')).toHaveLength(1);
  });

  it('closes on Escape', () => {
    const { container } = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.theme-menu-panel')).toBeFalsy();
  });

  it('closes on a click outside, but not on the click that opened it', async () => {
    const { container } = open();
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('.theme-menu-panel')).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(container.querySelector('.theme-menu-panel')).toBeFalsy());
  });

  it('carries the motion switch, so both display settings live together', () => {
    const { container } = open();
    const motion = container.querySelector('.theme-menu-motion') as HTMLButtonElement;
    expect(motion).toBeTruthy();
    fireEvent.click(motion);
    expect(document.documentElement.getAttribute('data-motion')).toBe('off');
  });
});

describe('theme palettes', () => {
  it('every theme in the picker has a stylesheet block', async () => {
    // A theme listed but not generated would render with no palette at all.
    const css = await import('node:fs').then((fs) =>
      fs.readFileSync('src/styles/themes.css', 'utf8') +
      fs.readFileSync('src/styles/types-themes.css', 'utf8'));
    for (const t of THEMES) {
      expect(css.includes(`[data-theme='${t.id}']`)).toBe(true);
    }
  });
});

describe('custom theme editor', () => {
  const openEditor = () => {
    const r = renderApp(<ThemeMenu />);
    fireEvent.click(r.container.querySelector('.theme-menu-btn')!);
    fireEvent.click([...r.container.querySelectorAll('button')]
      .find((b) => /Create your own/i.test(b.textContent ?? ''))!);
    return r;
  };

  it('opens from the picker', () => {
    const { container } = openEditor();
    expect(container.querySelector('.theme-custom')).toBeTruthy();
    expect(container.querySelectorAll('.theme-custom-steps > li')).toHaveLength(3);
  });

  it('offers no signal until a ground is chosen', () => {
    const { container } = openEditor();
    const steps = container.querySelectorAll('.theme-custom-steps > li');
    const signals = [...steps[1].querySelectorAll('.theme-chip')] as HTMLButtonElement[];
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((b) => b.disabled)).toBe(true);
  });

  it('a ground opens the signals, and the choice differs by ground', () => {
    const { container } = openEditor();
    const steps = container.querySelectorAll('.theme-custom-steps > li');
    const grounds = [...steps[0].querySelectorAll('.theme-chip')] as HTMLButtonElement[];
    const enabled = () =>
      [...steps[1].querySelectorAll('.theme-chip')].filter((b) => !(b as HTMLButtonElement).disabled).length;

    fireEvent.click(grounds[0]);            // a dark ground
    const onDark = enabled();
    fireEvent.click(grounds[grounds.length - 1]); // a light one
    const onLight = enabled();
    expect(onDark).toBeGreaterThan(0);
    expect(onLight).toBeGreaterThan(0);
    // The point of the restriction: the ground decides what is available.
    expect(onDark).not.toBe(onLight);
  });

  it('narrows the second signal against the first', () => {
    const { container } = openEditor();
    const steps = container.querySelectorAll('.theme-custom-steps > li');
    fireEvent.click(steps[0].querySelectorAll('.theme-chip')[1]);
    const free = [...steps[2].querySelectorAll('.theme-chip')].filter((b) => !(b as HTMLButtonElement).disabled).length;
    const firstSignal = [...steps[1].querySelectorAll('.theme-chip')]
      .find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(firstSignal);
    const after = [...steps[2].querySelectorAll('.theme-chip')].filter((b) => !(b as HTMLButtonElement).disabled).length;
    // At minimum the chosen colour itself is now unavailable as the second.
    expect(after).toBeLessThan(free);
  });

  it('will not apply until all three are chosen', () => {
    const { container } = openEditor();
    const apply = () => container.querySelector('.theme-custom-actions button') as HTMLButtonElement;
    expect(apply().disabled).toBe(true);
    const steps = container.querySelectorAll('.theme-custom-steps > li');
    fireEvent.click(steps[0].querySelectorAll('.theme-chip')[1]);
    fireEvent.click([...steps[1].querySelectorAll('.theme-chip')].find((b) => !(b as HTMLButtonElement).disabled)!);
    expect(apply().disabled).toBe(true);
    fireEvent.click([...steps[2].querySelectorAll('.theme-chip')].find((b) => !(b as HTMLButtonElement).disabled)!);
    expect(apply().disabled).toBe(false);
  });

  it('applies the palette, and every reported check passes', () => {
    const { container } = openEditor();
    const steps = container.querySelectorAll('.theme-custom-steps > li');
    fireEvent.click(steps[0].querySelectorAll('.theme-chip')[1]);
    fireEvent.click([...steps[1].querySelectorAll('.theme-chip')].find((b) => !(b as HTMLButtonElement).disabled)!);
    fireEvent.click([...steps[2].querySelectorAll('.theme-chip')].find((b) => !(b as HTMLButtonElement).disabled)!);

    // The readout is the same check the build-time generator runs.
    const checks = [...container.querySelectorAll('.theme-custom-checks li')];
    expect(checks.length).toBe(7);
    expect(checks.every((c) => c.className.includes('is-ok'))).toBe(true);

    fireEvent.click(container.querySelector('.theme-custom-actions button')!);
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
    // Its tokens are written at runtime, since it has no stylesheet block.
    const style = document.getElementById('paragon-custom-theme');
    expect(style?.textContent).toContain("data-theme='custom'");
    expect(style?.textContent).toContain('--color-accent');
  });

  it('keeps the built theme out of the baked list, which has no palette for it', () => {
    // THEMES drives the guard that every listed theme has a stylesheet block.
    expect(THEMES.some((t) => t.id === 'custom')).toBe(false);
  });
});
