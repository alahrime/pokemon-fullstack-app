import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
