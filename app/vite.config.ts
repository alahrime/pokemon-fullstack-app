import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Per-chunk size budgets, in kB.
 *
 * Vite's own `chunkSizeWarningLimit` is a single number applied to every chunk,
 * which cannot describe this app: the entry chunk should stay around 950kB,
 * while the two lazy data chunks are multiple megabytes *by design* and always
 * will be. One global limit either fires on the deliberate chunks every single
 * build — which is what it did, and a warning nobody can act on is a warning
 * everybody learns to scroll past — or it is set high enough to cover them and
 * then says nothing when the entry chunk quadruples. So the built-in warning is
 * turned off and this replaces it.
 *
 * Budgets are headroom over the measured size, not aspirations. Raising one is
 * a deliberate act: check *why* the chunk grew first, because the failure mode
 * this guards against is a data artefact silently reappearing in the entry
 * chunk, which is exactly what a static `import` of one will do.
 *
 * Chunk names come from the module that anchors them, so they can change under
 * a refactor; anything unmatched gets DEFAULT_BUDGET, which is the entry
 * chunk's. A rename therefore fails loud rather than silently losing its check.
 */
const DEFAULT_BUDGET = 1100
const BUDGETS: [prefix: string, kB: number, why: string][] = [
  ['index', 1100, 'entry: species.json (~707kB) + app code'],
  ['synergy', 4000, 'lazy: teams.json (~3.8MB), loaded by GBL/Show 6/Cores'],
  ['exportData', 3300, 'lazy: rankings.json (~3.1MB), loaded by Rankings/GBL/Show 6'],
  // 1400 rather than 1000: splitting the entry chunk pushed ~390kB of shared
  // modules down into this one, which is where almost all of the split's
  // duplication landed. Total emitted bytes rose 396kB while the entry chunk
  // fell 6,972kB, so this is the trade working as intended on a chunk only the
  // 3D terrain view ever loads. Measured, not assumed — if it climbs again,
  // check whether a data artefact has followed it down here.
  ['Heatmap3D', 1400, 'lazy: three.js + split-shared modules, loaded by the 3D terrain view'],
]

function chunkBudgets(): Plugin {
  return {
    name: 'chunk-budgets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [file, out] of Object.entries(bundle)) {
        if (out.type !== 'chunk') continue
        const name = file.replace(/^assets\//, '')
        const [, budget, why] = BUDGETS.find(([p]) => name.startsWith(p)) ?? ['', DEFAULT_BUDGET, 'unbudgeted chunk']
        const kB = Buffer.byteLength(out.code) / 1000
        if (kB > budget) {
          this.warn(
            `${name} is ${kB.toFixed(1)}kB, over its ${budget}kB budget (${why}).\n` +
              `    If this is a data artefact that has re-entered the chunk, import it lazily;\n` +
              `    if the growth is real and wanted, raise the budget in vite.config.ts.`,
          )
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), chunkBudgets()],
  json: {
    // Inert under vite 8 / rolldown, and kept only to say so: rolldown emits
    // `JSON.parse("…")` for large JSON either way. Measured 2026-08-02, a clean
    // build with `stringify: true` and one with `false` produced byte-identical
    // output (sha256 b21df737…). The setting predates rolldown, when the choice
    // was real and the object literal measured smaller. It is no longer a
    // choice; delete this block if it ever stops being worth the note.
    stringify: false,
  },
  build: {
    // Superseded by chunkBudgets() above, which knows which chunks are big on
    // purpose. Raised past every deliberate chunk so the generic warning stays
    // quiet rather than duplicating — and contradicting — the budgeted one.
    chunkSizeWarningLimit: 4000,
  },
})
