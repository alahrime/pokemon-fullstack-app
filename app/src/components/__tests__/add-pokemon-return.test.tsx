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
