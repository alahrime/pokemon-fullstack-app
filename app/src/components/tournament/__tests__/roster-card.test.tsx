import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RosterCard, PlayerRoster } from '../RosterCard';
import { movesFor, SPECIES_BY_ID } from '../../../lib/data';
import type { RosterMember } from '../../../tournament/roster';

afterEach(cleanup);
const s = SPECIES_BY_ID.get('azumarill')!;
const mv = movesFor(s, 'great');
const member = (over: Partial<RosterMember> = {}): RosterMember => ({
  ref: 'azumarill', fast: mv.fast.id, charges: mv.charges.map((c) => c.id), cp: 1487, bestBuddy: false, ...over,
});

describe('RosterCard', () => {
  it('shows the name, the fast move, every charged move and the CP', () => {
    render(<RosterCard member={member()} />);
    expect(screen.getByText('Azumarill')).toBeTruthy();
    expect(screen.getByText(mv.fast.name)).toBeTruthy();
    for (const c of mv.charges) expect(screen.getByText(c.name)).toBeTruthy();
    expect(screen.getByText('CP 1487')).toBeTruthy();
  });
  it('marks a shadow ref in words, and only then', () => {
    render(<RosterCard member={member({ ref: 'azumarill_shadow' })} />);
    expect(screen.getByText('Azumarill (Shadow)')).toBeTruthy();
    expect(screen.getByText('Shadow')).toBeTruthy();
  });
  it('shows the badges only when true', () => {
    const { rerender } = render(<RosterCard member={member()} />);
    expect(screen.queryByText('Shadow')).toBeNull();
    expect(screen.queryByText('Best Buddy')).toBeNull();
    rerender(<RosterCard member={member({ bestBuddy: true })} />);
    expect(screen.getByText('Best Buddy')).toBeTruthy();
  });
  it('hidden shows no species, moves or CP', () => {
    render(<RosterCard member={member({ bestBuddy: true })} hidden />);
    expect(screen.getByText('Hidden')).toBeTruthy();
    for (const t of ['Azumarill', mv.fast.name, 'CP 1487', 'Best Buddy']) expect(screen.queryByText(t)).toBeNull();
  });
  it('offers Remove only when given a handler', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<RosterCard member={member()} />);
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    rerender(<RosterCard member={member()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Azumarill' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('PlayerRoster', () => {
  it('names the player, the record and the six cards', () => {
    const six = Array.from({ length: 6 }, () => member());
    render(<PlayerRoster name="Ash" record="2-1" roster={six} />);
    expect(screen.getByRole('heading', { name: /Ash/ })).toBeTruthy();
    expect(screen.getByText('2-1')).toBeTruthy();
    expect(screen.getAllByText('Azumarill')).toHaveLength(6);
  });
});
