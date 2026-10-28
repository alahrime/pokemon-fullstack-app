import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FancySelect, Swatch } from '../FancySelect';
import { ShieldPicker } from '../ShieldPicker';

const OPTIONS = [
  { value: 'a', label: 'Alpha', hint: 'first', lead: <Swatch colors={['red']} /> },
  { value: 'b', label: 'Bravo', trail: <span>2e</span> },
  { value: 'c', label: 'Charlie' },
  { value: 'd', label: 'Cobalt' },
];

function Harness({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState('a');
  return <FancySelect value={v} options={OPTIONS} label="Pick" showHint onChange={(x) => { setV(x); onChange(x); }} />;
}

const trigger = () => screen.getByRole('button', { name: 'Pick' });
const active = () => screen.getByRole('listbox').getAttribute('aria-activedescendant');
const activeLabel = () => document.getElementById(active()!)?.querySelector('.fs-label')?.textContent;

describe('FancySelect', () => {
  it('shows the chosen option and its hint, and opens a listbox on click', () => {
    render(<Harness />);
    expect(trigger().textContent).toContain('Alpha');
    expect(trigger().textContent).toContain('first');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').length).toBe(4);
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Alpha');
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('walks with the arrows, Home and End, types ahead, and picks with Enter', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    expect(activeLabel()).toBe('Alpha');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(activeLabel()).toBe('Bravo');
    fireEvent.keyDown(list, { key: 'End' });
    expect(activeLabel()).toBe('Cobalt');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(activeLabel()).toBe('Cobalt');
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(activeLabel()).toBe('Alpha');
    fireEvent.keyDown(list, { key: 'c' });
    expect(activeLabel()).toBe('Charlie');
    fireEvent.keyDown(list, { key: 'c' });
    expect(activeLabel()).toBe('Cobalt');
    fireEvent.keyDown(list, { key: 'z' });
    expect(activeLabel()).toBe('Cobalt');
    fireEvent.keyDown(list, { key: 'Shift' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('d');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger().textContent).toContain('Cobalt');
    expect(document.querySelector('.fs-flash')).toBeTruthy();
  });

  it('picks by pointer, and closes without a change on Escape, Tab, an outside press, a scroll or a resize', () => {
    const onChange = vi.fn();
    render(<><Harness onChange={onChange} /><p>outside</p></>);
    fireEvent.click(trigger());
    fireEvent.mouseEnter(screen.getAllByRole('option')[2]);
    expect(activeLabel()).toBe('Charlie');
    fireEvent.click(screen.getAllByRole('option')[2]);
    expect(onChange).toHaveBeenCalledWith('c');

    for (const close of [
      () => fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' }),
      () => fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' }),
      () => fireEvent.pointerDown(screen.getByText('outside')),
      () => fireEvent.scroll(window),
      () => fireEvent(window, new Event('resize')),
    ]) {
      fireEvent.keyDown(trigger(), { key: 'Enter' });
      expect(screen.getByRole('listbox')).toBeTruthy();
      // A press inside the list does not count as outside.
      fireEvent.pointerDown(screen.getAllByRole('option')[0]);
      expect(screen.getByRole('listbox')).toBeTruthy();
      close();
      expect(screen.queryByRole('listbox')).toBeNull();
    }
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('re-picking the current option changes nothing, and other keys on the trigger do nothing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: 'x' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(trigger(), { key: ' ' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: ' ' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the placeholder when nothing matches the value', () => {
    render(<FancySelect value="" options={OPTIONS} label="Empty" placeholder="Choose one" onChange={() => {}} size="sm" />);
    expect(screen.getByRole('button', { name: 'Empty' }).textContent).toContain('Choose one');
  });

  it('opens upward when the space below is short', () => {
    render(<Harness />);
    const t = trigger();
    t.getBoundingClientRect = () => ({ top: 700, bottom: 740, left: 10, right: 210, width: 200, height: 40, x: 10, y: 700, toJSON: () => ({}) });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    fireEvent.click(t);
    expect(screen.getByRole('listbox').classList.contains('is-up')).toBe(true);
  });
});

describe('ShieldPicker', () => {
  function Shields() {
    const [n, setN] = useState(1);
    return <ShieldPicker value={n} onChange={setN} />;
  }
  it('is a radio group of three, moved by click and every arrow, wrapping round', () => {
    render(<Shields />);
    const r = (name: string) => screen.getByRole('radio', { name });
    expect(screen.getByRole('radiogroup', { name: 'Shields' })).toBeTruthy();
    expect(r('1 shield').getAttribute('aria-checked')).toBe('true');
    expect(r('No shields').getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(r('1 shield'), { key: 'ArrowDown' });
    expect(r('2 shields').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(r('2 shields'), { key: 'ArrowRight' });
    expect(r('No shields').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(r('No shields'), { key: 'ArrowUp' });
    expect(r('2 shields').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(r('2 shields'), { key: 'Enter' });
    expect(r('2 shields').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(r('No shields'));
    expect(r('No shields').getAttribute('aria-checked')).toBe('true');
    // The crossed-out shield for none, one shield, and two dovetailed.
    expect(r('No shields').querySelector('.sp-ban')).toBeTruthy();
    expect(r('1 shield').querySelectorAll('.sp-fill').length).toBe(1);
    expect(r('2 shields').querySelectorAll('.sp-fill').length).toBe(2);
  });
});
