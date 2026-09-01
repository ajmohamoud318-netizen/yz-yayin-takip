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
    // Stubs the canvas 2D context jsdom doesn't implement. Required at
    // IMPORT time, not render time: lottie-web draws on a canvas while its
    // module is evaluated, so anything reaching it (App.jsx →
    // CelebrationOverlay) throws on import without this. See the file.
    setupFiles: ['./src/test-setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // mirror `useProjects`/etc naming for future UI tests
    exclude: ['node_modules', 'dist'],
    css: false,
    // ---------------------------------------------------------------------
    // Coverage floor
    // ---------------------------------------------------------------------
    //
    // The numbers below are a TRIPWIRE, not a target. Vitest fails the run
    // when any metric falls under its threshold — that's the whole point:
    // a refactor that silently drops a domain branch (e.g. an unhandled
    // status, a missing transition guard) used to ship green because the
    // test suite only checks the paths it already exercised. With a floor,
    // even untested paths are anchored to the current coverage, so dropping
    // any branch makes CI red.
    //
    // Why these specific numbers:
    //
    //   * `lines: 15` / `functions: 17` look shockingly low. They're not a
    //     measure of test quality — they reflect that most `src/pages/**`
    //     and `src/hooks/**` are exercised indirectly (via domain/
    //     services/pipeline.js and lib/) and never written as their own
    //     unit tests. The domain layer that the FSM parity contract cares
    //     about (transitions, pipeline, progress, project-status, passes)
    //     is at ~100% — that is what guards the server-side parity.
    //
    //   * `branches: 61` is the only metric close to a "real" floor; the
    //     domain-heavy files dominate branch coverage because the FSM
    //     transitions are exhaustively tested. A new branch in an
    //     untested area of the same files would still move the needle.
    //
    // History: the previous configuration had no threshold at all, so a
    // refactor that hid a missing transition could ship. The starting
    // floor is `actual - 5pp` per the repo convention, where `actual` is
    // the current measurement at the time this floor was introduced. Bump
    // it as more tests land — never lower it. If the floor fails, write
    // the test that would have caught it, don't lower the threshold.
    //
    // Server (`server/`) is intentionally NOT covered here: the entity
    // + FSM unit tests already exercise the server domain exhaustively,
    // and the real coverage gap is in route handlers, which need an
    // integration scaffold (real or testcontainers Postgres). Adding
    // coverage without that scaffold would just produce noise.
    // ---------------------------------------------------------------------
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json'],
      // lcov/json go to ./coverage/ — uploaded as a CI artifact (lcov is
      // what codecov/sonar/etc. consume; json lets local scripts grep).
      reportsDirectory: './coverage',
      thresholds: {
        lines: 15,
        branches: 61,
        functions: 17,
      },
    },
  },
})
