import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const box = { fail: true };
function Flaky() {
  if (box.fail) throw new Error('boom');
  return <p>fine</p>;
}

describe('ErrorBoundary', () => {
  it('shows the fallback instead of unmounting everything, and recovers on reset', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    box.fail = true;
    render(
      <div>
        <nav>still here</nav>
        <ErrorBoundary fallback={(e, reset) => <button onClick={reset}>{`retry: ${e.message}`}</button>}>
          <Flaky />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('still here')).toBeInTheDocument();
    box.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'retry: boom' }));
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});
