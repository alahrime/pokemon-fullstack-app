---
name: paragon-frontend
description: Frontend and engine work in the paragon-iv Pokémon IV app (React + TS + Vite in app/). Use this whenever changing anything under app/src — components, styles, the battle engine, the search, the data pipeline — or when a change needs verifying in the running app. Covers how to prove a change is correct here (measure the DOM, diff engine output, run the gate) rather than eyeballing screenshots, plus the design-system conventions and the data-generation rules. Reach for it even for small CSS tweaks; the alignment and stale-state bugs in this codebase are the kind that look fixed in a screenshot and are not.
---

# Working on paragon-iv

A Pokémon GO PvP IV analyser. `app/` is the Vite app; `data-src/` holds
upstream PvPoke data; `app/src/data/species.json` is **generated** — never
hand-edit it.

## The gate

`cd app && npm run check` — tsc, oxlint, token parity, `verify-data`, spread
audit. Run it before every commit. It is fast enough that there is no reason
to skip it.

`verify-data` asserts engine and data invariants against the real modules, not
a reimplementation. When it fails, the first question is *which* is wrong — the
assertion or the change. Several assertions in this repo encode rules that were
later deliberately replaced, so a failure often means "this fixture is stale".
But do not relax an assertion to get green without deciding that explicitly;
two of them caught real bugs this way.

## Verifying a change

The recurring mistake in this codebase is declaring something fixed from a
screenshot. A 5px misalignment is invisible at screenshot scale and obvious on
the page. Prefer, in order:

**1. Measure the DOM.** `mcp__Claude_Browser__javascript_tool` against the dev
server (`http://localhost:5173`). `getBoundingClientRect()` for boxes; a
`Range` over the text node for actual glyph extents, which is what you need
when boxes agree but the text does not look level. Compare the two things
side by side and print the delta — a number settles arguments that adjectives
do not.

**2. Diff engine output.** For anything touching `lib/engine.ts`, snapshot a
wide surface and compare hashes before and after:

```ts
// scratch script — bundle against the REAL engine, never reimplement it
import { rankedOpponents, opponentInfo } from '<abs path>/app/src/lib/engine';
// …walk every league × kind × opponent, push formatted rows…
console.log(rows.length + ' rows sha256=' + createHash('sha256').update(rows.join('\n')).digest('hex'));
```

```bash
cd app && ./node_modules/.bin/esbuild <scratch>.ts --bundle --platform=node \
  --format=esm --outfile=<scratch>.mjs --log-level=warning && node <scratch>.mjs
```

An identical hash across ~100k rows is strong evidence a refactor was
behaviour-preserving. This caught a foe-cache key that was missing its league.

**3. Only then look.** Screenshots are for "does this look right", never for
"is this aligned".

Read-only browser calls (`screenshot`, `get_page_text`, `read_page`) work even
when the permission classifier is unavailable; clicks and `javascript_exec` do
not. If interaction is gated, say the verification is incomplete rather than
inferring from a screenshot.

## Layout pitfalls that have actually bitten

- **`align-items` does not centre vertically on a flex _column_.** There the
  cross axis is horizontal; you want `justify-content`. This silently no-opped
  and cost several rounds.
- **Matching box models beats matching heights.** Two rows aligned by a pinned
  height drift the moment either grows. Give them the same border/padding and
  let them centre in the same space.
- **Optical ≠ geometric.** When every box measures identical and it still reads
  wrong, it usually is — heavier content (bordered chips vs plain text) pulls
  the eye. Nudge by eye, apply it to the whole column so its parts stay
  together, and comment that it is an optical correction so nobody "fixes" it
  back to zero.
- **Lazy images** need `scrollIntoView` before they load; measuring first
  reports 0×0.
- **Careful with string-replacing CSS.** Matching the tail of a grouped
  selector (`.a,\n.b { … }`) leaves the head dangling on the new rule. Re-read
  the block after editing.

## State

Global state in `AppState` holds per-species selections (`chargeIds`,
`moveIdx`). Anything species-specific **must reset when the species changes**,
in the `patch({ species: … })` call. A carried-over `chargeIds` silently
renders the wrong moves — and if it partially overlaps the new species'
movepool it renders *some*, which reads as a broken default rather than stale
state. Check `disabledChargesA/B` on the battle screen for the same shape.

## Design system

Styles live in `app/src/styles/` (`tokens.css` first, then
`components.css`/`leagues.css`). Use the tokens — spacing, `--text-*`,
`--font-mono`, league accents — rather than literals.

The visual language is a machined HUD: chamfered corners via `clip-path`
(9px), hairline borders that brighten on approach, a lit rail on the engaged
state, mono uppercase micro-labels (`.hud-label`). Existing patterns worth
reusing: `.form-toggle` for two-state property switches, `.chip-btn`/`.seg-btn`
for view controls, `.move-picker` for an overlaid searchable list.

Animation runs once on state change, never idles, and is dropped under
`prefers-reduced-motion`.

**Overlay, don't expand.** A control that grows inline shoves everything below
it — browsing 152 moves must not move the page. Panels overlay; the panel's own
height stays a function of what is selected, not of how much exists.

## Generated data

`npm run data` runs two passes: `build-data.mjs` (plain node) writes
`species.json`, then `build-best-spreads.ts` — bundled through esbuild so it
uses the real `bestAt` — records each species' rank-1 IV per league. That makes
**esbuild a build dependency of the data**, so an arch-mismatched
`node_modules` breaks data generation, not just `verify`.

Output is deterministic: regenerating with unchanged inputs must leave
`species.json` byte-identical. A dirty diff means the inputs actually changed.

Two different exclusion mechanisms, easy to confuse:

- `data-src/pool-exclusions.json` — league membership, build time, affects who
  is an *opponent*.
- `UNSIMULATED_IDS` in `lib/data.ts` — species the engine cannot model at all
  (Mimikyu, Morpeko, Aegislash), filtered at runtime from *every* picker and
  pool. Emptying the set restores them with no other edit.

Membership itself is presence in the league's PvPoke ranking, plus a 3000 maxCP
floor in Master only. `MAX_LEVEL_IDX` is pinned to index 98 (level 50) because
the CPM table runs two entries further for Best Buddy — reading the end of that
array inflates every maxCP.

## Keep docs generated, not written

Where UI describes behaviour, derive it from the same source the behaviour uses
— `QUERY_FORMS` powers both the parser docs and the in-app legend;
`UNSIMULATED_IDS` powers both the filtering and the notice naming the species.
Then assert in `verify-data` that each documented form still works. Prose
maintained alongside logic drifts, and a syntax guide describing a form the
parser lost is worse than none.

## Reporting

State what was verified and how. "Both tiles measure 109.1px, delta 0" is
worth more than "aligned". If something could not be checked, say so plainly
instead of implying it was.
