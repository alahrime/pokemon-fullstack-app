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
