import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/SessionContext';
import { MINIMUM_AGE, isOldEnough, isRealDate } from '../lib/age';
import { clearOAuthUrlError, readOAuthUrlError } from '../lib/oauthError';

/**
 * The account screen: an age gate, then a way in, then whatever the account is
 * still missing.
 *
 * Three things here are load-bearing and easy to mistake for ceremony.
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
  const [terms, setTerms] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
    if (!terms) return setMessage('Accept the terms to create an account.');

    setBusy(true);
    setMessage('');
    // The four fields the profile trigger reads out of signup metadata. Email
    // is deliberately not among them: auth.users.email is the identity anchor,
    // and a second copy in profiles would drift from it.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          display_name: displayName.trim(),
          go_username: goUsername.trim(),
          birth_date: birthDate,
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
    await loadProfile(user.id);
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
          </dl>
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
