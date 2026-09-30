import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Standings } from '../Standings';
import type { Entrant, Pairing } from '../../../lib/tournaments';

afterEach(cleanup);
const NOW = new Date('2026-09-29T12:00:00Z');
const names = new Map([['a', 'Alice'], ['b', 'Bob'], ['c', 'Cara'], ['d', 'Dan'], ['e', 'Eve']]);
const ent = (playerId: string, dropped = false): Entrant => ({ playerId, seed: 1, dropped, registeredAt: 'x' });
const P = (round: number, tableNo: number, playerA: string, playerB: string, scoreA: number, scoreB: number, o: Partial<Pairing> = {}): Pairing => ({
  id: `${round}-${tableNo}`, round, tableNo, playerA, playerB, scoreA, scoreB, state: 'settled',
  reportedBy: null, reportedAt: null, finalAt: null, note: null, ...o,
});
// Hand-worked: A 2-0 (OMW 50, GWP 100); B 1-1 (OMW 67, GWP 50); C 1-1 (OMW 67, GWP 40); D 0-2 (OMW 50, GWP floor 33).
const games = [
  P(1, 1, 'a', 'b', 2, 0), P(1, 2, 'c', 'd', 2, 1), P(2, 1, 'a', 'c', 2, 0), P(2, 2, 'b', 'd', 2, 0),
  // not counted yet: must not move anyone
  P(3, 1, 'd', 'a', 2, 0, { state: 'reported', finalAt: '2026-09-29T13:00:00Z' }),
  P(3, 2, 'b', 'c', 0, 0, { state: 'pending', scoreA: null, scoreB: null }),
];
const rowsText = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));

describe('Standings', () => {
  it('ranks with record, OMW and GWP, dropped last, counted games only', () => {
    render(<Standings entrants={[ent('a'), ent('b'), ent('c'), ent('d'), ent('e', true)]} names={names} pairings={games} now={NOW} />);
    expect(rowsText()).toEqual([
      ['1', 'Alice', '2–0', '50.0%', '100.0%'],
      ['2', 'Bob', '1–1', '66.7%', '50.0%'],
      ['3', 'Cara', '1–1', '66.7%', '40.0%'],
      ['4', 'Dan', '0–2', '50.0%', '33.3%'],
      ['5', 'Eve dropped', '0–0', '33.3%', '33.3%'],
    ]);
  });
  it('a dropped player who has games ranks after the active ones', () => {
    render(<Standings entrants={[ent('a', true), ent('b'), ent('c'), ent('d')]} names={names} pairings={games} now={NOW} />);
    expect(rowsText().map((r) => r[1])).toEqual(['Bob', 'Cara', 'Dan', 'Alice dropped']);
  });
  it('never shows a raw id for a missing name', () => {
    render(<Standings entrants={[ent('uuid-1234')]} names={new Map()} pairings={[]} now={NOW} />);
    expect(screen.queryByText(/uuid-1234/)).toBeNull();
    expect(screen.getByText('Unknown player')).toBeTruthy();
  });
});
