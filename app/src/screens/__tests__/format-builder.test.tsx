import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormatBuilderScreen } from '../FormatBuilderScreen';
import { listFormats } from '../../state/formatStore';

beforeEach(() => localStorage.clear());

describe('FormatBuilderScreen', () => {
  it('opens on an empty format with the whole league legal', () => {
    render(<FormatBuilderScreen />);
    expect(Number(screen.getByTestId('pool-count').textContent)).toBeGreaterThan(500);
  });

  it('adding a deny clause shrinks the pool', () => {
    render(<FormatBuilderScreen />);
    const before = Number(screen.getByTestId('pool-count').textContent);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: 'flying' } });
    expect(Number(screen.getByTestId('pool-count').textContent)).toBeLessThan(before);
  });

  it('saves a named format to storage', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    const saved = listFormats();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Air Ban');
  });

  it('refuses to save while an error diagnostic stands', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Broken' } });
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: '!zzzznope' } });
    expect(screen.getByRole('button', { name: /^save/i })).toBeDisabled();
    expect(listFormats()).toEqual([]);
  });

  it('lists a saved format and loads it back', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: 'flying' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    fireEvent.click(screen.getByRole('button', { name: /new format/i }));
    expect(screen.queryAllByTestId('clause-row')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /load Air Ban/i }));
    expect(screen.getAllByTestId('clause-row')).toHaveLength(1);
  });
});
