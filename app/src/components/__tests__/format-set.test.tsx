import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { FormatSet } from '../FormatSet';
import { resolvePool, RULES_SCHEMA, type Format } from '../../rules';

const water: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  start: 'empty',
  pool: [{ effect: 'allow', select: 'water' }],
  composition: { size: 3 },
  selection: { mode: 'open' },
};

const nothing: Format = { ...water, pool: [] };

describe('FormatSet', () => {
  it('says the set is empty when it is', () => {
    render(<FormatSet format={nothing} onChange={() => {}} />);
    expect(screen.getByTestId('set-empty')).toBeInTheDocument();
  });

  it('groups members under their type, with a count', () => {
    render(<FormatSet format={water} onChange={() => {}} />);
    const group = screen.getByTestId('set-group-water');
    expect(Number(within(group).getByTestId('set-group-count').textContent)).toBeGreaterThan(0);
  });

  it('does not render members until a group is expanded', () => {
    render(<FormatSet format={water} onChange={() => {}} />);
    expect(screen.queryAllByTestId('set-member')).toHaveLength(0);
    fireEvent.click(within(screen.getByTestId('set-group-water')).getByRole('button'));
    expect(screen.getAllByTestId('set-member').length).toBeGreaterThan(0);
  });

  it('removes one member when its X is clicked', () => {
    const onChange = vi.fn();
    render(<FormatSet format={water} onChange={onChange} />);
    fireEvent.click(within(screen.getByTestId('set-group-water')).getByRole('button'));
    fireEvent.click(screen.getAllByTestId('set-remove')[0]);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Format;
    expect(resolvePool(next).legal.length).toBe(resolvePool(water).legal.length - 1);
  });

  it('counts every member exactly once across groups', () => {
    render(<FormatSet format={water} onChange={() => {}} />);
    const counts = screen.getAllByTestId('set-group-count').map((n) => Number(n.textContent));
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(resolvePool(water).legal.length);
  });

  // --- species-add control (beyond the brief: adding one at a time, in a chosen scope) ---

  describe('adding one species', () => {
    it('adds a species, in the whole-species scope, when no rule touches it yet', async () => {
      const onChange = vi.fn();
      render(<FormatSet format={nothing} onChange={onChange} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'azumarill' } });
      await waitFor(() => expect(screen.getByRole('option', { name: /azumarill/i })).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByRole('option', { name: /azumarill/i }));

      fireEvent.click(screen.getByTestId('add-species-both'));

      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0] as Format;
      expect(next.pool.at(-1)).toEqual({ effect: 'allow', select: 'azumarill' });
      expect(resolvePool(next).legal.length).toBe(1);
    });

    it('adds only the normal form when that scope is chosen', async () => {
      const onChange = vi.fn();
      render(<FormatSet format={nothing} onChange={onChange} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'registeel' } });
      await waitFor(() => expect(screen.getByRole('option', { name: /registeel/i })).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByRole('option', { name: /registeel/i }));

      fireEvent.click(screen.getByTestId('add-species-normal'));

      const next = onChange.mock.calls[0][0] as Format;
      expect(next.pool.at(-1)).toEqual({ effect: 'allow', select: 'registeel&!shadow' });
      const legal = resolvePool(next).legal;
      expect(legal).toContain('registeel');
      expect(legal).not.toContain('registeel_shadow');
    });

    it('adds only the shadow form when that scope is chosen', async () => {
      const onChange = vi.fn();
      render(<FormatSet format={nothing} onChange={onChange} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'registeel' } });
      await waitFor(() => expect(screen.getByRole('option', { name: /registeel/i })).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByRole('option', { name: /registeel/i }));

      fireEvent.click(screen.getByTestId('add-species-shadow'));

      const next = onChange.mock.calls[0][0] as Format;
      expect(next.pool.at(-1)).toEqual({ effect: 'allow', select: 'registeel&shadow' });
      const legal = resolvePool(next).legal;
      expect(legal).not.toContain('registeel');
      expect(legal).toContain('registeel_shadow');
    });

    it('does not offer to add a species already in the set', async () => {
      // Azumarill (Water/Fairy) is already in `water`'s resolved set, so the
      // picker should not surface it as an option — offering it would invite
      // the addSpecies dedupe gap: 'both' plus 'normal' appends a second,
      // redundant clause rather than narrowing the first.
      render(<FormatSet format={water} onChange={() => {}} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'azumarill' } });
      await waitFor(() => expect(screen.queryByRole('option', { name: /azumarill/i })).not.toBeInTheDocument());
    });

    // A species can be *partially* in the set — one form allowed, the other
    // not — reached through clauses that never spell its name (a type chip,
    // say, plus one X). The picker must still offer it, but only for the
    // variant genuinely missing: offering 'both' or the already-legal form
    // again would either no-op or, worse, invite addSpecies's redundant-
    // clause dedupe gap for no reason.

    it('offers only the Normal scope when just the Shadow form is already in the set', async () => {
      // Registeel (steel, shadow-eligible, Great-legal) with only its Shadow
      // allowed — azumarill can't stand in here, it has no Shadow form at all.
      const shadowOnly: Format = { ...nothing, pool: [{ effect: 'allow', select: 'registeel&shadow' }] };
      render(<FormatSet format={shadowOnly} onChange={() => {}} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'registeel' } });
      await waitFor(() => expect(screen.getByRole('option', { name: /registeel/i })).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByRole('option', { name: /registeel/i }));

      expect(screen.getByTestId('add-species-normal')).toBeInTheDocument();
      expect(screen.queryByTestId('add-species-shadow')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-species-both')).not.toBeInTheDocument();
    });

    it('offers only the Shadow scope when just the Normal form is already in the set', async () => {
      const normalOnly: Format = { ...nothing, pool: [{ effect: 'allow', select: 'registeel&!shadow' }] };
      render(<FormatSet format={normalOnly} onChange={() => {}} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'registeel' } });
      await waitFor(() => expect(screen.getByRole('option', { name: /registeel/i })).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByRole('option', { name: /registeel/i }));

      expect(screen.getByTestId('add-species-shadow')).toBeInTheDocument();
      expect(screen.queryByTestId('add-species-normal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-species-both')).not.toBeInTheDocument();
    });

    it('does not offer a species at all once both of its forms are in the set', async () => {
      const both: Format = { ...nothing, pool: [{ effect: 'allow', select: 'registeel' }] };
      render(<FormatSet format={both} onChange={() => {}} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'registeel' } });
      await waitFor(() => expect(screen.queryByRole('option', { name: /registeel/i })).not.toBeInTheDocument());
    });

    it('adding the missing variant actually makes it legal', async () => {
      const onChange = vi.fn();
      const shadowOnly: Format = { ...nothing, pool: [{ effect: 'allow', select: 'registeel&shadow' }] };
      render(<FormatSet format={shadowOnly} onChange={onChange} />);

      const input = screen.getByPlaceholderText(/add a species/i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'registeel' } });
      await waitFor(() => expect(screen.getByRole('option', { name: /registeel/i })).toBeInTheDocument());
      fireEvent.mouseDown(screen.getByRole('option', { name: /registeel/i }));
      fireEvent.click(screen.getByTestId('add-species-normal'));

      const next = onChange.mock.calls[0][0] as Format;
      const legal = resolvePool(next).legal;
      expect(legal).toContain('registeel');
      expect(legal).toContain('registeel_shadow');
    });
  });
});
