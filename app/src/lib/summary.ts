import summaryRaw from '../data/summary.json';
import type { LeagueId } from './types';
import type { LeagueSummary } from './summarySpec';

/**
 * Reader for what scripts/build-summary.ts emits.
 *
 * This exists so the landing screen can show its headline numbers without
 * importing `lib/rankings` or `lib/teams`, either of which drags a multi-megabyte
 * artefact into the entry chunk. Anything beyond these three fields belongs in
 * the real readers, on a screen that is lazy-loaded — do not grow this file into
 * a second rankings API, or the split it exists to protect goes away quietly.
 */

const SUMMARY = summaryRaw as unknown as Record<LeagueId, LeagueSummary>;

export const summaryFor = (lg: LeagueId): LeagueSummary => SUMMARY[lg];
