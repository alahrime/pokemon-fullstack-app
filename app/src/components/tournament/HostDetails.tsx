import { useState } from 'react';
import { updateTournament, type Tournament } from '../../lib/tournaments';
import type { Run } from './hostRun';

const toLocal = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Edit before the round starts. Every field is sent: the server clears the close time when it is null. */
export function HostDetails({ tournament: t, busy, run }: { tournament: Tournament; busy: boolean; run: Run }) {
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [minutes, setMinutes] = useState(String(t.roundMinutes));
  const [max, setMax] = useState(String(t.maxPlayers));
  const initialCloses = toLocal(t.registrationClosesAt);
  const [closes, setCloses] = useState(initialCloses);
  const mins = Number(minutes); const cap = Number(max);
  const changed = title !== t.title || description !== t.description || mins !== t.roundMinutes || cap !== t.maxPlayers || closes !== initialCloses;
  const valid = title.trim() !== '' && Number.isInteger(mins) && mins >= 1 && Number.isInteger(cap) && cap >= 2;
  const save = () => run(() => updateTournament(t.id, {
    title: title.trim(), description, roundMinutes: mins, maxPlayers: cap,
    closesAt: closes === initialCloses ? t.registrationClosesAt : closes ? new Date(closes).toISOString() : null,
  }));
  return (
    <section className="host-section" aria-label="Details">
      <div className="hud-label">Details</div>
      <div className="field"><label htmlFor="hd-title">Title</label>
        <input id="hd-title" className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="hd-desc">Description</label>
        <textarea id="hd-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="field"><label htmlFor="hd-min">Round length (minutes)</label>
        <input id="hd-min" className="input" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
      <div className="field"><label htmlFor="hd-max">Max players</label>
        <input id="hd-max" className="input" type="number" min={2} value={max} onChange={(e) => setMax(e.target.value)} /></div>
      <div className="field"><label htmlFor="hd-closes">Registration closes (optional)</label>
        <input id="hd-closes" className="input" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></div>
      <button type="button" className="btn" disabled={busy || !changed || !valid} onClick={() => void save()}>Save details</button>
    </section>
  );
}
