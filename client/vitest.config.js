import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vitest shares Vite's config — alias `@/` to `src/` so tests resolve the
// same paths the app does (e.g. `@/components/...`).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // jsdom gives us a window, document, localStorage — needed if we ever
    // add component tests. Pure-domain tests don't need it but the cost is
    // trivial and it unblocks future tests.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
    // mirror `useProjects`/etc naming for future UI tests
    exclude: ['node_modules', 'dist'],
    css: false,
  },
})
