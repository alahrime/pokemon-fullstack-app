import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TypeFilterRow } from '../TypeFilterRow';
import { RULES_SCHEMA, type Format } from '../../rules';
import { POKEMON_TYPES } from '../../lib/pokemonTypes';

const empty: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  start: 'empty',
  pool: [],
  composition: { size: 3 },
  selection: { mode: 'open' },
};

describe('TypeFilterRow', () => {
  it('offers every type', () => {
    render(<TypeFilterRow format={empty} onChange={() => {}} />);
    expect(screen.getAllByTestId('type-chip')).toHaveLength(POKEMON_TYPES.length);
  });

  it('adds a type when clicked', () => {
    const onChange = vi.fn();
    render(<TypeFilterRow format={empty} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /water/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ pool: [{ effect: 'allow', select: 'water' }] }),
    );
  });

  it('marks an active type as pressed', () => {
    const withWater: Format = { ...empty, pool: [{ effect: 'allow', select: 'water' }] };
    render(<TypeFilterRow format={withWater} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /water/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^fire$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('removes the type when clicked again', () => {
    const onChange = vi.fn();
    const withWater: Format = { ...empty, pool: [{ effect: 'allow', select: 'water' }] };
    render(<TypeFilterRow format={withWater} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /water/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ pool: [] }));
  });
});
