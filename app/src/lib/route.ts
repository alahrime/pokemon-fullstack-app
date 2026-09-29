import type { Screen } from '../state/AppState';
import { SECTIONS, sectionOf } from './screens';

/** `match` shares Matches' address: an open match lives in memory (`activeMatch`)
 *  and a URL cannot recreate it. */
export function hashFor(screen: Screen): string {
  if (screen === 'landing') return '#/';
  if (screen === 'account') return '#/account';
  const id = screen === 'match' ? 'matchmaking' : screen;
  return `#/${sectionOf(id)!.id}/${id}`;
}

export function screenFromHash(hash: string): Screen {
  const m = /^#\/([a-z]+)\/([a-z0-9]+)$/.exec(hash);
  if (m) {
    const section = SECTIONS.find((s) => s.id === m[1]);
    const screen = section?.screens.find((s) => s === m[2] && s !== 'match');
    if (screen) return screen;
  }
  return hash === '#/account' ? 'account' : 'landing';
}
