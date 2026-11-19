import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/SessionContext';
import { hashForPlayer } from '../lib/route';
import { MINIMUM_AGE, isOldEnough, isRealDate } from '../lib/age';
import { clearOAuthUrlError, readOAuthUrlError } from '../lib/oauthError';
import { FRIEND_CODE_HINT, myFriendCode, normalizeFriendCode, saveFriendCode } from '../lib/friendCode';

/**
 * The account screen: a way in, then whatever the account is still missing.
 *
 * Four things here are load-bearing and easy to mistake for ceremony.
 *
 * **Age is asked only where a profile is created.** That is the email
 * registration form and the complete-your-profile form — the two places an
 * account becomes something other people can see. Signing back in to an
 * account that already exists asks nothing: that account answered once, when
 * it was made, and re-asking a returning trainer their date of birth every
 * time is friction with nothing behind it. A first-time Discord sign-in lands
 * on the complete-your-profile form, so it is asked there, before any profile
 * exists; an answer under {@link MINIMUM_AGE} signs that session straight back
 * out without writing one. It is asked as a neutral date of birth rather than
 * "are you 13?", which only ever collects the answer it telegraphs.
 *
 * **A signed-in account with no profile is an ordinary state, not an error.**
 * Two paths reach it: a display_name taken between signup and confirmation (the
 * database forgives that collision rather than stranding the account — see
 * supabase/migrations/20260901160626_*), and any provider signup, which carries
 * none of the fields `profiles` requires. Both land here with a session, which
 * is what makes the fix possible: the ordinary insert policy applies, so the
 * client can write its own profile once it has asked for a name that is free.
 *
 * **Terms are accepted wherever a profile is created**, for the same reason as
 * the age question: that is the only arrangement where the recorded
 * `tos_accepted_at` is true for every account, including one made with Discord.
 *
 * **The friend code is asked for on both of those forms as well**, and not as
 * an optional extra: a match arranged in Paragon/IV is played in Pokémon GO,
 * which can only be reached by adding somebody as a friend. The signed-in view
 * asks the accounts that predate this, and lets anyone change a code the game
 * has since reissued.
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
 * A refused date of birth, remembered per device.
 *
 * Only a refusal is worth keeping: it is what stops the register form simply
 * being retried with a different year. An accepted date is written to the
 * profile and has no reason to linger in the browser. Older builds stored
 * every answer here, so an accepted one found under this key is used only to
 * prefill the field.
 */
const BIRTH_DATE_KEY = 'paragon.birth-date';

const SESSION_LAPSED =
  "Your sign-in couldn't be confirmed. Check your connection and try again; if it keeps happening, sign out and back in.";

/** The placeholder terms. A real document at a real URL, from the first signup. */
export const TERMS_URL = `${import.meta.env.BASE_URL}terms.html`;

const DATE_TYPO = 'Enter your date of birth as year, month and day.';

function storedBirthDate(): string | null {
  try {
    const raw = window.localStorage.getItem(BIRTH_DATE_KEY);
    return raw && isRealDate(raw) ? raw : null;
  } catch {
    return null;
  }
}

function rememberBirthDate(value: string) {
  try {
    window.localStorage.setItem(BIRTH_DATE_KEY, value);
  } catch {
    // A browser refusing storage only means the refusal is not remembered.
  }
}

interface Profile {
  display_name: string;
  go_username: string;
}

/** What the profile fetch knows: not yet asked, absent, or here. */
type ProfileState = 'unknown' | 'missing' | Profile;

/**
 * One labelled control in the console: an index tick, a mono label, the
 * input, and an optional note under it. The index is decoration — it is
 * hidden from assistive tech so the accessible name stays the plain label.
 */
function Field({
  index,
  id,
  label,
  note,
  children,
}: {
  index: number;
  id: string;
  label: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="acct-field">
      <label className="acct-label" htmlFor={id}>
        <span className="acct-index" aria-hidden="true">
          {String(index).padStart(2, '0')}
        </span>
        {label}
      </label>
      {children}
      {note ? <p className="account-note acct-field-note">{note}</p> : null}
    </div>
  );
}

/** The status lamp in the console header: what this screen knows about you. */
type Link = 'offline' | 'pending' | 'online' | 'locked';

const LINK_TEXT: Record<Link, string> = {
  offline: 'No session',
  pending: 'Handshake',
  online: 'Linked',
  locked: 'Locked',
};

export function SignInScreen({ now = new Date() }: { now?: Date }) {
  const { user, loading, signOut } = useSession();
  const [profile, setProfile] = useState<ProfileState>('unknown');

  /** A date this device already had refused. */
  const [refused, setRefused] = useState<boolean>(() => {
    const stored = storedBirthDate();
    return stored !== null && !isOldEnough(stored, now);
  });
  const [dateDraft, setDateDraft] = useState(() => storedBirthDate() ?? '');
  /**
   * Opens on sign-in: most visits to this screen are a returning trainer, and
   * the age question lives only on the create-account tab, so the common path
   * asks nothing beyond email and password.
   */
  const [mode, setMode] = useState<'register' | 'signin'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [goUsername, setGoUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [friendCode, setFriendCode] = useState('');
  const [terms, setTerms] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  /** The Discord failure read off the URL is the one message a session arriving must not wipe. */
  const keepMessage = useRef(false);
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
    keepMessage.current = true;
    setMessage(`${OAUTH_LABEL} sign-in didn't complete: ${err.description}${err.code ? ` (${err.code})` : ''}`);
  }, []);

  /**
   * A session arriving makes the signed-out messages untrue: "check your email
   * for a link" and a refused sign-in ("Email not confirmed") stayed under
   * "Signed in as" when the confirmation link was followed in another tab.
   */
  const uid = user?.id ?? null;
  useEffect(() => {
    if (!uid) return;
    setNotice('');
    if (!keepMessage.current) setMessage('');
  }, [uid]);

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

  /**
   * The age question, as both creating forms ask it. Returns the date to
   * record when it clears the minimum, or null after saying why not — a typo
   * and a refusal are different messages, and only a refusal is remembered.
   */
  function checkAge(): string | null {
    if (!isRealDate(dateDraft)) {
      setMessage(DATE_TYPO);
      return null;
    }
    if (!isOldEnough(dateDraft, now)) {
      rememberBirthDate(dateDraft);
      setMessage('');
      setRefused(true);
      return null;
    }
    return dateDraft;
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return setMessage('Choose a display name.');
    if (!goUsername.trim()) return setMessage('Enter your Pokémon GO trainer name.');
    const birthDate = checkAge();
    if (!birthDate) return;
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
    if (!user) return;
    if (!displayName.trim()) return setMessage('Choose a display name.');
    if (!goUsername.trim()) return setMessage('Enter your Pokémon GO trainer name.');
    if (!isRealDate(dateDraft)) return setMessage(DATE_TYPO);
    if (!isOldEnough(dateDraft, now)) {
      // No profile is written, and the session a provider signup opened is
      // closed rather than left signed in to an account it cannot finish.
      checkAge();
      await signOut();
      return;
    }
    if (!normalizeFriendCode(friendCode)) return setMessage(FRIEND_CODE_HINT);
    if (!terms) return setMessage('Accept the terms to finish setting up your account.');

    setBusy(true);
    setMessage('');
    // A phone that suspended this tab (to copy the friend code out of the game)
    // can come back unable to refresh its token, and supabase-js then sends the
    // insert with the anon key, which the owner-only policy refuses as a raw
    // RLS violation. Refreshing first means the insert carries a live token or
    // is not sent; a revoked refresh token signs out, which shows sign-in.
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      setBusy(false);
      return setMessage(SESSION_LAPSED);
    }
    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      display_name: displayName.trim(),
      go_username: goUsername.trim(),
      birth_date: dateDraft,
      tos_accepted_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      // 23505 is a unique violation, and display_name is the only unique column
      // anyone can collide with here. 42501 is the policy refusing a request
      // that arrived without this user's token.
      setMessage(
        error.code === '23505'
          ? 'That display name is taken. Choose another.'
          : error.code === '42501'
            ? SESSION_LAPSED
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

  function switchMode(next: 'register' | 'signin') {
    setMode(next);
    setMessage('');
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

  const noticeLine = notice ? (
    <p className="account-note acct-notice" role="status">
      {notice}
    </p>
  ) : null;

  const nameFields = (
    <>
      <Field index={1} id="display-name" label="Display name">
        <input
          id="display-name"
          className="input"
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field
        index={2}
        id="go-username"
        label="Pokémon GO trainer name"
        note="How an opponent's battle journal identifies you in a dispute. Not verified, and need not be unique."
      >
        <input
          id="go-username"
          className="input"
          autoComplete="off"
          value={goUsername}
          onChange={(e) => setGoUsername(e.target.value)}
        />
      </Field>
      <Field
        index={3}
        id="birth-date"
        label="Date of birth"
        note={`Asked once, when an account is made. Paragon/IV accounts are for people aged ${MINIMUM_AGE} and over.`}
      >
        <input
          id="birth-date"
          className="input"
          type="date"
          value={dateDraft}
          onChange={(e) => setDateDraft(e.target.value)}
        />
      </Field>
    </>
  );

  /**
   * Shared by the two forms that create an account, the way `termsBox` is: the
   * field is the same question in both places, and a second copy is a second
   * thing to keep in step.
   */
  const friendCodeField = (index: number) => (
    <Field
      index={index}
      id="friend-code"
      label="Pokémon GO friend code"
      note={`${FRIEND_CODE_HINT} An opponent sees it only once a match pairs you — it is how you add each other in the game to actually battle.`}
    >
      <input
        id="friend-code"
        className="input acct-mono"
        inputMode="numeric"
        autoComplete="off"
        placeholder="1234 5678 9012"
        value={friendCode}
        onChange={(e) => setFriendCode(e.target.value)}
      />
    </Field>
  );

  const refusal = (
    <div className="acct-refusal" role="alert">
      <p className="account-alert">You need to be at least {MINIMUM_AGE} to hold a Paragon/IV account.</p>
      <p className="account-note">
        That answer is recorded on this device, and there is no account to make here. The rest of
        Paragon/IV — every ranking, every simulation — needs no account at all, so nothing about the
        analysis is closed to you.
      </p>
    </div>
  );

  /** Header status, so the console says what state it is in before you read the body. */
  function link(): Link {
    if (loading || (user && profile === 'unknown')) return 'pending';
    if (user && typeof profile === 'object') return 'online';
    if (user) return 'pending';
    if (refused && mode === 'register') return 'locked';
    return 'offline';
  }

  function title(): string {
    if (loading) return 'Establishing link';
    if (user && typeof profile === 'object') return profile.display_name;
    if (user) return 'Finish your profile';
    return mode === 'register' ? 'Create your trainer ID' : 'Welcome back';
  }

  function body() {
    if (loading) {
      return <p className="account-note acct-scan">Checking whether you are already signed in…</p>;
    }

    if (user && profile === 'unknown') {
      return <p className="account-note acct-scan">Loading your profile…</p>;
    }

    if (user && typeof profile === 'object') {
      return (
        <div className="account-form">
          <p className="account-note">
            Signed in as <strong>{user.email}</strong>.
          </p>
          <dl className="account-summary acct-readout">
            <div className="acct-readout-row">
              <dt className="hud-label">Display name</dt>
              <dd>{profile.display_name}</dd>
            </div>
            <div className="acct-readout-row">
              <dt className="hud-label">Trainer name</dt>
              <dd>{profile.go_username}</dd>
            </div>
            <div className="acct-readout-row">
              <dt className="hud-label">Friend code</dt>
              <dd className={code === null ? 'is-missing' : undefined}>
                {code === 'unknown'
                  ? 'Loading…'
                  : (code ?? 'Not set — an opponent you match with has no way to add you.')}
              </dd>
            </div>
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
                <Field
                  index={1}
                  id="account-friend-code"
                  label="Pokémon GO friend code"
                  note={`${FRIEND_CODE_HINT} An opponent sees it only once a match pairs you.`}
                >
                  <input
                    id="account-friend-code"
                    className="input acct-mono"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="1234 5678 9012"
                    value={codeDraft}
                    onChange={(e) => setCodeDraft(e.target.value)}
                  />
                </Field>
                <div className="acct-actions">
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
                </div>
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
          {noticeLine}
          {alert}
          <div className="acct-actions">
            <a className="btn btn-primary" href={hashForPlayer(user.id)}>
              View and edit your profile
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      );
    }

    // Signed in, with nothing to show for it yet. Reached by a provider signup,
    // which collects none of this, or by losing a display-name race. This is
    // where a first-time Discord account is asked its age.
    if (user && profile === 'missing') {
      return (
        <form className="account-form" onSubmit={completeProfile}>
          <p className="account-note">
            Your account exists and is signed in as <strong>{user.email}</strong>. It needs a name
            before anyone else can see it.
          </p>
          {nameFields}
          {friendCodeField(4)}
          {termsBox}
          {alert}
          <div className="acct-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Finish setting up
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </form>
      );
    }

    // Not signed in.
    return (
      <div className="account-form">
        <div className="acct-modes" role="tablist" aria-label="Account" data-mode={mode}>
          <span className="acct-modes-rail" aria-hidden="true" />
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`acct-mode${mode === 'register' ? ' is-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Create account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={`acct-mode${mode === 'signin' ? ' is-active' : ''}`}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
        </div>

        {noticeLine}

        {mode === 'register' ? (
          refused ? (
            refusal
          ) : (
            <form className="account-form" onSubmit={register} key="register">
              {nameFields}
              <Field index={4} id="email" label="Email">
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field index={5} id="password" label="Password" note="At least 8 characters.">
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {friendCodeField(6)}
              {termsBox}
              {alert}
              <button type="submit" className="btn btn-primary acct-submit" disabled={busy}>
                Create account
              </button>
            </form>
          )
        ) : (
          <form className="account-form" onSubmit={signIn} key="signin">
            <Field index={1} id="email" label="Email">
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field index={2} id="password" label="Password">
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {alert}
            <button type="submit" className="btn btn-primary acct-submit" disabled={busy}>
              Sign in
            </button>
          </form>
        )}

        {/* A refusal is about making an account; a Discord account that already
            exists is still welcome to sign in, so the button stays on the
            sign-in tab. */}
        {!(refused && mode === 'register') && (
          <div className="account-oauth">
            <span className="acct-divider">
              <span>or</span>
            </span>
            <button
              type="button"
              className="btn btn-secondary acct-provider"
              onClick={() => void continueWithProvider()}
            >
              Continue with {OAUTH_LABEL}
              <span className="acct-provider-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  const state = link();

  return (
    <>
      <ScreenHeader
        title="Account"
        blurb="An account is only needed for the parts other people can see. Every ranking and every simulation works without one."
      />
      <section className="panel account-panel acct-console" data-link={state}>
        <header className="acct-head">
          <span className="acct-sigil" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <polygon className="acct-sigil-hex" points="20,2 36,11 36,29 20,38 4,29 4,11" />
              <circle className="acct-sigil-core" cx="20" cy="20" r="5" />
              <path className="acct-sigil-arc" d="M20 9a11 11 0 0 1 11 11" />
            </svg>
          </span>
          <div className="acct-head-text">
            <span className="hud-label">Paragon/IV · Trainer access</span>
            <h2 className="acct-title">{title()}</h2>
          </div>
          <span className="acct-status" data-link={state}>
            <i aria-hidden="true" />
            {LINK_TEXT[state]}
          </span>
        </header>
        <div className="acct-body">{body()}</div>
      </section>
    </>
  );
}
