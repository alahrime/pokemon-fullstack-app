import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MatchupMatrix, Bars } from '../MatchupMatrix';

const TEAM = ['azumarill', 'registeel', 'altaria'];
const show = (props: Partial<React.ComponentProps<typeof MatchupMatrix>> = {}) =>
  render(<MatchupMatrix team={TEAM} league="great" onAdd={vi.fn()} full={false} {...props} />);

describe('MatchupMatrix', () => {
  it('asks for a Pokémon before it has anything to show', () => {
    show({ team: [] });
    expect(screen.getByText(/Add a Pokémon and its matchups/)).toBeTruthy();
  });

  it('draws opponents down the side and your members across the top, each with its sprite', async () => {
    const { container } = show();
    const table = container.querySelector('.mx-table:not(.mx-alts)')!;
    await waitFor(() => expect(table.querySelectorAll('tbody tr')).toHaveLength(20));
    const heads = [...table.querySelectorAll('thead th')].map((t) => t.textContent?.trim());
    expect(heads).toEqual(expect.arrayContaining(['Azumarill', 'Registeel', 'Altaria']));
    expect(table.querySelectorAll('thead img').length).toBe(TEAM.length);
    expect(table.querySelectorAll('tbody tr:first-child th img').length).toBe(1);
  });

  it('fights every cell at 0, 1 and 2 shields, and says so to a screen reader', async () => {
    const { container } = show();
    await waitFor(() => expect(container.querySelectorAll('.mx-table:not(.mx-alts) tbody tr')).toHaveLength(20));
    const cell = container.querySelector('.mx-table:not(.mx-alts) .mx-bars')!;
    expect(cell.querySelectorAll('.mx-bar')).toHaveLength(3);
    expect(cell.getAttribute('aria-label')).toMatch(/vs .* — 0 shields: \d+ .*1 shield: \d+ .*2 shields: \d+/);
  });

  it('adds an alternative to the roster with +, and withholds it once the roster is full', async () => {
    const onAdd = vi.fn();
    const { rerender } = show({ onAdd });
    const first = await screen.findAllByRole('button', { name: /^Add .* to the roster$/ });
    fireEvent.click(first[0]);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(typeof onAdd.mock.calls[0][0]).toBe('string');
    rerender(<MatchupMatrix team={TEAM} league="great" onAdd={onAdd} full />);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /^Add .* to the roster$/ })).toHaveLength(0));
    expect(screen.getByText(/roster is full/)).toBeTruthy();
  });

  it('puts anyone you search for beside the candidates, and lets you drop them again', async () => {
    const { container } = show();
    await screen.findAllByRole('button', { name: /^Add .* to the roster$/ });
    const box = within(container.querySelector('.mx-compare')!).getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'skarmory' } });
    fireEvent.mouseDown((await screen.findAllByRole('option', { name: /^Skarmory/ }))[0]);
    expect(await screen.findByRole('button', { name: 'Stop comparing Skarmory' })).toBeTruthy();
    expect(container.querySelector('.mx-alts .is-compared')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop comparing Skarmory' }));
    expect(container.querySelector('.mx-alts .is-compared')).toBeNull();
  });
});

describe('Bars', () => {
  it('colours each bar by its band and sizes it by its rating', () => {
    const { container } = render(<Bars ratings={[900, 500, 100]} label="x" />);
    const bars = [...container.querySelectorAll('.mx-bar')] as HTMLElement[];
    expect(bars.map((b) => b.className)).toEqual(['mx-bar tone-crush', 'mx-bar tone-close', 'mx-bar tone-rout']);
    expect(bars[0].style.height).toBe('90%');
  });
});
