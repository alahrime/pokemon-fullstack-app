export interface CatchRecord {
  id: string;
  speciesId: string;
  a: number;
  d: number;
  s: number;
  when: string;
}

export const MOCK_CATCHES: CatchRecord[] = [
  { id: 'c1', speciesId: 'medicham', a: 1, d: 15, s: 14, when: '2 min ago' },
  { id: 'c2', speciesId: 'azumarill', a: 0, d: 14, s: 15, when: 'yesterday' },
  { id: 'c3', speciesId: 'registeel', a: 4, d: 13, s: 12, when: '2 days ago' },
  { id: 'c4', speciesId: 'swampert', a: 15, d: 15, s: 14, when: 'last week' },
  { id: 'c5', speciesId: 'stunfisk_galarian', a: 2, d: 15, s: 13, when: 'last week' },
  { id: 'c6', speciesId: 'talonflame', a: 12, d: 9, s: 10, when: 'last week' },
  { id: 'c7', speciesId: 'corviknight', a: 0, d: 15, s: 15, when: '2 weeks ago' },
];
