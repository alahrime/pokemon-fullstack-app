import type { CSSProperties } from 'react';
import news from '../data/news.json';
import { ScreenHeader } from '../components/ScreenHeader';
import { Sprite } from '../components/Sprite';
import { TypeBadge } from '../components/TypeBadge';
import { CHARGE_MOVES, FAST_MOVES, LEAGUE_BY_ID, displayName, parseRef, speciesOf } from '../lib/data';
import type { LeagueId } from '../lib/types';
import { useAppState } from '../state/AppState';

/**
 * Paragon's own pages for what is on in Pokémon GO. scripts/fetch-news.mjs (run every six hours by
 * .github/workflows/news.yml) reads LeekDuck's event list and pokemongo.com's announcements for facts — dates, the
 * Pokémon named and where, moves, bonuses, ticket price — and this screen draws them with Paragon's sprites and data.
 * Nothing here is the source's prose or art; the sources are credited at the foot of each story.
 *
 * Split into now / upcoming at render time, not fetch time: the file is only as fresh as the last scheduled run, and
 * an event that ended since then should not still read as live.
 */
export interface Story {
  id: string;
  title: string;
  kind: string;
  /** Events only: LeekDuck's times. No trailing Z means local wall time, which is how `new Date` reads it. */
  start?: string;
  end?: string;
  /** Announcements only: when it was posted, and the article's own date line. */
  date?: string;
  when?: string | null;
  groups: { label: string; refs: string[] }[];
  moves: string[];
  bonuses: string[];
  price: string | null;
  topics: string[];
  sources: { name: string; link: string }[];
}

export const STORIES: Story[] = [
  ...news.events,
  ...news.announcements.map((a) => ({ ...a, kind: 'Announcement' })),
];

export function splitEvents<T extends { start?: string; end?: string }>(events: T[], now: number) {
  const live = events.filter((e) => new Date(e.end!).getTime() > now);
  return {
    current: live.filter((e) => new Date(e.start!).getTime() <= now),
    upcoming: live.filter((e) => new Date(e.start!).getTime() > now),
  };
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Sat, Nov 21 · 2:00 PM – 5:00 PM", or across days "Tue, Oct 27, 10:00 AM – Sun, Nov 1, 10:00 AM". */
export function span(start: string, end: string): string {
  return day(start) === day(end) ? `${day(start)} · ${time(start)} – ${time(end)}` : `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}

/** Where a story stands against `now`, for the pill on its page. */
export function status(s: Story, now: number): string {
  if (!s.start || !s.end) return `Posted ${day(s.date!)}`;
  const start = new Date(s.start).getTime();
  if (new Date(s.end).getTime() <= now) return 'Ended';
  if (start <= now) return 'Live now';
  const days = Math.ceil((start - now) / 86_400_000);
  return days <= 1 ? 'Starts within a day' : `Starts in ${days} days`;
}

/** Every Pokémon a story names that Paragon has, in order, once. */
const refsOf = (s: Story) => [...new Set(s.groups.flatMap((g) => g.refs))].filter((r) => speciesOf(r));

/** The story's colour: its lead Pokémon's first type. */
const hueOf = (s: Story): CSSProperties => {
  const lead = speciesOf(refsOf(s)[0] ?? '');
  return { ['--story-hue' as string]: lead ? `var(--type-${lead.types[0]})` : 'var(--color-accent)' };
};

function Art({ story, size, max }: { story: Story; size: number; max: number }) {
  const refs = refsOf(story).slice(0, max);
  return (
    <div className="news-art" style={hueOf(story)} aria-hidden="true">
      {refs.length ? (
        refs.map((r) => <Sprite key={r} sprite={speciesOf(r)!.sprite} dex={speciesOf(r)!.dex} size={size} shadow={parseRef(r).shadow} />)
      ) : (
        <span className="news-art-glyph">✦</span>
      )}
    </div>
  );
}

function Card({ story, meta }: { story: Story; meta: string }) {
  const { patch } = useAppState();
  return (
    <button type="button" className="news-card panel chamfer-9 flex flex-col gap-2 text-left" onClick={() => { patch({ activeNewsId: story.id }); window.scrollTo(0, 0); }}>
      <Art story={story} size={64} max={3} />
      <span className="hud-label">{story.kind}</span>
      <span className="font-(family-name:--font-head) text-lg/tight tracking-tight">{story.title}</span>
      <span className="mt-auto text-sm text-(--text-muted)">{meta}</span>
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="hud-label mb-3">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/** A Pokémon the story names: Paragon's sprite, types and best league rank, one click from its report. */
function MonTile({ monRef: r }: { monRef: string }) {
  const { patch } = useAppState();
  const s = speciesOf(r)!;
  const { shadow } = parseRef(r);
  const ranks = Object.entries((shadow ? s.shadowLeagueRank : s.leagueRank) ?? {}) as [LeagueId, number][];
  const best = ranks.sort((a, b) => a[1] - b[1])[0];
  return (
    <button type="button" className="news-mon panel chamfer-5 flex items-center gap-3 text-left"
      onClick={() => patch({ species: s.id, shadow, moveIdx: 0, chargeIds: [], screen: 'report', activeNewsId: null })}
      title={`Open ${displayName(r)} in Report`}>
      <Sprite sprite={s.sprite} dex={s.dex} size={56} shadow={shadow} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-(family-name:--font-head) leading-tight">{displayName(r)}</span>
        <span className="flex flex-wrap gap-1">{s.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
        <span className="text-xs text-(--text-muted)">{best ? `${LEAGUE_BY_ID.get(best[0])!.label.split(' ')[0]} League #${best[1]}` : 'Not ranked in PvP'}</span>
      </span>
    </button>
  );
}

function MoveRow({ id }: { id: string }) {
  const fast = FAST_MOVES.find((m) => m.id === id);
  const charge = CHARGE_MOVES.find((m) => m.id === id);
  const m = fast ?? charge;
  if (!m) return null;
  return (
    <li className="flex flex-wrap items-center gap-3">
      <TypeBadge type={m.type} />
      <span className="font-(family-name:--font-head)">{m.name}</span>
      <span className="font-(family-name:--font-mono) text-sm text-(--text-muted)">
        {fast ? `Fast · ${fast.power} power · ${fast.energyGain} energy · ${fast.turns} turn${fast.turns === 1 ? '' : 's'}` : `Charged · ${charge!.power} power · ${charge!.energy} energy`}
      </span>
    </li>
  );
}

function StoryPage({ story }: { story: Story }) {
  const { patch } = useAppState();
  const now = Date.now();
  return (
    <article className="news-story">
      <button type="button" className="btn btn-ghost chamfer-5 mb-4" onClick={() => patch({ activeNewsId: null })}>← All news</button>
      <header className="news-hero panel chamfer-9 mb-8" style={hueOf(story)}>
        <Art story={story} size={112} max={5} />
        <div className="flex flex-col gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <span className="hud-label">{story.kind}</span>
            <span className="news-status">{status(story, now)}</span>
          </span>
          <h1 className="font-(family-name:--font-head) text-3xl/tight tracking-tight">{story.title}</h1>
          <p className="text-(--text-muted)">{story.start && story.end ? span(story.start, story.end) : story.when}</p>
          {(story.topics.length > 0 || story.price) && (
            <ul className="flex flex-wrap gap-2" aria-label="In this event">
              {story.topics.map((t) => <li key={t} className="news-chip">{t}</li>)}
              {story.price && <li className="news-chip">Paid extra · {story.price}</li>}
            </ul>
          )}
        </div>
      </header>

      {story.groups.map((g) => {
        const refs = g.refs.filter((r) => speciesOf(r));
        return refs.length > 0 && (
          <section key={g.label} className="mb-8">
            <h2 className="hud-label mb-3">{g.label}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{refs.map((r) => <MonTile key={r} monRef={r} />)}</div>
          </section>
        );
      })}

      {story.moves.length > 0 && (
        <section className="mb-8">
          <h2 className="hud-label mb-3">Moves</h2>
          <ul className="flex flex-col gap-2">{story.moves.map((id) => <MoveRow key={id} id={id} />)}</ul>
        </section>
      )}

      {story.bonuses.length > 0 && (
        <section className="mb-8">
          <h2 className="hud-label mb-3">Bonuses</h2>
          <ul className="news-bonuses">{story.bonuses.map((b) => <li key={b}>{b}</li>)}</ul>
        </section>
      )}

      <footer className="border-t border-(--rule-hairline) pt-3 text-xs text-(--text-faint)">
        Compiled by Paragon from{' '}
        {story.sources.map((s, i) => (
          <span key={s.link}>{i > 0 && ' and '}<a href={s.link} target="_blank" rel="noreferrer">{s.name}</a></span>
        ))}
        . Details can change; check in game.
      </footer>
    </article>
  );
}

export function NewsScreen() {
  const { state } = useAppState();
  const open = STORIES.find((s) => s.id === state.activeNewsId);
  if (open) return <StoryPage story={open} />;
  const { current, upcoming } = splitEvents(news.events, Date.now());
  const announcements = STORIES.filter((s) => s.kind === 'Announcement');
  return (
    <div>
      <ScreenHeader
        title="News"
        blurb="What is on in Pokémon GO now and next, with every Pokémon one click from its report. Times are your local time."
      />
      {current.length > 0 && <Group title="Happening now">{current.map((e) => <Card key={e.id} story={e} meta={`Ends ${day(e.end)}, ${time(e.end)}`} />)}</Group>}
      {upcoming.length > 0 && <Group title="Upcoming">{upcoming.map((e) => <Card key={e.id} story={e} meta={span(e.start, e.end)} />)}</Group>}
      <Group title="Announcements">
        {announcements.map((a) => <Card key={a.id} story={a} meta={`Posted ${day(a.date!)}`} />)}
      </Group>
    </div>
  );
}
