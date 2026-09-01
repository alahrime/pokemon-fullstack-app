import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ClauseEditor } from '../ClauseEditor';
import type { PoolClause } from '../../rules';

const clauses: PoolClause[] = [
  { effect: 'deny', select: 'flying' },
  { effect: 'allow', select: '+mantine' },
];

describe('ClauseEditor', () => {
  it('renders one row per clause', () => {
    render(<ClauseEditor clauses={clauses} onChange={() => {}} />);
    expect(screen.getAllByTestId('clause-row')).toHaveLength(2);
  });

  it('adds a clause', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(onChange).toHaveBeenCalledWith([...clauses, { effect: 'deny', select: '' }]);
  });

  it('removes a clause', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    expect(onChange).toHaveBeenCalledWith([clauses[1]]);
  });

  it('moves a clause down, which changes the format', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /move down/i })[0]);
    expect(onChange).toHaveBeenCalledWith([clauses[1], clauses[0]]);
  });

  it('keeps a row bound to its clause across a reorder, not to its position', () => {
    // Regression test for the index-keyed list: with `key={i}`, reordering
    // swaps the *data* React renders into each positional DOM node rather
    // than moving the node with the clause. That is invisible from a single
    // render — the values always come out right — and only shows up across
    // a real re-render with the reordered array, which is why it needs a
    // `rerender`, not just repeated onChange assertions.
    const onChange = vi.fn();
    const { rerender } = render(<ClauseEditor clauses={clauses} onChange={onChange} />);

    // Track clause B ("+mantine") by its actual DOM row, before any reorder.
    const bRowBefore = screen.getAllByTestId('clause-row')[1];
    expect(within(bRowBefore).getByTestId('clause-select')).toHaveValue('+mantine');

    fireEvent.click(screen.getAllByRole('button', { name: /move up/i })[1]);
    const reordered = onChange.mock.calls[0][0] as PoolClause[];
    expect(reordered).toEqual([clauses[1], clauses[0]]);

    // The parent applies the reorder and passes the new array back down.
    rerender(<ClauseEditor clauses={reordered} onChange={onChange} />);

    const rowsAfter = screen.getAllByTestId('clause-row');
    // The row identity must have followed clause B to its new position — a
    // stale-index implementation instead leaves bRowBefore sitting at index 1,
    // now describing clause A.
    expect(rowsAfter[0]).toBe(bRowBefore);
    expect(within(rowsAfter[0]).getByTestId('clause-select')).toHaveValue('+mantine');
    expect(within(rowsAfter[0]).getByTestId('clause-effect')).toHaveTextContent('allow');
  });

  it('does not offer to move the first clause up', () => {
    render(<ClauseEditor clauses={clauses} onChange={() => {}} />);
    expect(screen.getAllByRole('button', { name: /move up/i })[0]).toBeDisabled();
  });

  it('edits a selector', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.change(screen.getAllByTestId('clause-select')[0], { target: { value: 'water' } });
    expect(onChange).toHaveBeenCalledWith([{ effect: 'deny', select: 'water' }, clauses[1]]);
  });

  it('toggles allow and deny', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getAllByTestId('clause-effect')[0]);
    expect(onChange).toHaveBeenCalledWith([{ effect: 'allow', select: 'flying' }, clauses[1]]);
  });
});
