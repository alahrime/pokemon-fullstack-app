import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SectionRail } from '../SectionRail';
import { SECTIONS } from '../../lib/screens';

const play = SECTIONS.find((s) => s.id === 'play')!;
const analyze = SECTIONS.find((s) => s.id === 'analyze')!;

describe('SectionRail', () => {
  it('lists the section\'s screens and lights the current one', () => {
    const { container } = render(<SectionRail section={analyze} screen="rankings" badges={{}} onGo={() => {}} />);
    const tabs = [...container.querySelectorAll('.nav-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Report/), expect.stringMatching(/Rankings/)]),
    );
    expect(tabs).toHaveLength(5);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toMatch(/Rankings/);
  });
  it('gives every item its own hue', () => {
    const { container } = render(<SectionRail section={analyze} screen="report" badges={{}} onGo={() => {}} />);
    const hues = [...container.querySelectorAll('.nav-tab')].map((t) => (t as HTMLElement).style.getPropertyValue('--tab-hue'));
    expect(new Set(hues).size).toBe(hues.length);
  });
  it('gives every section\'s rail distinct hues', () => {
    for (const s of SECTIONS) {
      const { container, unmount } = render(<SectionRail section={s} screen={s.screens[0]} badges={{}} onGo={() => {}} />);
      const hues = [...container.querySelectorAll('.nav-tab')].map((t) => (t as HTMLElement).style.getPropertyValue('--tab-hue'));
      expect(new Set(hues).size, s.id).toBe(hues.length);
      unmount();
    }
  });
  it('keeps Matches lit while a match is open, and never lists Match', () => {
    const { container } = render(<SectionRail section={play} screen="match" badges={{}} onGo={() => {}} />);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toMatch(/Matches/);
    expect([...container.querySelectorAll('.nav-tab')].some((t) => /^\W*Match\b\s*$/.test(t.textContent ?? ''))).toBe(false);
  });
  it('shows a badge only where something is waiting, with an accessible name', () => {
    const { container } = render(<SectionRail section={play} screen="friends" badges={{ friends: 2 }} onGo={() => {}} />);
    const badges = container.querySelectorAll('.nav-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute('aria-label')).toBe('2 waiting');
  });
  it('reports the chosen screen', () => {
    const onGo = vi.fn();
    const { container } = render(<SectionRail section={play} screen="friends" badges={{}} onGo={onGo} />);
    fireEvent.click([...container.querySelectorAll('.nav-tab')].find((t) => /Matches/.test(t.textContent ?? ''))!);
    expect(onGo).toHaveBeenCalledWith('matchmaking');
  });
});
