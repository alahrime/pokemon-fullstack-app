import { useMemo } from 'react';
import { useAppState } from '../state/AppState';
import { SCREEN_DEFS } from '../lib/screens';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { PokemonCard } from '../components/PokemonCard';
import { LEAGUE_BY_ID, ROSTER, SPECIES, speciesOf } from '../lib/data';
import { summaryFor } from '../lib/summary';

/**
 * The way in.
 *
 * Every other screen answers a question about one Pokemon, and all of them
 * were unreachable until you had typed a name into a 220px box wedged into the
 * header. That is backwards: the search *is* the product's first step, so here
 * it is the page — centred, oversized, and the only thing competing for
 * attention above the fold.
 *
 * Below it, three things and no more: what the build actually contains (so the
 * numbers are not a black box), the strongest Pokemon in the current league as
 * a way in for someone with nobody in mind, and the screens themselves. The
 * temptation on a landing page is to explain; this one demonstrates instead.
 *
 * Styling is Tailwind except where a utility cannot reach — the aurora, the
 * self-drawing rule under the headline, the chamfered route cards. Those live
 * in components.css. Everything structural is here, next to the markup it
 * describes, which is the point of using utilities at all.
 */



export function LandingScreen() {
  const { state, set, patch } = useAppState();
  const league = LEAGUE_BY_ID.get(state.league)!;

  // Headline numbers, read from the artefacts rather than written down, so a
  // rebuild that changes them changes this too. They arrive via summary.json
  // rather than lib/rankings and lib/teams because reading them from the full
  // artefacts put 6.9MB in the entry chunk to render a count and six names;
  // scripts/build-summary.ts resolves the same calls at build time instead.
  const summary = summaryFor(state.league);

  const stats = useMemo(
    () => [
      { value: SPECIES.length.toLocaleString(), label: 'species' },
      { value: ROSTER.length.toLocaleString(), label: 'forms simulated' },
      { value: '4,096', label: 'spreads each' },
      { value: summary.teams ? summary.teams.toLocaleString() : '—', label: 'teams / stratum' },
      { value: `rev ${summary.engineRev}`, label: 'engine' },
    ],
    [summary],
  );

  const featured = summary.featured;

  const open = (ref: string) =>
    patch({
      species: ref.replace(/_shadow$/, ''),
      shadow: ref.endsWith('_shadow'),
      moveIdx: 0,
      chargeIds: [],
      screen: 'report',
    });

  return (
    <div className="landing">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="landing-hero flex flex-col items-center px-6 pt-20 pb-16 text-center">
        <div className="landing-hero-clip" aria-hidden="true">
          <div className="landing-hero-glow" />
        </div>

        <p className="hud-label relative mb-6 [animation:landing-rise_var(--dur-4)_var(--ease-out)_120ms_both]">
          Pokémon GO · PvP IV analysis
        </p>

        <h1 className="landing-title relative mb-10 [animation:landing-rise_var(--dur-5)_var(--ease-out)_200ms_both]">
          Every spread.
          <br />
          {/* Gradient-filled type: the accent ramp poured through the glyphs
              rather than sitting behind them. */}
          <span className="landing-title-accent bg-gradient-to-r from-(--color-accent) via-(--color-accent-2) to-(--color-accent) bg-clip-text text-transparent">
            Every matchup.
          </span>
        </h1>

        <p className="relative mb-10 max-w-[58ch] text-lg/relaxed text-(--text-muted) [animation:landing-rise_var(--dur-5)_var(--ease-out)_320ms_both]">
          Pick a Pokémon. Paragon ranks all 4,096 IV combinations against the opponents it
          actually meets in {league.name}, then plays the battles out — shields, energy,
          baiting and all.
        </p>

        {/* The search, given a lit ring and a soft bloom so it reads as the one
            thing on the page you are meant to touch. */}
        <div className="group relative z-50 w-full max-w-2xl [animation:landing-rise_var(--dur-5)_var(--ease-out)_440ms_both]">
          <div
            className="pointer-events-none absolute -inset-px bg-gradient-to-r from-(--color-accent)/40 via-(--color-accent-2)/40 to-(--color-accent)/40 opacity-0 blur-md transition-opacity duration-300 group-focus-within:opacity-100 motion-reduce:transition-none"
            aria-hidden="true"
          />
          <SpeciesSearch
            id="landing-species"
            value={state.species}
            onChange={(id) =>
              // Same reset the nav search does — a carried-over chargeIds names
              // moves the new species does not learn. Landing straight on the
              // report is the point: choosing is the whole interaction here.
              patch({ species: id, moveIdx: 0, chargeIds: [], screen: 'report' })
            }
            placeholder="Search any Pokémon…"
            className="landing-search-input relative"
            // Home is a fresh start, not a readout of what you last looked at.
            startEmpty
          />
        </div>

        <p className="relative mt-4 text-sm text-(--text-faint) [animation:landing-rise_var(--dur-5)_var(--ease-out)_560ms_both]">
          Try{' '}
          {['water & !legendary', '@counter', 'gen1', 'steel|fairy'].map((q, i) => (
            <span key={q}>
              {i > 0 && <span className="mx-1 opacity-40">·</span>}
              <code className="font-(family-name:--font-mono) text-(--color-accent)">{q}</code>
            </span>
          ))}
        </p>

        {/* Stat strip. `tabular-nums` keeps the figures from dancing when the
            league changes and the digit widths differ. */}
        <ul className="relative mt-14 flex flex-wrap items-start justify-center gap-x-10 gap-y-6 [animation:landing-rise_var(--dur-5)_var(--ease-out)_680ms_both]">
          {stats.map((s) => (
            <li key={s.label} className="min-w-24">
              <span className="landing-stat-value tabular-nums">{s.value}</span>
              <span className="hud-label mt-1 block text-(--text-faint)">{s.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Featured ─────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-(--shell-max) px-6 py-14">
        <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-(--rule-hairline) pb-3">
          <h2 className="font-(family-name:--font-head) text-2xl tracking-tight">
            Strongest in {league.name}
          </h2>
          <span className="text-sm text-(--text-muted)">By Overall against the top 100</span>
        </header>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
          {featured.map((ref, i) => (
            <PokemonCard
              key={ref}
              refId={ref}
              league={state.league}
              size="compact"
              rank={i}
              onClick={() => open(ref)}
              note={
                <span className="text-(--text-faint)">
                  {speciesOf(ref)?.types.join(' / ')}
                </span>
              }
            />
          ))}
        </div>
      </section>

      {/* ── Routes ───────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-(--shell-max) px-6 pb-20">
        <header className="mb-6 border-b border-(--rule-hairline) pb-3">
          <h2 className="font-(family-name:--font-head) text-2xl tracking-tight">Where to go</h2>
        </header>
        {/* Equal columns and equal rows: `1fr` rather than auto-fit means the
            six stay a tidy 3x2 that rebalances at 2x3 and 1x6, and every card
            is the height of the tallest so the grid reads as a grid. */}
        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCREEN_DEFS.map((r) => (
            <button
              key={r.id}
              onClick={() => set('screen', r.id)}
              className="landing-route group flex flex-col items-start gap-3"
              // Each card's own hue, consumed by every layer in the CSS.
              style={{ ['--route-hue' as string]: r.hue }}
            >
              <span className="landing-route-glyph" aria-hidden="true">
                {r.glyph}
              </span>
              <span className="hud-label landing-route-kicker">{r.kicker}</span>
              <span className="font-(family-name:--font-head) text-xl leading-none tracking-tight">
                {r.label}
              </span>
              <span className="text-sm/relaxed text-(--text-muted)">{r.blurb}</span>
              <span className="landing-route-arrow mt-auto" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
