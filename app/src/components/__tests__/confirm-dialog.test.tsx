import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { confirmDialog } from '../ConfirmDialog';

const ask = () => confirmDialog({ title: 'Delete team', body: 'Delete "Core"? This cannot be undone.', confirmLabel: 'Delete team' });
const gone = () => waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

afterEach(() => { document.body.innerHTML = ''; });

describe('confirmDialog', () => {
  it('asks with a titled, described dialog, and resolves true only on the named action', async () => {
    const answer = ask();
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete team' });
    expect(dialog.textContent).toContain('This cannot be undone.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete team' }));
    await expect(answer).resolves.toBe(true);
    await gone();
  });

  it('starts on Cancel, so Enter or a double-click cannot destroy anything', async () => {
    void ask();
    await screen.findByRole('alertdialog');
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['a click outside', () => fireEvent.mouseDown(document.querySelector('.confirm-scrim')!)],
  ])('resolves false on %s', async (_, act) => {
    const answer = ask();
    await screen.findByRole('alertdialog');
    act();
    await expect(answer).resolves.toBe(false);
    await gone();
  });

  it('answers once: a second click after the first does not flip it', async () => {
    const answer = ask();
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete team' }));
    await expect(answer).resolves.toBe(false);
  });
});
