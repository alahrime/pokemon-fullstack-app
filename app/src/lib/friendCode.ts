import { supabase } from './supabase';

/**
 * The friend code.
 *
 * It is the payoff of the whole matchmaking milestone — the one thing an
 * opponent is shown once a match pairs the two of you — and until now nothing
 * in the app could write one. Everything else about a match is arranged here;
 * the actual battle happens in Pokémon GO, which can only be reached by adding
 * somebody as a friend, and that needs this number.
 *
 * Twelve digits, which the game itself displays in groups of four. Stored
 * normalized, so `#### #### ####` is the ONLY form the column ever holds:
 * `20260904..._friend_codes_are_twelve_digits.sql` spells the same rule as a
 * check constraint, because a format the client merely agrees to is not a
 * format — the seeder, a future admin script and a hand-written psql insert all
 * write this column too.
 */
export const FRIEND_CODE_PATTERN = /^[0-9]{4} [0-9]{4} [0-9]{4}$/;

/** Said in one place: the screens, this module's guard and the tests agree. */
export const FRIEND_CODE_HINT = 'A friend code is twelve digits, as shown in Pokémon GO.';

/**
 * The typed form to the stored form, or null if it is not a friend code.
 *
 * Separators are forgiven — people paste `1234-5678-9012` and read codes off
 * screenshots with odd spacing — but only separators. Stripping every
 * non-digit and counting what survived would accept a trainer name with twelve
 * digits buried in it, so the allowed characters are named rather than the
 * rejected ones.
 */
export function normalizeFriendCode(raw: string): string | null {
  if (!/^[\s\-.]*(?:[0-9][\s\-.]*){12}$/.test(raw)) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

/**
 * Who is asking. `getSession` reads the token this tab already holds rather
 * than asking the Auth server, the same call and for the same reason as
 * `matchmaking.ts` — see the note in `SessionContext.tsx`.
 */
async function meId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * The signed-in account's own code, or null when there is none on file.
 *
 * No `.single()`: an account with no code yet is zero rows, which is the
 * ordinary state of every account made before this screen existed, not an
 * error. A real error still throws — reporting "no code on file" when the
 * truth is an expired token would have someone retype a number that was
 * already there.
 */
export async function myFriendCode(): Promise<string | null> {
  const id = await meId();
  if (!id) return null;
  const { data, error } = await supabase.from('friend_codes').select('code').eq('profile_id', id);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { code: string }[])[0]?.code ?? null;
}

/**
 * Write the code, replacing whatever was there.
 *
 * An upsert rather than an insert because a friend code is not immutable the
 * way `display_name` is: people reinstall the game and are issued a new one,
 * and the alternative is an account that can never be battled again.
 *
 * The validity check is here and not only in the screen so that the failure
 * arrives as this sentence rather than as a Postgres check violation the
 * caller would have to translate back into one. `profile_id` is sent
 * explicitly — unlike `teams.owner_id` this column has no `auth.uid()` default
 * — and the policy on the table checks it against the caller regardless.
 */
export async function saveFriendCode(raw: string): Promise<string> {
  const code = normalizeFriendCode(raw);
  if (!code) throw new Error(FRIEND_CODE_HINT);
  const id = await meId();
  if (!id) throw new Error('You are not signed in.');
  const { error } = await supabase
    .from('friend_codes')
    .upsert({ profile_id: id, code, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' });
  if (error) throw new Error(error.message);
  return code;
}
