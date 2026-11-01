import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NewsScreen, STORIES, span, splitEvents, status, type Story } from '../NewsScreen';
import { AppStateProvider } from '../../state/AppState';
import { hashForView, newsIdFromHash, screenFromHash } from '../../lib/route';
import { speciesOf } from '../../lib/data';

const ev = (id: string, start: string, end: string) => ({ id, start, end });

describe('splitEvents', () => {
  it('puts started events in current, future ones in upcoming, and drops ended ones', () => {
    const now = new Date('2026-11-01T12:00:00Z').getTime();
    const { current, upcoming } = splitEvents(
      [ev('over', '2026-10-30T00:00:00Z', '2026-11-01T11:00:00Z'), ev('on', '2026-11-01T10:00:00Z', '2026-11-02T00:00:00Z'), ev('next', '2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z')],
      now,
    );
    expect(current.map((e) => e.id)).toEqual(['on']);
    expect(upcoming.map((e) => e.id)).toEqual(['next']);
  });
});

describe('status and span', () => {
  const s = { start: '2026-11-21T14:00:00', end: '2026-11-21T17:00:00' } as Story;
  it('counts down, goes live, then ends', () => {
    expect(status(s, new Date('2026-11-18T14:00:00').getTime())).toBe('Starts in 3 days');
    expect(status(s, new Date('2026-11-21T15:00:00').getTime())).toBe('Live now');
    expect(status(s, new Date('2026-11-21T17:00:00').getTime())).toBe('Ended');
  });
  it('writes a one-day event as one date and two times', () => {
    expect(span(s.start!, s.end!).split('·')).toHaveLength(2);
  });
});

describe('news routes', () => {
  it('round-trips a story id through the address', () => {
    const h = hashForView('news', null, null, 'november-communityday2026');
    expect(h).toBe('#/news/news/november-communityday2026');
    expect(screenFromHash(h)).toBe('news');
    expect(newsIdFromHash(h)).toBe('november-communityday2026');
    expect(hashForView('news', null, null, null)).toBe('#/news/news');
  });
});

describe('NewsScreen', () => {
  it('opens a story as a Paragon page with Paragon sprites, and goes back', () => {
    const story = STORIES.find((s) => s.groups.some((g) => g.refs.some((r) => speciesOf(r))))!;
    render(<AppStateProvider><NewsScreen /></AppStateProvider>);
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(story.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })[0]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(story.title);
    const first = story.groups.flatMap((g) => g.refs).find((r) => speciesOf(r))!;
    expect(screen.getAllByTitle(new RegExp(`^Open ${speciesOf(first)!.name}`)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '← All news' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/News/);
  });
});
