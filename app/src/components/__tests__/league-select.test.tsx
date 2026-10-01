import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LeagueSelect, optionColors, type LeagueOption } from '../LeagueSelect';

const options: LeagueOption[] = [
  { value: 'great', label: 'Great League', league: 'great' },
  { value: 'ultra', label: 'Ultra League', league: 'ultra' },
  { value: 'cauldron', label: 'Cauldron Cup', league: 'ultra', types: ['fairy', 'poison'], group: 'Cups' },
];
const setup = (onChange = vi.fn(), value = 'great') => {
  render(<LeagueSelect id="x" label="Format" value={value} options={options} onChange={onChange} />);
  return { onChange, box: screen.getByRole('combobox', { name: 'Format' }) };
};

describe('LeagueSelect', () => {
  it('shows the current choice with its emblem, and opens a list of every option with one', () => {
    const { box } = setup();
    expect(box.textContent).toContain('Great League');
    expect(box.querySelector('svg')).toBeTruthy();
    fireEvent.click(box);
    const rows = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(rows).toHaveLength(3);
    rows.forEach((r) => expect(r.querySelector('svg')).toBeTruthy());
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
  });

  it('a cup takes its types’ colours (Fairy and Poison: pink into purple) and its league’s emblem', () => {
    expect(optionColors(options[2])).toEqual(['var(--type-fairy)', 'var(--type-poison)']);
    expect(optionColors(options[0])).toEqual(['var(--lg-great)', 'var(--lg-great-accent)']);
    setup();
    fireEvent.click(screen.getByRole('combobox'));
    const [, ultra, cauldron] = screen.getAllByRole('option');
    expect(cauldron.getAttribute('style')).toMatch(/--type-fairy.*--type-poison/);
    expect(cauldron.querySelector('svg')!.innerHTML).toBe(ultra.querySelector('svg')!.innerHTML);
  });

  it('picks with the mouse and with the keyboard', () => {
    const { onChange, box } = setup();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('option', { name: /Ultra League/ }));
    expect(onChange).toHaveBeenLastCalledWith('ultra');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('cauldron');
  });

  it('Escape closes the list and goes no further, so it cannot also close a dialog', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const { box } = setup();
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outer);
  });

  it('a press on the list does not blur the button', () => {
    const { box } = setup();
    fireEvent.click(box);
    expect(fireEvent.mouseDown(screen.getByRole('listbox'))).toBe(false);
  });
});
