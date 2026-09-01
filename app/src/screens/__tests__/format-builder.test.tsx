import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormatBuilderScreen } from '../FormatBuilderScreen';
import { listFormats } from '../../state/formatStore';

beforeEach(() => localStorage.clear());

/** Opens the "advanced: raw rule list" disclosure the ClauseEditor now lives behind. */
function openAdvanced() {
  fireEvent.click(screen.getByRole('button', { name: /advanced: raw rule list/i }));
}

describe('FormatBuilderScreen', () => {
  it('opens on a new format with nothing yet in the pool', () => {
    // New formats start from `start: 'empty'` (Task 4): the type chips and the
    // species picker build the pool up, rather than the author's first move
    // always being to carve exceptions out of the whole league.
    render(<FormatBuilderScreen />);
    expect(Number(screen.getByTestId('pool-count').textContent)).toBe(0);
  });

  it('adding a deny clause shrinks the pool', () => {
    render(<FormatBuilderScreen />);
    openAdvanced();
    // An empty-start format's pool count is already 0, so a deny clause needs
    // something legal to bite into first: an allow rule for water.
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.click(screen.getByTestId('clause-effect')); // deny -> allow
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: 'water' } });
    const before = Number(screen.getByTestId('pool-count').textContent);

    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    const selects = screen.getAllByTestId('clause-select');
    fireEvent.change(selects[1], { target: { value: 'flying' } });
    expect(Number(screen.getByTestId('pool-count').textContent)).toBeLessThan(before);
  });

  it('saves a named format to storage', () => {
    render(<FormatBuilderScreen />);
    // An empty-start format has an empty legal pool, which `lintFormat` flags
    // as an error and Save refuses to act on — give it something legal first.
    fireEvent.click(screen.getByRole('button', { name: 'water' }));
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    const saved = listFormats();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Air Ban');
  });

  it('refuses to save while an error diagnostic stands', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Broken' } });
    openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: '!zzzznope' } });
    expect(screen.getByRole('button', { name: /^save/i })).toBeDisabled();
    expect(listFormats()).toEqual([]);
  });

  it('lists a saved format and loads it back', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    // Must be an allow, not the default deny: an empty-start format with only
    // a deny clause is still an empty legal pool, which blocks Save.
    fireEvent.click(screen.getByTestId('clause-effect')); // deny -> allow
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: 'flying' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    fireEvent.click(screen.getByRole('button', { name: /new format/i }));
    // The disclosure itself does not reset with "new format" — only the
    // format does — so it is already open from opening it above.
    expect(screen.queryAllByTestId('clause-row')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /load Air Ban/i }));
    expect(screen.getAllByTestId('clause-row')).toHaveLength(1);
  });
});
