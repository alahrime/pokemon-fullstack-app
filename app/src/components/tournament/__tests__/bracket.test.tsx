import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Bracket } from '../Bracket';
import type { Pairing } from '../../../lib/tournaments';

afterEach(cleanup);
const NOW = new Date('2026-09-29T12:00:00Z');
const names = new Map([['a', 'Alice'], ['b', 'Bob'], ['c', 'Cara'], ['d', 'Dan']]);
const P = (o: Partial<Pairing>): Pairing => ({
  id: `${o.round}-${o.tableNo}`, round: 1, tableNo: 1, playerA: 'a', playerB: 'b', scoreA: null, scoreB: null,
  state: 'pending', reportedBy: null, reportedAt: null, finalAt: null, note: null, ...o,
});
const show = (pairings: Pairing[], over = {}) => render(
  <Bracket pairings={pairings} names={names} players={26} rounds={5} currentRound={3} me="c" now={NOW} {...over} />,
);
const settled = [
  P({ round: 1, tableNo: 1, scoreA: 2, scoreB: 0, state: 'settled' }),
  P({ round: 1, tableNo: 2, playerA: 'c', playerB: 'd', scoreA: 1, scoreB: 2, state: 'settled' }),
  P({ round: 2, tableNo: 1, playerA: 'a', playerB: 'c', scoreA: 2, scoreB: 1, state: 'settled' }),
  P({ round: 2, tableNo: 2, playerA: 'b', playerB: null, scoreA: 2, scoreB: 0, state: 'settled' }),
];

describe('Bracket', () => {
  it('shows the header and one column per played round', () => {
    show(settled);
    expect(screen.getByText('3 / 5 Rounds')).toBeTruthy();
    expect(screen.getByText('26 Players')).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(screen.getByText('Round 2')).toBeTruthy();
    expect(screen.getAllByText('Table 2')).toHaveLength(2);
  });
  it('marks winner and loser by mark and label, striking the loser', () => {
    show(settled);
    const t = screen.getByLabelText('Alice won 2–0 against Bob');
    expect(t.textContent).toContain('✓');
    expect(t.textContent).toContain('✗');
    expect(within(t).getByText('Bob').className).toContain('is-loser');
    expect(within(t).getByText('Alice').className).not.toContain('is-loser');
    // scores are oriented: Dan (player_b) won 2-1
    expect(screen.getByLabelText('Dan won 2–1 against Cara')).toBeTruthy();
  });
  it('marks the viewer’s tables and reads a bye', () => {
    show(settled);
    expect(screen.getAllByText('You')).toHaveLength(2);
    expect(screen.getByText('Bye')).toBeTruthy();
    expect(screen.getByLabelText('Bob has a bye')).toBeTruthy();
  });
  it('a pending table is neutral', () => {
    show([P({})]);
    const t = screen.getByLabelText('Alice versus Bob, not played');
    expect(t.textContent).not.toMatch(/[✓✗]/);
  });
  it('reported shows the score tagged until finalAt passes, then decides', () => {
    const p = P({ scoreA: 2, scoreB: 1, state: 'reported', finalAt: '2026-09-29T12:30:00Z' });
    const { rerender } = show([p]);
    expect(screen.getByText('reported')).toBeTruthy();
    expect(screen.getByLabelText('Alice versus Bob, reported').textContent).not.toMatch(/[✓✗]/);
    rerender(<Bracket pairings={[p]} names={names} players={26} rounds={5} currentRound={3} me="c" now={new Date('2026-09-29T12:31:00Z')} />);
    expect(screen.queryByText('reported')).toBeNull();
    expect(screen.getByLabelText('Alice won 2–1 against Bob')).toBeTruthy();
  });
  it('tags disputed', () => {
    show([P({ scoreA: 2, scoreB: 0, state: 'disputed' })]);
    expect(screen.getByText('disputed')).toBeTruthy();
  });
  it('filters by name case-insensitively, highlights, and clears', () => {
    const { container } = show(settled);
    fireEvent.change(screen.getByLabelText('Search players'), { target: { value: 'dAn' } });
    expect(screen.queryByLabelText('Alice won 2–0 against Bob')).toBeNull();
    expect(screen.getByLabelText('Dan won 2–1 against Cara')).toBeTruthy();
    expect(container.querySelector('mark')?.textContent).toBe('Dan');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Alice won 2–0 against Bob')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
  it('says so when nothing has been paired', () => {
    show([]);
    expect(screen.getByText('No pairings yet')).toBeTruthy();
  });
});
