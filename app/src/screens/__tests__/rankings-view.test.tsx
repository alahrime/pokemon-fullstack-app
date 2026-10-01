import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { RankingsScreen } from '../RankingsScreen';

describe('RankingsScreen "Ranking of"', () => {
  it('ranks individual Pokémon by default and switches to the best teams of three or six', async () => {
    const { container } = renderApp(<RankingsScreen />);
    const view = screen.getByLabelText('Ranking of') as HTMLSelectElement;
    expect(view.value).toBe('pokemon');
    expect(container.querySelector('.rankings-table')).toBeTruthy();
    fireEvent.change(view, { target: { value: 'teams3' } });
    expect(await screen.findByText(/Best teams of 3/i)).toBeTruthy();
    expect(container.querySelector('.rankings-table')).toBeNull();
    fireEvent.change(view, { target: { value: 'teams6' } });
    expect(await screen.findByText(/Best Show 6s/i)).toBeTruthy();
  });
});
