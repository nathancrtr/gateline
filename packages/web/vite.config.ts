import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Two modes share this config (ADR-4): the default `build` mode is the live
// cockpit, served from `/`; `--mode static` is the demo bundle, served from
// files under `/demo/` and built into its own directory so a local checkout
// never serves a bundle whose asset URLs point at the demo path.
export default defineConfig(({ mode }) => ({
  base: mode === 'static' ? '/demo/' : '/',
  build: mode === 'static' ? { outDir: 'dist-static' } : undefined,
  plugins: [react(), tailwindcss()],
  server: {
    port: 4311,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4310', changeOrigin: false },
    },
  },
}))
