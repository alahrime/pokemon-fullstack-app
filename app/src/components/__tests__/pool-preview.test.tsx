import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PoolPreview } from '../PoolPreview';
import { RULES_SCHEMA, type Format } from '../../rules';

const f: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [
    { effect: 'deny', select: 'flying', note: 'air banned' },
    { effect: 'allow', select: '+mantine' },
  ],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

describe('PoolPreview', () => {
  it('shows how many refs are legal', () => {
    render(<PoolPreview format={f} />);
    expect(screen.getByTestId('pool-count').textContent).toMatch(/\d/);
  });

  it('shows a delta for every clause', () => {
    render(<PoolPreview format={f} />);
    expect(screen.getAllByTestId('clause-delta')).toHaveLength(2);
  });

  it('names the deciding clause for an illegal ref', () => {
    render(<PoolPreview format={f} explain="pidgeot" />);
    expect(screen.getByTestId('explain').textContent).toMatch(/rule 1/i);
  });

  it('says so when a ref is legal', () => {
    render(<PoolPreview format={f} explain="azumarill" />);
    expect(screen.getByTestId('explain').textContent).toMatch(/legal/i);
  });

  it('says no rule adds a ref, rather than calling it legal, when the format starts empty', () => {
    // Once new formats start empty (Task 4), this branch is the common case for
    // any ref no clause has touched yet — not the edge case it was when every
    // format started from the whole league.
    const empty: Format = { ...f, start: 'empty', pool: [] };
    render(<PoolPreview format={empty} explain="azumarill" />);
    expect(screen.getByTestId('explain').textContent).toMatch(/not in this format — no rule adds it/i);
  });

  it('renders diagnostics when the format has problems', () => {
    const broken: Format = { ...f, pool: [{ effect: 'deny', select: '!zzz' }] };
    render(<PoolPreview format={broken} />);
    expect(screen.getAllByTestId('diagnostic').length).toBeGreaterThan(0);
  });
});
