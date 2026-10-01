import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddPokemonModal } from '../AddPokemonModal';

const iv = { a: 0, d: 15, s: 15 };
const open = (ref: string, extra = {}) =>
  render(<AddPokemonModal league="great" initial={{ ref, chargeIds: [], fastIdx: 0, iv }} onCommit={vi.fn()} onClose={vi.fn()} {...extra} />);

describe('AddPokemonModal forms', () => {
  it('offers Return on a shadow-eligible Pokémon until it is made a Shadow', () => {
    open('machamp');
    expect(screen.getByRole('button', { name: /^Return/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Shadow' }));
    expect(screen.queryByRole('button', { name: /^Return/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));
    expect(screen.getByRole('button', { name: /^Return/ })).toBeTruthy();
  });

  it('shows no form switch for a Pokémon that cannot be a Shadow', () => {
    open('azumarill');
    expect(screen.queryByRole('group', { name: 'Form' })).toBeNull();
  });

  it('offers Best Buddy only when asked, and reports it in the choice', () => {
    const onCommit = vi.fn();
    render(<AddPokemonModal league="great" buddy initial={{ ref: 'medicham', chargeIds: ['ICE_PUNCH'], fastIdx: 0, iv }} onCommit={onCommit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Best Buddy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ ref: 'medicham', bestBuddy: true, chargeIds: ['ICE_PUNCH'] }));
  });

  it('keeps an edited build on open instead of resetting it to the rated set', () => {
    open('machamp');
    expect(screen.getByRole('button', { name: /^Return/ }).className).not.toContain('is-active');
  });
});

describe('AddPokemonModal with a Mega', () => {
  it('opens a Mega in a league that does not rank it, with moves to choose from', () => {
    render(<AddPokemonModal league="great" initial={{ ref: 'venusaur_mega', chargeIds: [], fastIdx: 0, iv }} onCommit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByText('Venusaur (Mega)').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.modal-moves button').length).toBeGreaterThan(2);
    expect(screen.queryByRole('button', { name: /^Return/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Form' })).toBeNull();
  });

  it('finds a Mega by name when the format admits it, and not when it does not', async () => {
    const { rerender } = render(<AddPokemonModal league="great" restrictTo={new Set(['venusaur_mega'])} onCommit={vi.fn()} onClose={vi.fn()} />);
    const box = screen.getByPlaceholderText('Search any Pokémon…');
    fireEvent.change(box, { target: { value: 'venusaur' } });
    expect((await screen.findAllByRole('option')).length).toBe(1);
    rerender(<AddPokemonModal league="great" restrictTo={new Set(['venusaur'])} onCommit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search any Pokémon…'), { target: { value: 'venusaur' } });
    expect((await screen.findAllByRole('option')).map((o) => o.textContent).join('|')).not.toMatch(/Mega/);
  });
});
