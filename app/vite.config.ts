import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    // Above the lazy-loaded 3D view (three.js, ~900kB), which is deliberate,
    // and just above the main chunk (~790kB) so real growth still warns.
    // Interning the move table cut the main chunk from 1563kB; if it climbs
    // back past this, something has started duplicating data again.
    chunkSizeWarningLimit: 950,
  },
})
