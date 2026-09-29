import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { RoundClock } from '../RoundClock';

const NOW = new Date('2026-09-29T12:00:00Z');
const at = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RoundClock', () => {
  it('labels itself and counts down once a second', () => {
    render(<RoundClock endsAt={at(3725)} />);
    expect(screen.getByText('Time until round end')).toBeTruthy();
    expect(screen.getByText('01:02:05')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('01:02:04')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText('01:02:00')).toBeTruthy();
  });
  it('shows 00:00:00 after the end and stops its interval', () => {
    render(<RoundClock endsAt={at(2)} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('00:00:00')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('00:00:00')).toBeTruthy();
  });
  it('an end already past starts at zero with no timer', () => {
    render(<RoundClock endsAt={at(-30)} />);
    expect(screen.getByText('00:00:00')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('null shows a dash and ticks nothing', () => {
    render(<RoundClock endsAt={null} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up on unmount', () => {
    const { unmount } = render(<RoundClock endsAt={at(60)} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('has no live region, so a tick announces nothing', () => {
    const { container } = render(<RoundClock endsAt={at(60)} />);
    expect(container.querySelector('[aria-live], [role="timer"], [role="status"], [role="alert"]')).toBeNull();
  });
});
