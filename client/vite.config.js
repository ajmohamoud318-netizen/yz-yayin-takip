import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    // Allow any host header (needed when sharing the dev server through a
    // tunnel like cloudflared/ngrok, which presents its own hostname).
    allowedHosts: true,
    proxy: {
      // Dev proxy: /api/* → Fastify server on :4000. The SPA sends
      // cookies withCredentials=true; we leave withCredentials on
      // (the default for Vite's proxy is to forward them).
      '/api': 'http://localhost:4000',
    },
  },
  // When sharing the dev server through a tunnel, browsers (and Cloudflare's
  // edge) sometimes serve a cached index.html / chunk after a code change.
  // Force everything to be re-validated on every request.
  headers: {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  },
  build: {
    // xlsx (429 KB) and the post-split lottie chunk (~500 KB) are legitimately
    // large libraries that are already split out and only loaded on demand —
    // the chunk-size warning on them is noise. The 700 KB ceiling still flags
    // genuine regressions in `vendor` or the main `index` chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Organise heavy vendor modules into named, cacheable chunks so the
        // main `index` chunk only carries the app code itself.
        //
        //  - xlsx              → loaded on demand by OrderRequestDialog's
        //                        dynamic import (Urunler.jsx page, lazy).
        //  - framer-motion     → shared by Login (eager) + lazy pages; the
        //                        named chunk lets the browser cache it once.
        //  - lottie-*          → loaded on demand by the lazy
        //                        CelebrationOverlay; only fires on a designer
        //                        milestone.
        //  - @radix-ui/*       → primitives used throughout the UI shell.
        //  - lucide-*          → icon set (76 import sites); benefits from a
        //                        shared, cacheable chunk just like radix.
        //  - react*            → matches react, react-dom, react/jsx-runtime,
        //                        and react-router-dom (all `react*` prefixed).
        //
        // `manualChunks` only REORGANISES the chunk graph; a module statically
        // imported by an eager file still loads in parallel with the main
        // chunk. That's why CelebrationOverlay is also lazy-loaded — to
        // actually defer lottie-web, not just put it in a named chunk.
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          if (id.includes('node_modules/framer-motion')) return 'motion'
          if (id.includes('node_modules/lottie-')) return 'lottie'
          if (id.includes('node_modules/@radix-ui')) return 'radix'
          if (id.includes('node_modules/lucide-')) return 'icons'
          if (id.includes('node_modules/react')) return 'vendor'
        },
      },
    },
  },
})
