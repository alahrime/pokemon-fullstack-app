import news from '../data/news.json';
import { ScreenHeader } from '../components/ScreenHeader';

/**
 * In-game events (LeekDuck) and Niantic's announcements (pokemongo.com/news), refreshed by
 * .github/workflows/news.yml through scripts/fetch-news.mjs.
 *
 * Split into now / upcoming at render time, not fetch time: the file is only as fresh as the last
 * scheduled run, and an event that ended since then should not still read as live.
 */
export interface NewsEvent { id: string; name: string; kind: string; link: string; image: string; start: string; end: string }

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function splitEvents(events: NewsEvent[], now: number) {
  const live = events.filter((e) => new Date(e.end).getTime() > now);
  return {
    current: live.filter((e) => new Date(e.start).getTime() <= now),
    upcoming: live.filter((e) => new Date(e.start).getTime() > now),
  };
}

function Card({ href, image, kicker, title, meta }: { href: string; image: string; kicker: string; title: string; meta: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="news-card panel chamfer-9 flex flex-col gap-2">
      <img src={image} alt="" loading="lazy" className="news-card-img" />
      <span className="hud-label">{kicker}</span>
      <span className="font-(family-name:--font-head) text-lg/tight tracking-tight">{title}</span>
      <span className="mt-auto text-sm text-(--text-muted)">{meta}</span>
    </a>
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

export function NewsScreen() {
  const { current, upcoming } = splitEvents(news.events, Date.now());
  const event = (e: NewsEvent, meta: string) => <Card key={e.id} href={e.link} image={e.image} kicker={e.kind} title={e.name} meta={meta} />;
  return (
    <div>
      <ScreenHeader
        title="News"
        blurb={<>Events in Pokémon GO now and next, from <a href="https://leekduck.com/events/" target="_blank" rel="noreferrer">LeekDuck</a>, and announcements from <a href="https://pokemongo.com/en/news" target="_blank" rel="noreferrer">pokemongo.com</a>. Times are your local time.</>}
      />
      {current.length > 0 && <Group title="Happening now">{current.map((e) => event(e, `Ends ${when(e.end)}`))}</Group>}
      {upcoming.length > 0 && <Group title="Upcoming">{upcoming.map((e) => event(e, `${when(e.start)} – ${when(e.end)}`))}</Group>}
      <Group title="Announcements">
        {news.announcements.map((a) => (
          <Card key={a.id} href={a.link} image={a.image} kicker="Pokémon GO" title={a.title}
            meta={new Date(a.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} />
        ))}
      </Group>
    </div>
  );
}
