import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FormatBuilderScreen } from '../FormatBuilderScreen';
import { listFormats } from '../../state/formatStore';
import { SessionProvider } from '../../state/SessionContext';

beforeEach(() => localStorage.clear());

/** Opens the "advanced: raw rule list" disclosure the ClauseEditor now lives behind. */
function openAdvanced() {
  fireEvent.click(screen.getByRole('button', { name: /advanced: raw rule list/i }));
}

/**
 * `FormatBuilderScreen` now reads `useFormats()`, which reads `useSession()` —
 * rendering it bare throws on the missing context. `setup.ts` mocks
 * `@supabase/supabase-js` suite-wide and settles signed-out, so this
 * `SessionProvider` talks to that stub and never reaches a network, the same
 * way `test/render.tsx`'s `renderApp` does for other screens.
 */
function renderScreen() {
  return render(
    <SessionProvider>
      <FormatBuilderScreen />
    </SessionProvider>,
  );
}

describe('FormatBuilderScreen', () => {
  it('opens on a new format with nothing yet in the pool', () => {
    // New formats start from `start: 'empty'` (Task 4): the type chips and the
    // species picker build the pool up, rather than the author's first move
    // always being to carve exceptions out of the whole league.
    renderScreen();
    expect(Number(screen.getByTestId('pool-count').textContent)).toBe(0);
  });

  it('adding a deny clause shrinks the pool', () => {
    renderScreen();
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

  it('saves a named format to storage', async () => {
    renderScreen();
    // An empty-start format has an empty legal pool, which `lintFormat` flags
    // as an error and Save refuses to act on — give it something legal first.
    fireEvent.click(screen.getByRole('button', { name: 'water' }));
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    // Save is async now (useFormats()) — even on the signed-out path, its
    // returned id is applied via a `.then(...)` that resolves on a microtask
    // after the click, so it has to be awaited inside `act` for the
    // resulting `setEditing` to be captured rather than leaking a warning.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    });
    const saved = listFormats();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Air Ban');
  });

  it('refuses to save while an error diagnostic stands', () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Broken' } });
    openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: '!zzzznope' } });
    expect(screen.getByRole('button', { name: /^save/i })).toBeDisabled();
    expect(listFormats()).toEqual([]);
  });

  it('lists a saved format and loads it back', async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    // Must be an allow, not the default deny: an empty-start format with only
    // a deny clause is still an empty legal pool, which blocks Save.
    fireEvent.click(screen.getByTestId('clause-effect')); // deny -> allow
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: 'flying' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    });

    fireEvent.click(screen.getByRole('button', { name: /new format/i }));
    // The disclosure itself does not reset with "new format" — only the
    // format does — so it is already open from opening it above.
    expect(screen.queryAllByTestId('clause-row')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /load Air Ban/i }));
    expect(screen.getAllByTestId('clause-row')).toHaveLength(1);
  });

  /**
   * `remove` was carried over unchanged from the localStorage version, where
   * an accidental click just meant re-typing a format. On this branch it
   * calls `deleteServerFormat` for a signed-in author, which cascades the
   * format's whole version history irrecoverably — a bigger blast radius
   * with no confirmation guarding it, unlike the team builder's delete on
   * this same branch. `listFormats()` (real localStorage, signed-out path)
   * is what actually distinguishes "confirm blocked the delete" from
   * "confirm did nothing" — a spy call count alone would pass even if the
   * screen ignored the returned `false`.
   */
  it('asks for confirmation before deleting a saved format, and only deletes after confirming', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'water' }));
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    });
    expect(listFormats()).toHaveLength(1);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /delete air ban/i }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(listFormats()).toHaveLength(1);

    confirmSpy.mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /delete air ban/i }));
    });
    expect(listFormats()).toHaveLength(0);

    confirmSpy.mockRestore();
  });
});
