import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  json: {
    // species.json is ~1MB of uniformly-shaped records. Vite's default for
    // large JSON is to emit `JSON.parse("…")`, but measured on this file that
    // is *bigger* than a plain object literal (1347kB / 192kB gzip vs
    // 1196kB / 185kB): escaping every quote in the string literal costs more
    // than the unquoted keys do, and gzip already collapses the repetition.
    // Re-measure before flipping this back.
    stringify: false,
  },
  build: {
    // Two known-large chunks: the lazy-loaded 3D view (three.js, ~900kB) and
    // the main chunk carrying the full national-dex roster. Both are
    // deliberate, so the limit is set above them rather than left to warn on
    // every build.
    chunkSizeWarningLimit: 1300,
  },
})
