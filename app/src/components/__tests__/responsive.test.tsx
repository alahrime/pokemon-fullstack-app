import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The rules that keep the app inside the window at every width.
 *
 * Every screen overflowed horizontally on a phone, and each cause was a fixed
 * length a narrow container could not honour. jsdom cannot lay any of that out
 * — the widths were measured in the browser, screen by screen, at 320, 375,
 * 768, 1280 and 1920 — but the *shape* of each fix is a text property of the
 * stylesheet, and that is what stops one being undone by hand later.
 *
 * The rule in every case: a length that is a floor must be `min(Npx, 100%)`,
 * so it stops being a floor once the container is narrower than it.
 */

const components = readFileSync('src/styles/components.css', 'utf8');
const leagues = readFileSync('src/styles/leagues.css', 'utf8');

/**
 * The stylesheet with every comment removed.
 *
 * For assertions that a declaration is *absent*. This file explains its fixes
 * by quoting what was wrong, so the note describing a dead rule contains that
 * dead rule — and a search of the raw text finds it. Twice now.
 */
const declarations = components.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * A top-level rule's declarations, with comments removed.
 *
 * Stripping matters: these rules are heavily commented, and a comment
 * explaining *why* `flex: none` was wrong contains the string `flex: none`.
 * An assertion that the declaration is absent would then fail on the note
 * saying so — which is exactly what happened writing this file.
 */
function ruleBody(css: string, selector: string): string {
  const i = css.search(new RegExp(`^\\${selector}\\s*\\{`, 'm'));
  expect(i, `${selector} not found at the top level`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i)).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('no fixed length can outgrow its container', () => {
  it('every auto-fit/auto-fill grid track can shrink below its ideal', () => {
    // `minmax(360px, 1fr)` is 360px wide in a 327px column, which is how the
    // diagnostics split hung off a 375px screen.
    const tracks = components.match(/repeat\(auto-(?:fit|fill),\s*minmax\([^)]*\)[^)]*\)/g) ?? [];
    expect(tracks.length).toBeGreaterThan(5);
    for (const t of tracks) expect(t, t).toMatch(/minmax\(min\(\d+px,\s*100%\)/);
  });

  it('nothing declares a min-width it is also forbidden to shrink to', () => {
    // `.bt-verdict` had `flex: none` above `min-width: min(280px, 100%)`, and
    // flex-shrink: 0 makes that min-width unreachable — the block sized to its
    // content instead, 629px of verdict in a 327px column. A floor only works
    // if the box is allowed to descend to it.
    const rule = ruleBody(components, '.bt-verdict');
    expect(rule).toMatch(/min-width:\s*min\(/);
    expect(rule, 'flex: none would pin it to its content width').not.toMatch(/flex:\s*none/);
  });

  it('does not set flex properties on the children of a grid', () => {
    // `.bt-members-3 > *, .bt-members-6 > * { flex: 1 1 100% }` stood in the
    // 860px query for a long time doing nothing at all: those containers are
    // grids, and flex properties on a grid item are inert. Six members stayed
    // packed into one row at 79px each, which is narrower than a move name.
    const grids = ['.bt-members-3', '.bt-members-6', '.team-slots', '.landing-featured'];
    for (const g of grids) {
      const child = new RegExp(`\\${g}\\s*>\\s*\\*\\s*\\{[^}]*flex:`, 'm');
      expect(declarations, `${g} children given flex properties`).not.toMatch(child);
    }
  });

  it('no min-width large enough to overflow is stated as a bare length', () => {
    // 280px floors on the battle verdict and the heatmap legend put both over
    // the edge at 320px. Small ones are left alone deliberately: the narrowest
    // content column this app produces is ~272px, so a 110px or 140px floor on
    // a numeric cell is a floor it can always honour, and wrapping those in a
    // `min()` would be noise claiming to be a fix.
    const bare = (components.match(/min-width:\s*(\d+)px/g) ?? [])
      .filter((d) => Number(d.match(/(\d+)px/)![1]) >= 200);
    expect(bare).toEqual([]);
  });

  it('the same holds for the Tailwind utilities in the markup', () => {
    // `min-w-[280px]` is the same mistake spelled differently, and greping only
    // the stylesheet missed it.
    const tsx = [
      'src/screens/detail/HeatmapView.tsx',
      'src/screens/ReportScreen.tsx',
      'src/screens/LandingScreen.tsx',
      'src/components/ScreenHeader.tsx',
    ].map((f) => readFileSync(f, 'utf8')).join('\n');
    const bare = tsx.match(/min-w-\[\d+px\]/g) ?? [];
    expect(bare).toEqual([]);
  });
});

describe('the layouts that have to stack', () => {
  it('the nav row wraps instead of running off the side', () => {
    // 410px of league tabs and theme button on a 375px phone, on every screen.
    const rule = ruleBody(components, '.nav-right');
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it('the league tabs shed their padding, then the CP line', () => {
    // The order matters: the emblem and the name are what tell the three
    // leagues apart, so they are the last things to go.
    expect(leagues).toMatch(/@media \(max-width: 560px\)/);
    expect(leagues).toMatch(/@media \(max-width: 420px\)/);
    const narrow = leagues.slice(leagues.indexOf('@media (max-width: 420px)'));
    expect(narrow).toMatch(/\.league-tab-cap\s*\{\s*display:\s*none/);
    expect(narrow).not.toMatch(/\.league-tab-name\s*\{\s*display:\s*none/);
  });

  it('the head-to-head pair stacks, and the rule between it turns with it', () => {
    // A stacked pair with a leftover vertical rule reads as one column with a
    // stray edge down its side.
    const at = components.indexOf('@media (max-width: 680px)');
    expect(at).toBeGreaterThan(-1);
    const q = components.slice(at, at + 400);
    expect(q).toMatch(/\.bt-pair\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(q).toMatch(/border-bottom/);
  });

  it('the report splits into one column before its contents overflow', () => {
    const at = components.indexOf('@media (max-width: 820px)');
    expect(at).toBeGreaterThan(-1);
    expect(components.slice(at, at + 200)).toMatch(/\.rs-split/);
  });

  it('a detail row wraps rather than breaking a figure in half', () => {
    // Both halves are `nowrap` deliberately — "Great League · 1500 · #9" is one
    // fact — so the row is what gives way, and the dotted leader goes with it.
    const at = components.indexOf('@media (max-width: 400px)');
    expect(at).toBeGreaterThan(-1);
    const q = components.slice(at, at + 260);
    expect(q).toMatch(/\.detail-row\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(q).toMatch(/\.detail-row::before\s*\{[^}]*display:\s*none/);
  });
});

describe('what scrolls instead of stacking', () => {
  it('a segmented control scrolls sideways, because it reads as one switch', () => {
    const rule = ruleBody(components, '.seg-group');
    expect(rule).toMatch(/overflow-x:\s*auto/);
    expect(rule).toMatch(/max-width:\s*100%/);
    // And its own row must be allowed to shrink, or there is nothing to scroll.
    expect(components).toMatch(/\*:has\(>\s*\.seg-group\)\s*\{\s*min-width:\s*0/);
  });

  it('every wide table is inside a scroller, and keeps its natural width there', () => {
    const rule = ruleBody(components, '.table-scroll');
    expect(rule).toMatch(/overflow-x:\s*auto/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(components).toMatch(/\.table-scroll\s*>\s*\.table\s*\{\s*min-width:\s*max-content/);
  });

  it('no table is left outside one', () => {
    // A table cannot scroll itself, so this is the only thing standing between
    // a 545px rankings table and a page that scrolls sideways on a phone.
    const files = [
      'src/screens/RankingsScreen.tsx',
      'src/screens/BattleScreen.tsx',
      'src/screens/ReportScreen.tsx',
      'src/screens/detail/HeatmapView.tsx',
      'src/screens/detail/FlipView.tsx',
      'src/screens/detail/ThresholdTable.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const tables = src.match(/<table[\s>]/g) ?? [];
      const wrapped = src.match(/table-scroll/g) ?? [];
      expect(wrapped.length, `${f}: ${tables.length} tables, ${wrapped.length} scrollers`)
        .toBe(tables.length);
    }
  });
});
