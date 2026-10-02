import { useMemo } from 'react';
import { useAppState } from '../state/AppState';
import { useTheme } from '../state/ThemeContext';
import { SECTIONS, railScreens } from '../lib/screens';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { Sprite } from '../components/Sprite';
import { PokemonCard } from '../components/PokemonCard';
import { LEAGUE_BY_ID, ROSTER, SPECIES } from '../lib/data';
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



/**
 * Shiny Porygon2 is blue (hue ~215°). Each mascot turns that to a tone of its own: a hue, plus a saturation and a
 * brightness, so the set has whites, blacks and browns as well as a colour wheel and stays distinguishable even at
 * twenty-two. The aura is drawn after the tone, so it stays violet. The first six are what a narrow screen keeps, and
 * neighbours in the list are far apart in colour.
 */
const tone = (hue: number, sat = 1, bright = 1) => `hue-rotate(${(hue - 215 + 360) % 360}deg) saturate(${sat}) brightness(${bright})`;
const MASCOTS = ([
  ['red', tone(0)], ['orange', tone(30)], ['yellow', tone(55)], ['green', tone(130)], ['blue', tone(215)], ['purple', tone(275)],
  ['white', tone(215, 0, 1.55)], ['black', tone(215, 0, 0.38)], ['pink', tone(335, 0.7, 1.2)], ['teal', tone(170)],
  ['brown', tone(30, 0.8, 0.55)], ['lime', tone(88)], ['navy', tone(215, 1, 0.5)], ['magenta', tone(305)], ['peach', tone(20, 0.5, 1.45)],
  ['forest', tone(130, 1, 0.5)], ['cyan', tone(190)], ['maroon', tone(0, 1, 0.5)], ['lavender', tone(275, 0.5, 1.45)], ['silver', tone(215, 0, 1.05)],
  ['mint', tone(165, 0.5, 1.4)], ['gold', tone(45, 1, 0.8)],
] as const).map(([name, filter]) => ({ name, filter }));

/** Three to a column, columns of three then two; the column nearest the title is the one every screen keeps. */
const cols = (ids: number[][]) => ids.map((c) => c.map((i) => ({ ...MASCOTS[i], i })));
const LEFT = cols([[0, 1, 2], [6, 7, 8], [12, 13, 14], [18, 19]]);
const RIGHT = cols([[3, 4, 5], [9, 10, 11], [15, 16, 17], [20, 21]]);

function MascotGroup({ side, columns, onPick }: { side: 'left' | 'right'; columns: typeof LEFT; onPick: () => void }) {
  return (
    <div className={`landing-mascots is-${side}`}>
      {columns.map((col, ci) => (
        <div key={ci} className="landing-mascot-col" data-col={ci}>
          {col.map((c) => (
            <button
              key={c.name}
              type="button"
              className="landing-mascot"
              // Every other one faces the other way.
              style={{ ['--mascot-tone' as string]: c.filter, ['--mascot-flip' as string]: c.i % 2 ? -1 : 1 }}
              aria-label={`Shiny Shadow Porygon2, ${c.name} — open its report`}
              title="Porygon2"
              onClick={onPick}
            >
              <Sprite sprite="porygon2" dex={233} size={116} shiny shadow className="mascot-tint" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function LandingScreen() {
  const { state, set, patch } = useAppState();
  const { shiny, toggleShiny } = useTheme();
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

  const openPorygon = () => patch({ species: 'porygon2', moveIdx: 0, chargeIds: [], screen: 'report' });

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

        {/* Up to twenty-two Porygon2 flank the title (as many as the width allows) — the "2" in Paragon/IV. Each is shiny, recoloured by hue, and wreathed in the Shadow aura. */}
        <div className="landing-title-row relative mb-10">
          <MascotGroup side="left" columns={LEFT} onPick={openPorygon} />
          <h1 className="landing-title relative [animation:landing-rise_var(--dur-5)_var(--ease-out)_200ms_both]">
            Every spread.
            <br />
            {/* Gradient-filled type: the accent ramp poured through the glyphs
                rather than sitting behind them. */}
            <span className="landing-title-accent bg-gradient-to-r from-(--color-accent) via-(--color-accent-2) to-(--color-accent) bg-clip-text text-transparent">
              Every matchup.
            </span>
          </h1>
          <MascotGroup side="right" columns={RIGHT} onPick={openPorygon} />
        </div>

        {/* The shiny preference, large and lit on the page everyone lands on: it recolours every sprite in the app. */}
        <button
          type="button"
          role="switch"
          aria-checked={shiny}
          className={`landing-shiny relative${shiny ? ' is-on' : ''}`}
          onClick={toggleShiny}
        >
          <span className="landing-shiny-track" aria-hidden="true"><span className="landing-shiny-knob" /></span>
          <span className="landing-shiny-text">
            <span className="landing-shiny-name">✦ Shiny sprites</span>
            <span className="landing-shiny-state">{shiny ? 'On — every Pokémon is shiny' : 'Off — tap for shiny colours'}</span>
          </span>
        </button>

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
      {/* A leaderboard, and it has to look like one.

          Six built cards in a row is the Show 6 roster elsewhere in this app,
          so this section read as a team — and it was reported as a bug, because
          the list contains Forretress and Forretress (Shadow) and no legal team
          may hold both. The teams themselves were never wrong; this was. It is
          an ordered list now, numbered, and the subtitle says these are ranked
          individually rather than picked to play together. */}
      <section className="mx-auto w-full max-w-(--shell-max) px-6 py-14">
        <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-(--rule-hairline) pb-3">
          <h2 className="font-(family-name:--font-head) text-2xl tracking-tight">
            Strongest in {league.name}
          </h2>
          <span className="text-sm text-(--text-muted)">
            Ranked individually by Overall against the top 100 — not a team
          </span>
        </header>
        <ol className="landing-featured">
          {featured.map((ref, i) => (
            <li key={ref}>
              <span className="numeric landing-featured-pos" aria-hidden="true">
                {i + 1}
              </span>
              {/* No `note`. It carried `types.join(' / ')`, which the card
                  already states above as type badges — the same fact twice,
                  once as a glyph and once as text under it. */}
              <PokemonCard
                refId={ref}
                league={state.league}
                size="compact"
                rank={i}
                onClick={() => open(ref)}
              />
            </li>
          ))}
        </ol>
      </section>

      {/* ── Routes ───────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-(--shell-max) px-6 pb-20">
        <header className="mb-6 border-b border-(--rule-hairline) pb-3">
          <h2 className="font-(family-name:--font-head) text-2xl tracking-tight">Where to go</h2>
        </header>
        {SECTIONS.map((s) => (
          <div key={s.id} className="landing-section mb-10">
            <h3 className="hud-label mb-3 flex items-center gap-2">
              <span aria-hidden="true" style={{ color: s.hue }}>{s.glyph}</span>
              {s.label}
              <span className="text-(--text-faint) normal-case tracking-normal">· {s.blurb}</span>
            </h3>
            <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {railScreens(s).map((r) => (
                <button
                  key={r.id}
                  data-screen={r.id}
                  onClick={() => set('screen', r.id)}
                  className="landing-route group flex flex-col items-start gap-3"
                  style={{ ['--route-hue' as string]: r.hue }}
                >
                  <span className="landing-route-glyph" aria-hidden="true">{r.glyph}</span>
                  <span className="hud-label landing-route-kicker">{r.kicker}</span>
                  <span className="font-(family-name:--font-head) text-xl leading-none tracking-tight">{r.label}</span>
                  <span className="text-sm/relaxed text-(--text-muted)">{r.blurb}</span>
                  <span className="landing-route-arrow mt-auto" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
