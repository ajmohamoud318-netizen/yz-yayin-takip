// Pure smoke test that uses the project's own Vite transformer (the same
// pipeline `npm run dev` and `npm run build` use). Lives under client/ so
// the @/ import alias resolves correctly. The path "../../App.jsx" is
// relative to client/src/components/, so the resolution lands on
// client/src/App.jsx.
import { describe, it, expect } from 'vitest'

describe('JSX parse smoke (Vite transformer)', () => {
  it('App.jsx parses + resolves', async () => {
    const mod = await import('../App.jsx')
    expect(typeof mod.default).toBe('function')
  })

  it('NewProjectDialog.jsx parses + resolves', async () => {
    const mod = await import('./NewProjectDialog.jsx')
    expect(typeof mod.default).toBe('function')
  })
})
