import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { speciesOf, movesFor } from '../../lib/data';
import { encodeMember } from '../../lib/teamCodec';
import type { SavedTeam } from '../../lib/saves';
import type { AddPokemonChoice } from '../../components/AddPokemonModal';

/**
 * Saving and loading a roster from the database.
 *
 * `../../lib/saves` is mocked at the module boundary — the round trip through
 * Supabase belongs to `saves.test.ts`, not here. What belongs here is what the
 * screen does with the three functions it calls: whether it calls them with
 * the roster it actually holds, in the order the slots hold it, and whether a
 * load replaces that roster rather than adding to it.
 */

const savesApi = vi.hoisted(() => ({
  listTeams: vi.fn(),
  saveTeam: vi.fn(),
  deleteTeam: vi.fn(),
}));
vi.mock('../../lib/saves', () => savesApi);

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

function fakeSession(email: string): Session {
  return { access_token: 'tok', user: { id: 'user-1', email } } as unknown as Session;
}

function fakeClient(session: Session | null) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  pkg.client = { auth };
  return auth;
}

async function mount(size: 3 | 6, session: Session | null = null) {
  fakeClient(session);
  // `lib/supabase` builds its client once at import time (`createClient(...)`
  // at module scope), so the mock above only takes effect for an import that
  // happens AFTER `pkg.client` is set. A static top-of-file import would
  // capture the pre-test `null` permanently — the same reason sign-in.test.tsx
  // resets modules and imports dynamically inside its harness.
  vi.resetModules();
  const { ThemeProvider } = await import('../../state/ThemeContext');
  const { AppStateProvider } = await import('../../state/AppState');
  const { SessionProvider } = await import('../../state/SessionContext');
  const { TeamBuilderScreen } = await import('../TeamBuilderScreen');
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <ThemeProvider>
        <AppStateProvider>
          <SessionProvider>
            <TeamBuilderScreen size={size} />
          </SessionProvider>
        </AppStateProvider>
      </ThemeProvider>,
    );
  });
  return { view, container: view.container };
}

/** The rated build for a species in Great League — a real, decodable member. */
function choiceFor(ref: string): AddPokemonChoice {
  const sp = speciesOf(ref)!;
  const rated = movesFor(sp, 'great');
  return {
    ref,
    fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
    chargeIds: rated.charges.map((c) => c.id),
    iv: { a: 0, d: 15, s: 15 },
  };
}

function savedTeam(id: string, name: string, refs: string[], league: SavedTeam['league'] = 'great'): SavedTeam {
  return {
    id,
    name,
    league,
    members: refs.map((r) => encodeMember(choiceFor(r), league)),
  };
}

/** Add a named Pokemon through the live search dropdown. Copied from
 * team-builder.test.tsx's `pick` — reading the first row synchronously after
 * the change event reads the *previous* render's list. */
async function pick(container: HTMLElement, typed: string) {
  const input = container.querySelector('.team-add input') as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  const row = await waitFor(() => {
    const hit = [...container.querySelectorAll('.search-dropdown .search-row')].find((r) =>
      new RegExp(`^${typed}$`, 'i').test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''),
    );
    if (!hit) throw new Error(`no search result for "${typed}"`);
    return hit;
  });
  fireEvent.mouseDown(row);
}

function saveButton(container: HTMLElement) {
  return [...container.querySelectorAll('button')].find((b) => /Save roster/i.test(b.textContent ?? '')) as
    | HTMLButtonElement
    | undefined;
}

function nameInput(container: HTMLElement) {
  return container.querySelector('#team-save-name') as HTMLInputElement;
}

function openSavedList(container: HTMLElement) {
  const btn = [...container.querySelectorAll('button')].find((b) => /Saved teams/i.test(b.textContent ?? ''));
  fireEvent.click(btn!);
}

beforeEach(() => {
  savesApi.listTeams.mockReset().mockResolvedValue([]);
  savesApi.saveTeam.mockReset().mockResolvedValue('new-id');
  savesApi.deleteTeam.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('signed out', () => {
  it('renders no save control, and the builder still works', async () => {
    const { container } = await mount(3, null);
    expect(saveButton(container)).toBeUndefined();
    expect(container.querySelector('#team-save-name')).toBeFalsy();
    expect([...container.querySelectorAll('button')].some((b) => /Saved teams/i.test(b.textContent ?? ''))).toBe(
      false,
    );
    await pick(container, 'azumarill');
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(2);
  });
});

describe('signed in', () => {
  it('disables the save control on an empty roster', async () => {
    const { container } = await mount(3, fakeSession('ash@example.com'));
    const btn = saveButton(container);
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
  });

  it('enables saving once there are members AND a name, and saves both in slot order', async () => {
    const { container } = await mount(3, fakeSession('ash@example.com'));
    await pick(container, 'azumarill');
    await pick(container, 'registeel');
    // Members alone are not enough — a blank name would write a row whose
    // Load button has no text (Finding 2).
    expect(saveButton(container)!.disabled).toBe(true);

    fireEvent.change(nameInput(container), { target: { value: 'My Team' } });
    expect(saveButton(container)!.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });

    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
    const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string; league: string; members: { ref: string }[] };
    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel']);
  });

  it('keeps save disabled for a whitespace-only name, even with members added', async () => {
    const { container } = await mount(3, fakeSession('ash@example.com'));
    await pick(container, 'azumarill');
    fireEvent.change(nameInput(container), { target: { value: '   ' } });
    expect(saveButton(container)!.disabled).toBe(true);
  });

  it('saves the name exactly as typed', async () => {
    const { container } = await mount(3, fakeSession('ash@example.com'));
    await pick(container, 'azumarill');
    fireEvent.change(nameInput(container), { target: { value: 'Rain Squad' } });
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });
    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
    const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string };
    expect(arg.name).toBe('Rain Squad');
  });

  it('replaces the roster outright when loading a saved team, not appending to it', async () => {
    // The roster already carries two DIFFERENT members before the load. If the
    // screen appended instead of replacing, the roster would hold 4 (or more)
    // and would still contain azumarill/registeel — a superset, not the loaded
    // set. Asserting the exact final set is the only check that distinguishes
    // "replaced" from "happened to be the same length".
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'Rain Team', ['medicham', 'skarmory'])]);
    const { container } = await mount(3, fakeSession('ash@example.com'));
    await pick(container, 'azumarill');
    await pick(container, 'registeel');
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(1);

    openSavedList(container);
    const loadBtn = await waitFor(() => {
      const b = [...container.querySelectorAll('.team-load-row button')].find((x) =>
        /Rain Team/i.test(x.textContent ?? ''),
      );
      if (!b) throw new Error('saved team row not rendered yet');
      return b as HTMLButtonElement;
    });
    fireEvent.click(loadBtn);

    const names = [...container.querySelectorAll('.team-slots .pc-name')].map((n) => n.textContent);
    expect(names).toEqual(['Medicham', 'Skarmory']);
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(1);
    // Not a superset: the old members are gone entirely from the roster
    // itself (the discovery list below still legitimately names them).
    const slotsText = container.querySelector('.team-slots')!.textContent ?? '';
    expect(slotsText).not.toMatch(/Azumarill/);
    expect(slotsText).not.toMatch(/Registeel/);
  });

  it('names the move when a saved fast move no longer exists, rather than loading a different one silently', async () => {
    const good = savedTeam('t2', 'Broken Team', ['medicham']);
    const broken: SavedTeam = {
      ...good,
      members: [{ ...good.members[0], fast_move: 'MADE_UP_MOVE_ID' }],
    };
    savesApi.listTeams.mockResolvedValue([broken]);
    const { container } = await mount(3, fakeSession('ash@example.com'));

    openSavedList(container);
    const loadBtn = await waitFor(() => {
      const b = [...container.querySelectorAll('.team-load-row button')].find((x) =>
        /Broken Team/i.test(x.textContent ?? ''),
      );
      if (!b) throw new Error('saved team row not rendered yet');
      return b as HTMLButtonElement;
    });
    fireEvent.click(loadBtn);

    // The member still loads (Medicham is on the roster)...
    expect([...container.querySelectorAll('.team-slots .pc-name')].map((n) => n.textContent)).toEqual([
      'Medicham',
    ]);
    // ...but the missing move is named, not silently swapped for a different one.
    expect(container.textContent).toMatch(/MADE_UP_MOVE_ID/);
  });

  it("shows each saved team's league beside its name", async () => {
    savesApi.listTeams.mockResolvedValue([
      savedTeam('t1', 'GL Squad', ['medicham'], 'great'),
      savedTeam('t2', 'UL Squad', ['registeel'], 'ultra'),
    ]);
    const { container } = await mount(3, fakeSession('ash@example.com'));
    openSavedList(container);
    const rows = await waitFor(() => {
      const r = [...container.querySelectorAll('.team-load-row')];
      if (r.length < 2) throw new Error('saved team rows not rendered yet');
      return r;
    });
    const glRow = rows.find((r) => /GL Squad/.test(r.textContent ?? ''))!;
    const ulRow = rows.find((r) => /UL Squad/.test(r.textContent ?? ''))!;
    expect(glRow.querySelector('.team-load-league')?.textContent).toMatch(/great/i);
    expect(ulRow.querySelector('.team-load-league')?.textContent).toMatch(/ultra/i);
  });

  /**
   * The screen defaults to Great League (AppState's default). Loading a team
   * saved for a different league must not silently field Great-capped IVs in
   * an Ultra slot — see the comment on `loadSaved`. This reuses `loadNotice`,
   * the same mechanism already used for a vanished fast move, rather than a
   * second notice channel.
   */
  it('warns via the load notice when loading a team saved for a different league', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'UL Squad', ['registeel'], 'ultra')]);
    const { container } = await mount(3, fakeSession('ash@example.com'));
    openSavedList(container);
    const loadBtn = await waitFor(() => {
      const b = [...container.querySelectorAll('.team-load-row button')].find((x) =>
        /UL Squad/i.test(x.textContent ?? ''),
      );
      if (!b) throw new Error('saved team row not rendered yet');
      return b as HTMLButtonElement;
    });
    fireEvent.click(loadBtn);

    // The load still happens...
    expect([...container.querySelectorAll('.team-slots .pc-name')].map((n) => n.textContent)).toEqual([
      'Registeel',
    ]);
    // ...but it is not silent: the notice names both leagues involved.
    const notice = container.querySelector('.team-load-notice')?.textContent ?? '';
    expect(notice).toMatch(/UL Squad/);
    expect(notice).toMatch(/ultra/i);
  });

  it('does not warn when loading a team saved for the league already selected', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'], 'great')]);
    const { container } = await mount(3, fakeSession('ash@example.com'));
    openSavedList(container);
    const loadBtn = await waitFor(() => {
      const b = [...container.querySelectorAll('.team-load-row button')].find((x) =>
        /GL Squad/i.test(x.textContent ?? ''),
      );
      if (!b) throw new Error('saved team row not rendered yet');
      return b as HTMLButtonElement;
    });
    fireEvent.click(loadBtn);
    expect(container.querySelector('.team-load-notice')).toBeNull();
  });

  it('asks for confirmation before deleting, and calls deleteTeam only after confirming', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t3', 'Old Team', ['medicham'])]);
    const { container } = await mount(3, fakeSession('ash@example.com'));

    openSavedList(container);
    const row = await waitFor(() => {
      const r = container.querySelector('.team-load-row');
      if (!r) throw new Error('saved team row not rendered yet');
      return r as HTMLElement;
    });
    const deleteBtn = [...row.querySelectorAll('button')].find((b) => /Delete/i.test(b.textContent ?? ''))!;

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(deleteBtn);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(savesApi.deleteTeam).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    await waitFor(() => expect(savesApi.deleteTeam).toHaveBeenCalledWith('t3'));

    confirmSpy.mockRestore();
  });
});

/**
 * Saving under a name that is already taken.
 *
 * `saveTeam`'s update path took an `id` from the day it was written and had no
 * caller: every save from this screen omitted `id`, so every save inserted, and
 * saving twice under one name left two rows with the same label in the load
 * list and no way to tell them apart. These tests are about which of the two
 * branches the screen reaches, so they assert on the `id` argument — the only
 * thing that distinguishes them.
 */
describe('saving over an existing roster', () => {
  const session = () => fakeSession('ash@example.com');

  /** Build a roster and type `name` into the save box. */
  async function rosterNamed(container: HTMLElement, name: string) {
    await pick(container, 'azumarill');
    await pick(container, 'registeel');
    fireEvent.change(nameInput(container), { target: { value: name } });
  }

  it('asks first, then updates the existing row instead of inserting a second one', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
    const { container } = await mount(3, session());
    await rosterNamed(container, 'GL Squad');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
    const arg = savesApi.saveTeam.mock.calls[0][0] as { id?: string; name: string; members: { ref: string }[] };
    expect(arg.id).toBe('t1');
    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel']);
    confirmSpy.mockRestore();
  });

  it('writes nothing at all when the replacement is declined', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
    const { container } = await mount(3, session());
    await rosterNamed(container, 'GL Squad');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Not "inserted a copy instead" — declining a replacement means nothing is
    // written, and the typed name stays put so it can be edited into a new one.
    expect(savesApi.saveTeam).not.toHaveBeenCalled();
    expect(nameInput(container).value).toBe('GL Squad');
    confirmSpy.mockRestore();
  });

  it('treats a name differing only in case or surrounding space as the same roster', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
    const { container } = await mount(3, session());
    await rosterNamed(container, '  gl squad  ');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });

    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
    const arg = savesApi.saveTeam.mock.calls[0][0] as { id?: string; name: string };
    expect(arg.id).toBe('t1');
    // The typed spelling wins — they retyped it, so the row takes the new one.
    expect(arg.name).toBe('gl squad');
    confirmSpy.mockRestore();
  });

  it('inserts without asking when the name is free', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
    const { container } = await mount(3, session());
    await rosterNamed(container, 'A Different Name');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });

    // The guard that matters in the other direction: a prompt on every save,
    // or an `id` on a fresh name, would silently overwrite an unrelated roster.
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
    expect((savesApi.saveTeam.mock.calls[0][0] as { id?: string }).id).toBeUndefined();
    confirmSpy.mockRestore();
  });

  it('names both leagues when the roster being replaced was built for a different one', async () => {
    savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'UL Squad', ['registeel'], 'ultra')]);
    const { container } = await mount(3, session());
    await rosterNamed(container, 'UL Squad');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });

    // saveTeam's update path rewrites `league`, so this replacement changes
    // which cap the roster is judged under. Saying so is the difference
    // between a replacement and a surprise.
    const asked = confirmSpy.mock.calls[0][0] as string;
    expect(asked).toContain('Ultra 2500');
    expect(asked).toContain('Great 1500');
    confirmSpy.mockRestore();
  });

  it('replaces the most recently updated row when older duplicates share the name', async () => {
    // listTeams orders by updated_at descending, so the first match is the
    // newest. Duplicates can exist from before this screen could overwrite.
    savesApi.listTeams.mockResolvedValue([
      savedTeam('newest', 'GL Squad', ['medicham']),
      savedTeam('older', 'GL Squad', ['skarmory']),
    ]);
    const { container } = await mount(3, session());
    await rosterNamed(container, 'GL Squad');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      fireEvent.click(saveButton(container)!);
    });

    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
    expect((savesApi.saveTeam.mock.calls[0][0] as { id?: string }).id).toBe('newest');
    expect(confirmSpy.mock.calls[0][0] as string).toMatch(/2 saved rosters/i);
    confirmSpy.mockRestore();
  });
});
