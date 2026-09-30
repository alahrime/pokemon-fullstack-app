import { useEffect, useRef, useState } from 'react';
import { openDm } from '../../lib/channels';
import { opponentFriendCode } from '../../lib/matchmaking';
import {
  confirmScore, disputeScore, isLivePairing, reportScore, type Pairing, type Tournament,
} from '../../lib/tournaments';
import type { RosterMember } from '../../tournament/roster';
import { useChatDockRequest } from '../../state/ChatDockContext';
import { PlayerRoster } from './RosterCard';
import { RoundClock } from './RoundClock';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Viewer-side choices: [mine, theirs]. */
const CHOICES: readonly [string, number, number][] = [
  ['I won 2–0', 2, 0], ['I won 2–1', 2, 1], ['I lost 1–2', 1, 2], ['I lost 0–2', 0, 2],
];
type Code = { for: string; code: string | null; failed: boolean };

/** The viewer's own matchup this round: both teams, the opponent's friend code and DM, and the score control. */
export function MatchupPanel({ pairing, me, tournament, rosters, names, now, onChanged }: {
  pairing: Pairing; me: string; tournament: Tournament; rosters: ReadonlyMap<string, RosterMember[]>;
  names: ReadonlyMap<string, string>; now: Date; onChanged: () => void;
}) {
  const { requestChannel } = useChatDockRequest();
  const isA = pairing.playerA === me;
  const opp = isA ? pairing.playerB : pairing.playerA;
  const name = (id: string) => names.get(id) ?? 'Player';
  const live = !!opp && tournament.state === 'running' && isLivePairing(pairing, tournament, me);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [code, setCode] = useState<Code | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const oppRef = useRef(opp);
  oppRef.current = opp;

  // A new opponent (next round) starts clean; a late response for the old one is dropped.
  useEffect(() => {
    setErr(null); setCopy('idle'); setCorrecting(false); setCode(null);
    if (!live || !opp) return;
    let cur = true;
    opponentFriendCode(opp).then(
      (c) => { if (cur) setCode({ for: opp, code: c, failed: false }); },
      () => { if (cur) setCode({ for: opp, code: null, failed: true }); },
    );
    return () => { cur = false; };
  }, [opp, live]);
  useEffect(() => {
    if (copy !== 'copied') return;
    const t = setTimeout(() => setCopy('idle'), 3000);
    return () => clearTimeout(t);
  }, [copy]);

  async function run(fn: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setErr(null);
    try {
      await fn();
      setCorrecting(false);
      onChanged();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  const report = (mine: number, theirs: number) =>
    run(() => (isA ? reportScore(pairing.id, mine, theirs) : reportScore(pairing.id, theirs, mine)));
  const dispute = () => { if (window.confirm('Dispute this result?')) void run(() => disputeScore(pairing.id)); };

  async function copyCode(c: string) {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(c);
      setCopy('copied');
    } catch {
      setCopy('manual');
    }
  }
  async function message() {
    if (!opp || busyRef.current) return;
    const target = opp;
    busyRef.current = true; setBusy(true); setErr(null);
    try {
      const ch = await openDm(target);
      if (oppRef.current === target) requestChannel(ch);
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  if (!opp) {
    return (
      <section className="panel chamfer-9 matchup" aria-label="Your matchup">
        <p>You have a bye this round.</p>
      </section>
    );
  }

  const mineOf = (a: number | null, b: number | null) => (isA ? `${a}–${b}` : `${b}–${a}`);
  const score = pairing.scoreA !== null && pairing.scoreB !== null ? mineOf(pairing.scoreA, pairing.scoreB) : '';
  const isFinal = !!pairing.finalAt && new Date(pairing.finalAt) <= now;
  const finalTime = pairing.finalAt ? new Date(pairing.finalAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const canAct = tournament.state === 'running' && !isFinal;
  const oppName = name(opp);

  const picker = (
    <div className="matchup-scores" role="group" aria-label="Report result">
      {CHOICES.map(([label, m, t]) => (
        <button key={label} type="button" className="btn" disabled={busy} onClick={() => void report(m, t)}>{label}</button>
      ))}
    </div>
  );

  function scoreControl() {
    switch (pairing.state) {
      case 'pending': return canAct ? picker : null;
      case 'disputed': return <p>Disputed — the organiser or a judge will settle it</p>;
      case 'settled': return <p>Final score {score}</p>;
      case 'reported': {
        if (isFinal) return <p>Final score {score}</p>;
        const until = <>final at {finalTime} unless disputed</>;
        if (pairing.reportedBy === me) {
          return (
            <>
              <p>You reported {score}. Waiting for {oppName} to confirm — {until}</p>
              {canAct && (correcting ? picker : (
                <button type="button" className="btn" onClick={() => setCorrecting(true)}>Correct result</button>
              ))}
            </>
          );
        }
        return (
          <>
            <p>{oppName} reported {score} — {until}</p>
            {canAct && (
              <div className="matchup-scores">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => confirmScore(pairing.id))}>Confirm</button>
                <button type="button" className="btn" disabled={busy} onClick={dispute}>Dispute</button>
              </div>
            )}
          </>
        );
      }
    }
  }

  const mine = rosters.get(me);
  const theirs = rosters.get(opp);
  const shownCode = live && code?.for === opp ? code : null;
  return (
    <section className="panel chamfer-9 matchup" aria-label="Your matchup">
      <h3 className="matchup-head">Table {pairing.tableNo}: you vs {oppName}</h3>
      <RoundClock endsAt={tournament.roundEndsAt} />
      <div className="matchup-rosters">
        {mine && <PlayerRoster name={name(me)} roster={mine} />}
        {theirs ? <PlayerRoster name={oppName} roster={theirs} /> : <p className="text-muted">Their team is not visible yet</p>}
      </div>
      <div className="matchup-contact">
        {!live ? <span className="text-muted">Friend code no longer shared</span>
          : !shownCode ? <span className="text-muted">Loading friend code…</span>
          : shownCode.failed ? <span className="text-muted">Couldn't load a friend code</span>
          : shownCode.code === null ? <span className="text-muted">No friend code shared</span>
          : (
            <>
              <span>{oppName}'s friend code: <span className="numeric">{shownCode.code}</span></span>
              <button type="button" className="btn" onClick={() => void copyCode(shownCode.code!)}>Copy</button>
              {copy === 'copied' && <span role="status" className="text-muted">Copied</span>}
              {copy === 'manual' && <span className="text-muted">Copy these digits: {shownCode.code}</span>}
            </>
          )}
        {live && <button type="button" className="btn" disabled={busy} onClick={() => void message()}>Message {oppName}</button>}
      </div>
      {scoreControl()}
      {err && <p className="friend-notice" role="alert">{err}</p>}
    </section>
  );
}
