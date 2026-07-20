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
})
