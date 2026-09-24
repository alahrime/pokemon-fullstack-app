import { describe, it, expect, vi } from 'vitest';
import { renderApp } from '../../test/render';
import { HeldOutNote } from '../HeldOutNote';

// Nothing is held out since the engine learned form changes, so the note is
// exercised against a stand-in set. It reads UNSIMULATED_IDS, whatever is in it.
vi.mock('../../lib/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/data')>()),
  UNSIMULATED_IDS: new Set(['mimikyu']),
}));

describe('HeldOutNote', () => {
  it('names only the species asked for', () => {
    const { container } = renderApp(<HeldOutNote only={['mimikyu']} />);
    expect(container.textContent).toContain('Mimikyu');
    expect(container.textContent).not.toContain('Aegislash');
  });
  it('renders nothing when the filter matches nothing', () => {
    const { container } = renderApp(<HeldOutNote only={['azumarill']} />);
    expect(container.textContent).toBe('');
  });
  it('keeps the full explanation one hover away', () => {
    const { container } = renderApp(<HeldOutNote only={['mimikyu']} />);
    expect(container.querySelector('.held-out-legend')!.getAttribute('title')!.length).toBeGreaterThan(60);
  });
});
