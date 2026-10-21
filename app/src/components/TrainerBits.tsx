import { useEffect, useState } from 'react';
import { getProfiles, trainerUrl, type Profile } from '../lib/profile';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { Sprite } from './Sprite';

/**
 * The pieces every social surface shares — a trainer's avatar, a row of six, a
 * copyable friend code — so a person looks the same on Friends, Matches and in
 * chat.
 */

/**
 * Profiles for a set of ids, loaded once per distinct set. A failed read
 * degrades to an empty map — every caller already renders a name and an
 * initial without one, so a profile outage costs pictures, not the screen.
 */
export function useProfiles(ids: readonly string[]): Map<string, Profile> {
  const key = [...new Set(ids)].sort().join(',');
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  useEffect(() => {
    if (!key) return;
    let live = true;
    getProfiles(key.split(','))
      .then((m) => live && setProfiles(m))
      .catch(() => {});
    return () => { live = false; };
  }, [key]);
  return profiles;
}

/**
 * The trainer's sprite on a square ground; an initial when they have none.
 * Showdown sprites are 80px pixel art, so they are only drawn at 80 or 40 —
 * anything smaller shows the 80px sprite unscaled, cropped to the head, rather
 * than smearing it at a fractional scale.
 */
export function TrainerAvatar({ profile, name, size = 40 }: { profile: Profile | null | undefined; name: string; size?: 24 | 32 | 40 | 80 }) {
  return (
    <span className="trainer-avatar" data-crop={size <= 32 || undefined} style={{ width: size, height: size }} aria-hidden="true">
      {profile?.avatar
        ? <img src={trainerUrl(profile.avatar)} alt="" width={80} height={80} loading="lazy" />
        : <span className="trainer-avatar-initial" style={{ fontSize: Math.round(size * 0.45) }}>{name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
    </span>
  );
}

/** Up to six species as small sprites, named for a screen reader as one list. */
export function MiniTeam({ refs, size = 40, label }: { refs: readonly string[]; size?: 32 | 40 | 56; label: string }) {
  if (refs.length === 0) return null;
  return (
    <ul className="mini-team" aria-label={`${label}: ${refs.map(displayName).join(', ')}`}>
      {refs.slice(0, 6).map((ref, i) => {
        const sp = speciesOf(ref);
        return (
          <li key={`${ref}-${i}`} title={displayName(ref)}>
            {sp ? <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(ref).shadow} /> : <span className="text-faint">?</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** A friend code with a copy button that says when it worked. */
export function CopyCode({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <span className="copy-code chamfer-5">
      <span className="numeric">{code}</span>
      <button
        type="button"
        className="btn btn-ghost"
        aria-label={`Copy ${name}'s friend code`}
        onClick={() => void navigator.clipboard?.writeText(code.replace(/\s/g, '')).then(() => setCopied(true), () => {})}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? 'Friend code copied' : ''}</span>
    </span>
  );
}

/** Level and region as chips; nothing the trainer left blank. Faction is free text, so it reads as text, not a colour. */
export function TrainerChips({ profile }: { profile: Profile | null | undefined }) {
  if (!profile) return null;
  const chips = [profile.trainerLevel != null ? `Lv ${profile.trainerLevel}` : null, profile.faction, profile.region].filter(Boolean);
  if (chips.length === 0) return null;
  return <ul className="trainer-chips">{chips.map((c) => <li key={c}>{c}</li>)}</ul>;
}
