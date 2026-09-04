import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, cleanup, type RenderResult } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { Session } from '@supabase/supabase-js';

/**
 * The account screen: the age gate, the two ways in, and the state where an
 * account exists but a profile does not.
 *
 * The whole Supabase package is mocked at its boundary, so nothing here reaches
 * a database — but the shape of the mock is not invented. `getSession`,
 * `onAuthStateChange`, `signOut` and the `from().select().eq().maybeSingle()`
 * chain were each checked against the real client on a running stack before
 * this file was written, because a suite that passes against a fictional API
 * proves nothing about the screen.
 *
 * The clock is fixed. The 13-year boundary computed from `Date.now()` would
 * pass today and start failing on somebody's birthday.
 */
const NOW = new Date(2026, 8, 1); // 1 September 2026

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

function fakeSession(email: string): Session {
  return { access_token: 'tok', user: { id: 'user-1', email } } as unknown as Session;
}

interface HarnessOptions {
  session?: Session | null;
  /** What `profiles` returns for this user: a row, or null for "no profile". */
  profile?: { display_name: string; go_username: string } | null;
  /** Forced error from the profile insert. */
  insertError?: { code?: string; message: string } | null;
  /** What `friend_codes` holds for this user; null for "none on file". */
  friendCode?: string | null;
  /** Forced error from the friend-code upsert. */
  codeError?: { code?: string; message: string } | null;
}

function fakeClient({
  session = null,
  profile = null,
  insertError = null,
  friendCode = null,
  codeError = null,
}: HarnessOptions) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signUp: vi.fn(async (_args: unknown) => ({ data: { session: null, user: {} }, error: null })),
    signInWithPassword: vi.fn(async (_args: unknown) => ({ data: { session }, error: null })),
    signInWithOAuth: vi.fn(async (_args: unknown) => ({ data: { url: 'https://discord/auth' }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  const insert = vi.fn(async (_row: unknown) => ({ error: insertError }));
  const table = {
    select: vi.fn(() => table),
    eq: vi.fn(() => table),
    maybeSingle: vi.fn(async () => ({ data: profile, error: null })),
    insert,
  };
  /**
   * `friend_codes` is a second table with a second policy, and routing both
   * through one stub was how the first version of this harness let
   * `myFriendCode` "succeed" by awaiting an object with no `then` — undefined
   * data, undefined error, and a null answer that looked like "none on file"
   * whatever the database would have said. `then` is here because the real
   * query is awaited without `.single()`: zero rows is the ordinary state.
   */
  const upsert = vi.fn(async (_row: unknown, _opts?: unknown) => ({ error: codeError }));
  const codes = {
    select: vi.fn(() => codes),
    eq: vi.fn(() => codes),
    upsert,
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: friendCode === null ? [] : [{ code: friendCode }], error: null }).then(res),
  };
  pkg.client = { auth, from: vi.fn((name: string) => (name === 'friend_codes' ? codes : table)) };
  return { auth, table, insert, upsert };
}

async function mount(options: HarnessOptions = {}) {
  const stub = fakeClient(options);
  vi.resetModules();
  const { SessionProvider } = await import('../../state/SessionContext');
  const { SignInScreen } = await import('../SignInScreen');
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <SessionProvider>
        <SignInScreen now={NOW} />
      </SessionProvider>,
    );
  });
  return { ...stub, view, container: view.container };
}

/** Pass the age gate with a date that clears 13. */
async function passAgeGate(container: HTMLElement, date = '2000-05-04') {
  const input = container.querySelector('#birth-date') as HTMLInputElement;
  fireEvent.change(input, { target: { value: date } });
  await act(async () => {
    fireEvent.submit(input.closest('form')!);
  });
}

const text = (c: HTMLElement) => c.textContent ?? '';
const button = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the age gate', () => {
  it('asks for a date of birth before offering any way to sign in', async () => {
    const { container } = await mount();
    expect(container.querySelector('#birth-date')).toBeTruthy();
    expect(container.querySelector('#email')).toBeFalsy();
    expect(container.querySelector('#password')).toBeFalsy();
    expect(button(container, 'Discord')).toBeUndefined();
  });

  /** Not "are you 13?", which only ever collects the answer it telegraphs. */
  it('asks neutrally, without naming the answer that gets you in', async () => {
    const { container } = await mount();
    const label = container.querySelector('label[for="birth-date"]');
    expect(label?.textContent).toMatch(/date of birth/i);
    expect(text(container)).not.toMatch(/are you|confirm that you are|13 or over\?/i);
  });

  it('refuses an under-13 and offers no way in at all', async () => {
    const { container } = await mount();
    await passAgeGate(container, '2014-09-02'); // 12, one day short of 13
    expect(text(container)).toMatch(/at least 13/i);
    expect(container.querySelector('#email')).toBeFalsy();
    expect(container.querySelector('#password')).toBeFalsy();
    expect(button(container, 'Discord')).toBeUndefined();
    expect(button(container, 'Create account')).toBeUndefined();
    expect(button(container, 'Sign in')).toBeUndefined();
  });

  it('admits someone who turns 13 today, and refuses one day short', async () => {
    const older = await mount();
    await passAgeGate(older.container, '2013-09-01');
    expect(older.container.querySelector('#email')).toBeTruthy();

    cleanup();
    localStorage.clear();

    const younger = await mount();
    await passAgeGate(younger.container, '2013-09-02');
    expect(younger.container.querySelector('#email')).toBeFalsy();
    expect(text(younger.container)).toMatch(/at least 13/i);
  });

  it('rejects a malformed date as a typo rather than as an age', async () => {
    const { container } = await mount();
    await passAgeGate(container, '');
    expect(text(container)).toMatch(/date of birth as year, month and day/i);
    expect(text(container)).not.toMatch(/at least 13/i);
  });

  /** The provider round trip leaves the page; an answer in state would not survive. */
  it('remembers the answer, so it survives leaving for the provider and coming back', async () => {
    const first = await mount();
    await passAgeGate(first.container, '2000-05-04');
    expect(localStorage.getItem('paragon.birth-date')).toBe('2000-05-04');

    cleanup();
    const again = await mount();
    expect(again.container.querySelector('#birth-date')).toBeFalsy();
    expect(again.container.querySelector('#email')).toBeTruthy();
  });

  it('reveals both ways in once the gate is passed', async () => {
    const { container } = await mount();
    await passAgeGate(container);
    expect(container.querySelector('#email')).toBeTruthy();
    expect(container.querySelector('#password')).toBeTruthy();
    expect(button(container, `Continue with Discord`)).toBeTruthy();
  });
});

describe('registration', () => {
  async function ready(options: HarnessOptions = {}) {
    const h = await mount(options);
    await passAgeGate(h.container);
    return h;
  }

  const fill = (c: HTMLElement, id: string, value: string) =>
    fireEvent.change(c.querySelector(id) as HTMLInputElement, { target: { value } });

  async function submit(c: HTMLElement, label = 'Create account') {
    const btn = [...c.querySelectorAll('button[type="submit"]')].find((b) =>
      b.textContent?.includes(label),
    )!;
    await act(async () => {
      fireEvent.submit(btn.closest('form')!);
    });
  }

  async function fillAll(c: HTMLElement) {
    fill(c, '#display-name', 'AshK');
    fill(c, '#go-username', 'AshKetchum99');
    fill(c, '#email', 'ash@example.com');
    fill(c, '#password', 'correct horse battery');
    fill(c, '#friend-code', '1234 5678 9012');
  }

  it('refuses to submit without a Pokémon GO trainer name', async () => {
    const { container, auth } = await ready();
    fill(container, '#display-name', 'AshK');
    fill(container, '#email', 'ash@example.com');
    fill(container, '#password', 'correct horse battery');
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await submit(container);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(text(container)).toMatch(/trainer name/i);
  });

  it('refuses to submit without a display name', async () => {
    const { container, auth } = await ready();
    fill(container, '#go-username', 'AshKetchum99');
    fill(container, '#email', 'ash@example.com');
    fill(container, '#password', 'correct horse battery');
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await submit(container);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(text(container)).toMatch(/display name/i);
  });

  it('refuses to submit with the terms unticked', async () => {
    const { container, auth } = await ready();
    await fillAll(container);
    await submit(container);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(text(container)).toMatch(/accept the terms/i);
  });

  it('signs up with everything the profile trigger reads, and no second copy of the email', async () => {
    const { container, auth } = await ready();
    await fillAll(container);
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await submit(container);

    expect(auth.signUp).toHaveBeenCalledTimes(1);
    const arg = auth.signUp.mock.calls[0][0] as {
      email: string;
      password: string;
      options: { data: Record<string, string> };
    };
    expect(arg.email).toBe('ash@example.com');
    expect(arg.options.data.display_name).toBe('AshK');
    expect(arg.options.data.go_username).toBe('AshKetchum99');
    expect(arg.options.data.birth_date).toBe('2000-05-04');
    expect(arg.options.data.tos_accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // auth.users.email is the identity anchor; a copy in the profile metadata
    // would be a second source of truth to drift.
    expect(Object.keys(arg.options.data)).not.toContain('email');
  });

  it('says to check the inbox rather than pretending it signed you in', async () => {
    const { container } = await ready();
    await fillAll(container);
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await submit(container);
    expect(text(container)).toMatch(/check ash@example\.com/i);
  });

  /**
   * The friend code is required here for the same reason the trainer name is:
   * a match arranged in Paragon/IV is played in Pokémon GO, and an account
   * with no code hands its opponent nothing at the end of the handshake.
   */
  it('refuses to submit without a friend code', async () => {
    const { container, auth } = await ready();
    fill(container, '#display-name', 'AshK');
    fill(container, '#go-username', 'AshKetchum99');
    fill(container, '#email', 'ash@example.com');
    fill(container, '#password', 'correct horse battery');
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await submit(container);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(text(container)).toMatch(/twelve digits/i);
  });

  it('refuses a trainer name typed into the friend code box', async () => {
    const { container, auth } = await ready();
    await fillAll(container);
    fill(container, '#friend-code', 'AshKetchum99');
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await submit(container);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  /**
   * There is no session at registration time — the row cannot be written until
   * the emailed link is followed — so the code travels as signup metadata and
   * `handle_confirmed_user` writes it. Normalized before it is sent, because
   * the trigger only accepts the stored spelling.
   */
  it('carries the friend code into signup metadata, normalized', async () => {
    const { container, auth } = await ready();
    await fillAll(container);
    fill(container, '#friend-code', '1234-5678-9012');
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await submit(container);
    const args = auth.signUp.mock.calls[0][0] as { options: { data: Record<string, string> } };
    expect(args.options.data.friend_code).toBe('1234 5678 9012');
  });

  it('links the terms at a document that exists', async () => {
    const { container } = await ready();
    const link = container.querySelector('.account-terms a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/terms.html');
    // Reachable, not merely linked: the file is served from public/.
    const doc = readFileSync('public/terms.html', 'utf8');
    expect(doc).toMatch(/Terms of Service/i);
    expect(doc).toMatch(/at least 13/i);
  });
});

describe('signing in', () => {
  it('calls the password method with what was typed', async () => {
    const { container, auth } = await mount();
    await passAgeGate(container);
    fireEvent.click(button(container, 'Sign in')!);
    fireEvent.change(container.querySelector('#email') as HTMLInputElement, {
      target: { value: 'misty@example.com' },
    });
    fireEvent.change(container.querySelector('#password') as HTMLInputElement, {
      target: { value: 'a-real-password' },
    });
    await act(async () => {
      fireEvent.submit((container.querySelector('#email') as HTMLInputElement).closest('form')!);
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'misty@example.com',
      password: 'a-real-password',
    });
  });

  it('sends the provider button to signInWithOAuth', async () => {
    const { container, auth } = await mount();
    await passAgeGate(container);
    await act(async () => {
      fireEvent.click(button(container, 'Continue with Discord')!);
    });
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    const arg = auth.signInWithOAuth.mock.calls[0][0] as { provider: string };
    expect(arg.provider).toBe('discord');
  });
});

/**
 * The state the database deliberately produces: confirmed, signed in, and with
 * no profile row. A provider signup carries none of the fields `profiles`
 * requires, and a display_name taken between signup and confirmation is
 * forgiven rather than allowed to strand the account.
 */
describe('an account with no profile yet', () => {
  const signedIn = { session: fakeSession('ash@example.com'), profile: null };

  async function ready(extra: HarnessOptions = {}) {
    const h = await mount({ ...signedIn, ...extra });
    await passAgeGate(h.container);
    return h;
  }

  it('asks for a name instead of showing a broken profile', async () => {
    const { container } = await ready();
    expect(container.querySelector('#display-name')).toBeTruthy();
    expect(container.querySelector('#go-username')).toBeTruthy();
    expect(text(container)).toMatch(/needs a name/i);
  });

  it('reads the email from the session rather than from a profile', async () => {
    const { container } = await ready();
    expect(text(container)).toMatch(/ash@example\.com/);
  });

  it('refuses to finish without the terms ticked', async () => {
    const { container, insert } = await ready();
    fireEvent.change(container.querySelector('#display-name') as HTMLInputElement, {
      target: { value: 'AshK' },
    });
    fireEvent.change(container.querySelector('#go-username') as HTMLInputElement, {
      target: { value: 'AshKetchum99' },
    });
    fireEvent.change(container.querySelector('#friend-code') as HTMLInputElement, {
      target: { value: '1234 5678 9012' },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(insert).not.toHaveBeenCalled();
    expect(text(container)).toMatch(/accept the terms/i);
  });

  async function completeIt(container: HTMLElement) {
    fireEvent.change(container.querySelector('#display-name') as HTMLInputElement, {
      target: { value: 'AshK' },
    });
    fireEvent.change(container.querySelector('#go-username') as HTMLInputElement, {
      target: { value: 'AshKetchum99' },
    });
    fireEvent.change(container.querySelector('#friend-code') as HTMLInputElement, {
      target: { value: '1234 5678 9012' },
    });
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
  }

  it('writes a profile carrying the trainer name and the consent timestamp', async () => {
    const { container, insert } = await ready();
    await completeIt(container);

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0] as Record<string, string>;
    expect(row.id).toBe('user-1');
    expect(row.display_name).toBe('AshK');
    expect(row.go_username).toBe('AshKetchum99');
    expect(row.birth_date).toBe('2000-05-04');
    expect(row.tos_accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  /** profiles has no email column, by design. Writing one would fail loudly. */
  it('does not write the email into the profile', async () => {
    const { container, insert } = await ready();
    await completeIt(container);
    expect(Object.keys(insert.mock.calls[0][0] as object)).not.toContain('email');
  });

  it('refuses to finish without a friend code', async () => {
    const { container, insert } = await ready();
    fireEvent.change(container.querySelector('#display-name') as HTMLInputElement, {
      target: { value: 'AshK' },
    });
    fireEvent.change(container.querySelector('#go-username') as HTMLInputElement, {
      target: { value: 'AshKetchum99' },
    });
    fireEvent.click(container.querySelector('.account-terms input') as HTMLInputElement);
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(insert).not.toHaveBeenCalled();
    expect(text(container)).toMatch(/twelve digits/i);
  });

  /**
   * `friend_codes.profile_id` references `profiles`, so the reverse order is a
   * foreign-key violation on every provider signup. Asserted as an ordering,
   * not merely as "both were called".
   */
  it('writes the friend code only after the profile it references', async () => {
    const order: string[] = [];
    const { container, insert, upsert } = await ready();
    insert.mockImplementation(async () => {
      order.push('profile');
      return { error: null };
    });
    upsert.mockImplementation(async () => {
      order.push('friend code');
      return { error: null };
    });
    await completeIt(container);
    expect(order).toEqual(['profile', 'friend code']);
    expect((upsert.mock.calls[0][0] as Record<string, string>).code).toBe('1234 5678 9012');
  });

  it('explains a taken display name instead of showing a database error', async () => {
    const { container } = await ready({
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    await completeIt(container);
    expect(text(container)).toMatch(/taken/i);
    expect(text(container)).not.toMatch(/duplicate key/i);
  });
});

describe('a complete account', () => {
  /**
   * No age gate here, deliberately: an account that already has a profile has
   * been through it, and re-asking on every cleared browser storage is friction
   * with nothing behind it. Everything that can still CREATE an account is
   * still behind the gate.
   */
  it('is not asked its date of birth again', async () => {
    const { container } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
    });
    expect(container.querySelector('#birth-date')).toBeFalsy();
  });

  it('shows the profile and the session email together', async () => {
    const { container } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
    });
    expect(text(container)).toMatch(/ash@example\.com/);
    expect(text(container)).toMatch(/AshK/);
    expect(text(container)).toMatch(/AshKetchum99/);
    expect(button(container, 'Sign out')).toBeTruthy();
  });

  it('shows the friend code already on file', async () => {
    const { container } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
      friendCode: '1234 5678 9012',
    });
    expect(text(container)).toMatch(/1234 5678 9012/);
    // Shown, not sitting in an edit box nobody asked to open.
    expect(container.querySelector('#account-friend-code')).toBeFalsy();
    expect(button(container, 'Change friend code')).toBeTruthy();
  });

  /**
   * Every account made before this screen collected a code is in this state,
   * and it is the state that quietly breaks matchmaking: the account can queue,
   * accept and confirm, and then show its opponent nothing. So the form is
   * there outright rather than behind a button.
   */
  it('asks outright when there is no code on file', async () => {
    const { container } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
      friendCode: null,
    });
    expect(container.querySelector('#account-friend-code')).toBeTruthy();
    expect(text(container)).toMatch(/no way to add you/i);
  });

  it('saves a code typed with any separators, and shows it back', async () => {
    const { container, upsert } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
      friendCode: null,
    });
    fireEvent.change(container.querySelector('#account-friend-code') as HTMLInputElement, {
      target: { value: '1234-5678-9012' },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('#account-friend-code')!.closest('form')!);
    });
    expect((upsert.mock.calls[0][0] as Record<string, string>).code).toBe('1234 5678 9012');
    expect(text(container)).toMatch(/1234 5678 9012/);
    expect(text(container)).toMatch(/saved/i);
  });

  it('refuses a malformed code without asking the database', async () => {
    const { container, upsert } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
      friendCode: null,
    });
    fireEvent.change(container.querySelector('#account-friend-code') as HTMLInputElement, {
      target: { value: '12345' },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('#account-friend-code')!.closest('form')!);
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(text(container)).toMatch(/twelve digits/i);
  });

  /** A refused write must not leave the screen claiming the code was saved. */
  it('reports a refused write instead of showing the code as saved', async () => {
    const { container } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
      friendCode: null,
      codeError: { code: '42501', message: 'new row violates row-level security policy' },
    });
    fireEvent.change(container.querySelector('#account-friend-code') as HTMLInputElement, {
      target: { value: '1234 5678 9012' },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('#account-friend-code')!.closest('form')!);
    });
    expect(text(container)).toMatch(/row-level security/i);
    expect(text(container)).not.toMatch(/saved/i);
    expect(container.querySelector('#account-friend-code')).toBeTruthy();
  });

  it('signs out through the session context', async () => {
    const { container, auth } = await mount({
      session: fakeSession('ash@example.com'),
      profile: { display_name: 'AshK', go_username: 'AshKetchum99' },
    });
    await act(async () => {
      fireEvent.click(button(container, 'Sign out')!);
    });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});

/**
 * Supabase reports a failed Discord round trip only on the URL it redirects
 * back to — `#error=...` for the implicit flow, `?error=...` for PKCE — and
 * nothing else ever surfaces it. The birth date is pre-seeded in these tests
 * because it is genuinely already on the device by the time Discord redirects
 * back: the age gate runs before the provider button is ever shown.
 */
describe('an OAuth error returned by the provider', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('reads the error out of the hash fragment and renders it decoded', async () => {
    localStorage.setItem('paragon.birth-date', '2000-05-04');
    window.history.replaceState(
      null,
      '',
      '/#error=server_error&error_code=server_error&error_description=Unable+to+exchange+external+code',
    );
    const { container } = await mount();
    expect(text(container)).toMatch(/unable to exchange external code/i);
    expect(text(container)).toMatch(/server_error/);
    // Never the raw, `+`-encoded provider string.
    expect(text(container)).not.toMatch(/Unable\+to\+exchange/);
  });

  it('reads the same error out of the query string, for the PKCE flow', async () => {
    localStorage.setItem('paragon.birth-date', '2000-05-04');
    window.history.replaceState(
      null,
      '',
      '/?error=access_denied&error_code=access_denied&error_description=User+denied+access',
    );
    const { container } = await mount();
    expect(text(container)).toMatch(/user denied access/i);
    expect(text(container)).toMatch(/access_denied/);
  });

  it('clears the error from the URL once shown, so a refresh cannot resurrect it', async () => {
    localStorage.setItem('paragon.birth-date', '2000-05-04');
    window.history.replaceState(
      null,
      '',
      '/#error=server_error&error_code=server_error&error_description=Unable+to+exchange+external+code',
    );
    await mount();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('');
  });

  it('uses the account screen\'s existing alert, not a second error surface', async () => {
    localStorage.setItem('paragon.birth-date', '2000-05-04');
    window.history.replaceState(
      null,
      '',
      '/#error=server_error&error_code=server_error&error_description=Unable+to+exchange+external+code',
    );
    const { container } = await mount();
    const alerts = container.querySelectorAll('.account-alert');
    expect(alerts.length).toBe(1);
    expect(alerts[0].textContent).toMatch(/unable to exchange external code/i);
  });

  it('reads as a provider failure, not a form-validation complaint', async () => {
    localStorage.setItem('paragon.birth-date', '2000-05-04');
    window.history.replaceState(
      null,
      '',
      '/#error=server_error&error_code=server_error&error_description=Unable+to+exchange+external+code',
    );
    const { container } = await mount();
    const alert = container.querySelector('.account-alert')!;
    expect(alert.textContent).toMatch(/discord/i);
    expect(alert.textContent).not.toMatch(/enter your email|enter your password|choose a display name/i);
  });

  it('says nothing when the URL carries no OAuth error', async () => {
    localStorage.setItem('paragon.birth-date', '2000-05-04');
    const { container } = await mount();
    expect(container.querySelector('.account-alert')).toBeFalsy();
  });
});
