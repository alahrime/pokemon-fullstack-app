import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddPokemonModal } from '../AddPokemonModal';

const modal = (onClose: () => void) => <AddPokemonModal league="great" onCommit={vi.fn()} onClose={onClose} />;
const box = () => screen.getByPlaceholderText('Search any Pokémon…') as HTMLInputElement;

describe('the picker search keeps its focus until a pick is made', () => {
  it('a parent re-render with a new onClose does not pull focus out of the box', () => {
    const { rerender } = render(modal(() => {}));
    box().focus();
    fireEvent.change(box(), { target: { value: 'azu' } });
    expect(document.activeElement).toBe(box());
    // Callers pass `onClose` inline, so every parent render is a new function.
    rerender(modal(() => {}));
    rerender(modal(() => {}));
    expect(document.activeElement).toBe(box());
    expect(screen.queryAllByRole('option').length).toBeGreaterThan(0);
  });

  it('Escape dismisses the open list first, and only then closes the dialog', () => {
    const onClose = vi.fn();
    render(modal(onClose));
    box().focus();
    fireEvent.change(box(), { target: { value: 'azu' } });
    expect(screen.queryAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryAllByRole('option').length).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pressing on the list itself (scrollbar, gaps) cannot blur the box', () => {
    render(modal(() => {}));
    box().focus();
    fireEvent.change(box(), { target: { value: 'azu' } });
    const panel = document.querySelector('.search-dropdown')!;
    // fireEvent returns false when the event was default-prevented, which is what keeps focus in the input.
    expect(fireEvent.mouseDown(panel)).toBe(false);
    expect(fireEvent.mouseDown(panel.querySelector('ul')!)).toBe(false);
  });
});
