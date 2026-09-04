import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/SessionContext';
import { MINIMUM_AGE, isOldEnough, isRealDate } from '../lib/age';
import { clearOAuthUrlError, readOAuthUrlError } from '../lib/oauthError';
import { FRIEND_CODE_HINT, myFriendCode, normalizeFriendCode, saveFriendCode } from '../lib/friendCode';

/**
 * The account screen: an age gate, then a way in, then whatever the account is
 * still missing.
 *
 * Four things here are load-bearing and easy to mistake for ceremony.
 *
 * **The age gate is in front of both sign-in methods**, not beside them. Put it
 * after the provider button and someone signs in with Discord — creating a real
 * account — before ever being asked how old they are. It is also asked as a
 * neutral date of birth rather than "are you 13?", which only ever collects the
 * answer it telegraphs.
 *
 * **A signed-in account with no profile is an ordinary state, not an error.**
 * Two paths reach it: a display_name taken between signup and confirmation (the
 * database forgives that collision rather than stranding the account — see
 * supabase/migrations/20260901160626_*), and any provider signup, which carries
 * none of the fields `profiles` requires. Both land here with a session, which
 * is what makes the fix possible: the ordinary insert policy applies, so the
 * client can write its own profile once it has asked for a name that is free.
 *
 * **Terms are accepted wherever a profile is created**, which is the email
 * registration form and the complete-your-profile form — not merely in front of
 * the provider button. That is the only arrangement where the recorded
 * `tos_accepted_at` is true for every account, including one made with Discord.
 *
 * **The friend code is asked for on both of those forms as well**, for the same
 * reason and not as a fifth optional field: a match arranged in Paragon/IV is
 * played in Pokémon GO, which can only be reached by adding somebody as a
 * friend. An account without a code can queue, accept and confirm and then
 * hand its opponent nothing, which is the shape M2a shipped in. Asking at
 * creation is what makes it true of every account made from here on; the
 * signed-in view below asks the accounts that predate this, and lets anyone
 * change a code the game has since reissued.
 */

/**
 * Which provider the button offers.
 *
 * `signInWithOAuth` is provider-agnostic, so this is the whole cost of the
 * choice: switching to `google` or `github` is this constant and a dashboard
 * toggle. Discord because it needs no billing account (Google Cloud demands
 * one) and it is where competitive GO PvP already organises.
 */
const OAUTH_PROVIDER = 'discord';
const OAUTH_LABEL = 'Discord';

/**
 * The gate's answer, remembered per device.
 *
 * Not a convenience: the provider button navigates away to Discord and back, so
 * an answer held only in component state is gone by the time the session
 * exists — and the birth date is needed then, to write the profile.
 */
const BIRTH_DATE_KEY = 'paragon.birth-date';

/** The placeholder terms. A real document at a real URL, from the first signup. */
export const TERMS_URL = `${import.meta.env.BASE_URL}terms.html`;

function storedBirthDate(): string | null {
  try {
    const raw = window.localStorage.getItem(BIRTH_DATE_KEY);
    return raw && isRealDate(raw) ? raw : null;
  } catch {
    return null;
  }
}

interface Profile {
  display_name: string;
  go_username: string;
}

/** What the profile fetch knows: not yet asked, absent, or here. */
type ProfileState = 'unknown' | 'missing' | Profile;

export function SignInScreen({ now = new Date() }: { now?: Date }) {
  const { user, loading, signOut } = useSession();
  const [birthDate, setBirthDate] = useState<string | null>(storedBirthDate);
  const [profile, setProfile] = useState<ProfileState>('unknown');

  const [dateDraft, setDateDraft] = useState('');
  const [mode, setMode] = useState<'register' | 'signin'>('register');
  const [displayName, setDisplayName] = useState('');
  const [goUsername, setGoUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [friendCode, setFriendCode] = useState('');
  const [terms, setTerms] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * The signed-in account's own code: 'unknown' until asked, null when there
   * is none on file. The two are not the same state and must not render the
   * same — "no friend code yet" shown while the answer is still in flight is
   * an invitation to retype a number that is already there.
   */
  const [code, setCode] = useState<string | null | 'unknown'>('unknown');
  const [codeDraft, setCodeDraft] = useState('');
  const [editingCode, setEditingCode] = useState(false);

  /**
   * The one piece of information that would diagnose a failed Discord round
   * trip: Supabase reports it only on the URL it redirects back to, never
   * through an API call, and — for the error case specifically — never
   * clears it itself (`lib/oauthError.ts`). Read once on mount, then cleared
   * immediately: the value has nowhere else to live, and a later refresh
   * must not resurrect a failure that already happened as if it just did.
   */
  useEffect(() => {
    const err = readOAuthUrlError();
    if (!err) return;
    clearOAuthUrlError();
    setMessage(`${OAUTH_LABEL} sign-in didn't complete: ${err.description}${err.code ? ` (${err.code})` : ''}`);
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, go_username')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      setMessage(error.message);
      return;
    }
    setProfile((data as Profile | null) ?? 'missing');
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile('unknown');
      setCode('unknown');
      return;
    }
    let live = true;
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('display_name, go_username')
        .eq('id', user.id)
        .maybeSingle();
      if (live) setProfile((data as Profile | null) ?? 'missing');
      // Separate table, separate policy, separate failure: a friend code that
      // cannot be read is not a reason to withhold the profile that could.
      try {
        const mine = await myFriendCode();
        if (live) setCode(mine);
      } catch (e) {
        if (live) setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [user]);

  function submitAge(e: FormEvent) {
    e.preventDefault();
    if (!isRealDate(dateDraft)) {
      setMessage('Enter your date of birth as year, month and day.');
      return;
    }
    setMessage('');
    try {
      window.localStorage.setItem(BIRTH_DATE_KEY, dateDraft);
    } catch {
      // A browser refusing storage is not a reason to block registration; the
      // date simply will not survive a provider round trip.
    }
    setBirthDate(dateDraft);
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return setMessage('Choose a display name.');
    if (!goUsername.trim()) return setMessage('Enter your Pokémon GO trainer name.');
    if (!email.trim()) return setMessage('Enter your email address.');
    if (password.length < 8) return setMessage('Use a password of at least 8 characters.');
    const registerCode = normalizeFriendCode(friendCode);
    if (!registerCode) return setMessage(FRIEND_CODE_HINT);
    if (!terms) return setMessage('Accept the terms to create an account.');

    setBusy(true);
    setMessage('');
    // The five fields the trigger reads out of signup metadata — four for the
    // profile, one for the friend code. Email is deliberately not among them:
    // auth.users.email is the identity anchor, and a second copy in profiles
    // would drift from it.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          display_name: displayName.trim(),
          go_username: goUsername.trim(),
          birth_date: birthDate,
          // Normalized here, and checked again in SQL before it is written:
          // `handle_confirmed_user` ignores metadata that is not twelve digits
          // rather than trusting this form, because signup metadata is
          // client-supplied and this is not the only client that could send it.
          friend_code: registerCode,
          tos_accepted_at: new Date().toISOString(),
        },
      },
    });
    setBusy(false);
    if (error) return setMessage(error.message);
    // With confirmation required there is no session yet, and there will not be
    // one until the emailed link is followed.
    if (!data?.session) {
      setNotice(`Check ${email.trim()} for a link to confirm the account.`);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setMessage('Enter your email address.');
    if (!password) return setMessage('Enter your password.');
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMessage(error.message);
  }

  async function continueWithProvider() {
    setMessage('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: OAUTH_PROVIDER,
      options: { redirectTo: window.location.origin },
    });
    if (error) setMessage(error.message);
  }

  async function completeProfile(e: FormEvent) {
    e.preventDefault();
    if (!user || !birthDate) return;
    if (!displayName.trim()) return setMessage('Choose a display name.');
    if (!goUsername.trim()) return setMessage('Enter your Pokémon GO trainer name.');
    if (!normalizeFriendCode(friendCode)) return setMessage(FRIEND_CODE_HINT);
    if (!terms) return setMessage('Accept the terms to finish setting up your account.');

    setBusy(true);
    setMessage('');
    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      display_name: displayName.trim(),
      go_username: goUsername.trim(),
      birth_date: birthDate,
      tos_accepted_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      // 23505 is a unique violation, and display_name is the only unique column
      // anyone can collide with here.
      setMessage(
        error.code === '23505'
          ? 'That display name is taken. Choose another.'
          : error.message,
      );
      return;
    }
    // After the profile, never before: `friend_codes.profile_id` references it,
    // so the reverse order is a foreign-key violation on every provider signup.
    // A failure here leaves a real, usable account whose only missing piece is
    // the code — which the signed-in view then asks for — so it is reported
    // rather than raised.
    try {
      setCode(await saveFriendCode(friendCode));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    await loadProfile(user.id);
  }

  /**
   * The signed-in view's save. Separate from the forms above because it is the
   * only one that runs against an account that already exists: every account
   * made before this screen collected a code arrives here, as does anyone whose
   * code the game reissued after a reinstall.
   */
  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!normalizeFriendCode(codeDraft)) return setMessage(FRIEND_CODE_HINT);
    setBusy(true);
    setMessage('');
    try {
      setCode(await saveFriendCode(codeDraft));
      setEditingCode(false);
      setNotice('Friend code saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const termsBox = (
    <label className="account-terms">
      <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
      <span>
        I accept the{' '}
        <a href={TERMS_URL} target="_blank" rel="noreferrer">
          terms of service
        </a>
        .
      </span>
    </label>
  );

  /**
   * Shared by the two forms that create an account, the way `termsBox` is: the
   * field is the same question in both places, and a second copy is a second
   * thing to keep in step.
   */
  const friendCodeField = (
    <>
      <label className="hud-label" htmlFor="friend-code">
        Pokémon GO friend code
      </label>
      <input
        id="friend-code"
        className="input"
        inputMode="numeric"
        autoComplete="off"
        placeholder="1234 5678 9012"
        value={friendCode}
        onChange={(e) => setFriendCode(e.target.value)}
      />
      <p className="account-note">
        {FRIEND_CODE_HINT} An opponent is shown it only once a match pairs the two of you — it is how
        you add each other in the game to actually battle.
      </p>
    </>
  );

  const alert = message ? (
    <p className="account-alert" role="alert">
      {message}
    </p>
  ) : null;

  function body() {
    if (loading) {
      return <p className="account-note">Checking whether you are already signed in…</p>;
    }

    if (user && profile === 'unknown') {
      return <p className="account-note">Loading your profile…</p>;
    }

    /**
     * An account that already has a profile has already been through the gate,
     * so it is not asked again — re-asking someone their date of birth every
     * time they clear their browser storage is friction with nothing behind it.
     * Every path that can still CREATE an account is below the gate.
     */
    if (user && typeof profile === 'object') {
      return (
        <div className="account-form">
          <p className="account-note">
            Signed in as <strong>{user.email}</strong>.
          </p>
          <dl className="account-summary">
            <dt className="hud-label">Display name</dt>
            <dd>{profile.display_name}</dd>
            <dt className="hud-label">Trainer name</dt>
            <dd>{profile.go_username}</dd>
            <dt className="hud-label">Friend code</dt>
            <dd>
              {code === 'unknown'
                ? 'Loading…'
                : (code ?? 'Not set — an opponent you match with has no way to add you.')}
            </dd>
          </dl>
          {/*
            An account with no code on file gets the form outright, not a
            button that reveals one. Every account made before this screen
            existed is in that state, and it is the state that quietly breaks
            matchmaking, so it is worth one step rather than two.
          */}
          {code !== 'unknown' &&
            (editingCode || code === null ? (
              <form className="account-form" onSubmit={submitCode}>
                <label className="hud-label" htmlFor="account-friend-code">
                  Pokémon GO friend code
                </label>
                <input
                  id="account-friend-code"
                  className="input"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="1234 5678 9012"
                  value={codeDraft}
                  onChange={(e) => setCodeDraft(e.target.value)}
                />
                <p className="account-note">
                  {FRIEND_CODE_HINT} An opponent is shown it only once a match pairs the two of you.
                </p>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Save friend code
                </button>
                {code !== null && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setEditingCode(false);
                      setMessage('');
                    }}
                  >
                    Cancel
                  </button>
                )}
              </form>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setCodeDraft(code);
                  setEditingCode(true);
                  setNotice('');
                  setMessage('');
                }}
              >
                Change friend code
              </button>
            ))}
          {notice ? (
            <p className="account-note" role="status">
              {notice}
            </p>
          ) : null}
          {alert}
          <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      );
    }

    // The gate, in front of everything that could still create an account —
    // both sign-in methods and the finish-your-profile form a provider signup
    // lands on.
    if (!birthDate) {
      return (
        <form className="account-form" onSubmit={submitAge}>
          <label className="hud-label" htmlFor="birth-date">
            Date of birth
          </label>
          <input
            id="birth-date"
            className="input"
            type="date"
            value={dateDraft}
            onChange={(e) => setDateDraft(e.target.value)}
          />
          <p className="account-note">
            Asked once, before an account can be made. Paragon/IV is for people aged{' '}
            {MINIMUM_AGE} and over.
          </p>
          {alert}
          <button type="submit" className="btn btn-primary">
            Continue
          </button>
        </form>
      );
    }

    if (!isOldEnough(birthDate, now)) {
      return (
        <div className="account-form" role="alert">
          <p className="account-alert">
            You need to be at least {MINIMUM_AGE} to hold a Paragon/IV account.
          </p>
          <p className="account-note">
            That answer is recorded on this device, and there is no account to make here. The rest
            of Paragon/IV — every ranking, every simulation — needs no account at all, so nothing
            about the analysis is closed to you.
          </p>
        </div>
      );
    }

    // Signed in, with nothing to show for it yet. Reached by a provider signup,
    // which collects none of this, or by losing a display-name race.
    if (user && profile === 'missing') {
      return (
        <form className="account-form" onSubmit={completeProfile}>
          <p className="account-note">
            Your account exists and is signed in as <strong>{user.email}</strong>. It needs a name
            before anyone else can see it.
          </p>
          <label className="hud-label" htmlFor="display-name">
            Display name
          </label>
          <input
            id="display-name"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <label className="hud-label" htmlFor="go-username">
            Pokémon GO trainer name
          </label>
          <input
            id="go-username"
            className="input"
            value={goUsername}
            onChange={(e) => setGoUsername(e.target.value)}
          />
          <p className="account-note">
            Your trainer name is how an opponent's battle journal identifies you in a dispute. It
            is not verified, and it does not have to be unique.
          </p>
          {friendCodeField}
          {termsBox}
          {alert}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Finish setting up
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </form>
      );
    }

    // Old enough, not signed in.
    return (
      <div className="account-form">
        <div className="account-modes">
          <button
            type="button"
            className={`btn chip-btn${mode === 'register' ? ' is-active' : ''}`}
            onClick={() => {
              setMode('register');
              setMessage('');
            }}
          >
            Create account
          </button>
          <button
            type="button"
            className={`btn chip-btn${mode === 'signin' ? ' is-active' : ''}`}
            onClick={() => {
              setMode('signin');
              setMessage('');
            }}
          >
            Sign in
          </button>
        </div>

        {notice ? <p className="account-note" role="status">{notice}</p> : null}

        {mode === 'register' ? (
          <form className="account-form" onSubmit={register}>
            <label className="hud-label" htmlFor="display-name">
              Display name
            </label>
            <input
              id="display-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <label className="hud-label" htmlFor="go-username">
              Pokémon GO trainer name
            </label>
            <input
              id="go-username"
              className="input"
              value={goUsername}
              onChange={(e) => setGoUsername(e.target.value)}
            />
            <label className="hud-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="hud-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {friendCodeField}
            {termsBox}
            {alert}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Create account
            </button>
          </form>
        ) : (
          <form className="account-form" onSubmit={signIn}>
            <label className="hud-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="hud-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {alert}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Sign in
            </button>
          </form>
        )}

        <div className="account-oauth">
          <span className="account-note">or</span>
          <button type="button" className="btn btn-secondary" onClick={() => void continueWithProvider()}>
            Continue with {OAUTH_LABEL}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Account"
        blurb="An account is only needed for the parts other people can see. Every ranking and every simulation works without one."
      />
      <div className="panel account-panel">{body()}</div>
    </>
  );
}
