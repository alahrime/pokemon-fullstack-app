import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NewsScreen, splitEvents, type NewsEvent } from '../NewsScreen';
import news from '../../data/news.json';

const ev = (id: string, start: string, end: string): NewsEvent => ({ id, name: id, kind: 'Event', link: '#', image: '', start, end });

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

describe('NewsScreen', () => {
  it('links every announcement out to pokemongo.com', () => {
    const { container } = render(<NewsScreen />);
    const links = [...container.querySelectorAll('a.news-card')].map((a) => a.getAttribute('href'));
    for (const a of news.announcements) expect(links).toContain(a.link);
  });
});
